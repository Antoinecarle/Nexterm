import React, { useState, useEffect, useRef } from 'react';
import { api, getToken } from '../api';

export default function Rag() {
  const [projects, setProjects] = useState([]);
  const [ragStatus, setRagStatus] = useState({ indexes: [], qdrant: { ok: false } });
  const [loading, setLoading] = useState(true);
  const [indexingState, setIndexingState] = useState({ active: false, project: null, progress: 0, logs: [] });

  const [selectedProject, setSelectedProject] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const [polledProgress, setPolledProgress] = useState({}); // { [projectName]: { progress, message, logs, active } }
  const [detailProject, setDetailProject] = useState(null); // expanded project name
  const [projectFiles, setProjectFiles] = useState([]); // files of expanded project
  const [detailLoading, setDetailLoading] = useState(false);
  const [collectionInfo, setCollectionInfo] = useState(null);

  const logEndRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchInitialData();
    const interval = setInterval(fetchRagStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // Poll progress for projects that are "indexing" in DB (covers page reload)
  useEffect(() => {
    const indexingProjects = (ragStatus.indexes || [])
      .filter(idx => idx.status === 'indexing')
      .map(idx => idx.project_name);

    if (indexingProjects.length === 0) return;

    const pollAll = async () => {
      for (const name of indexingProjects) {
        try {
          const res = await api(`/api/rag/index/${encodeURIComponent(name)}/progress`);
          setPolledProgress(prev => ({ ...prev, [name]: res }));
          if (res.logs && res.logs.length > 0 && !indexingState.active) {
            // Update logs display from poll if no SSE active
            setIndexingState(prev => ({
              ...prev,
              project: name,
              progress: res.progress || 0,
              logs: res.logs,
            }));
          }
          if (!res.active) {
            fetchRagStatus();
          }
        } catch { /* silent */ }
      }
    };

    pollAll();
    const interval = setInterval(pollAll, 2000);
    return () => clearInterval(interval);
  }, [ragStatus.indexes]);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [indexingState.logs]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [projRes, statusRes] = await Promise.all([
        api('/api/projects'),
        api('/api/rag/status'),
      ]);
      setProjects(projRes || []);
      setRagStatus(statusRes || { indexes: [], qdrant: { ok: false } });
    } catch (err) {
      console.error('Failed to load RAG data', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRagStatus = async () => {
    try {
      const statusRes = await api('/api/rag/status');
      setRagStatus(statusRes || { indexes: [], qdrant: { ok: false } });
    } catch { /* silent */ }
  };

  const getIndexStatus = (projectName) => {
    if (indexingState.active && indexingState.project === projectName) return 'indexing';
    const idx = ragStatus.indexes?.find(i => i.project_name === projectName);
    if (idx?.status === 'indexing') return 'indexing'; // DB says indexing (background)
    return idx ? idx.status : 'not_indexed';
  };

  const getProgressForProject = (projectName) => {
    if (indexingState.active && indexingState.project === projectName) {
      return { progress: indexingState.progress, message: indexingState.logs?.[indexingState.logs.length - 1] || '' };
    }
    const polled = polledProgress[projectName];
    if (polled?.active) {
      return { progress: polled.progress || 0, message: polled.message || '' };
    }
    return null;
  };

  const handleIndexProject = async (projectName) => {
    if (indexingState.active) return;
    setIndexingState({ active: true, project: projectName, progress: 0, logs: [`Starting indexation for ${projectName}...`] });

    try {
      const response = await fetch(`/api/rag/index/${encodeURIComponent(projectName)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim().startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.replace('data: ', ''));
            if (data.type === 'progress' || data.type === 'status') {
              const pct = data.total ? Math.round((data.current / data.total) * 100) : 0;
              setIndexingState(prev => ({
                ...prev,
                progress: pct,
                logs: [...prev.logs, data.message].slice(-50),
              }));
            } else if (data.type === 'done') {
              setIndexingState(prev => ({ ...prev, active: false, progress: 100, logs: [...prev.logs, data.message || 'Done!'] }));
              fetchRagStatus();
            } else if (data.type === 'error') {
              setIndexingState(prev => ({ ...prev, active: false, logs: [...prev.logs, `ERROR: ${data.message}`] }));
              fetchRagStatus();
            }
          } catch { /* parse error */ }
        }
      }
    } catch (err) {
      setIndexingState(prev => ({ ...prev, active: false, logs: [...prev.logs, `Connection failed: ${err.message}`] }));
    }
  };

  const handleDeleteIndex = async (projectName) => {
    if (!confirm(`Delete the index for "${projectName}"?`)) return;
    try {
      await api(`/api/rag/index/${encodeURIComponent(projectName)}`, { method: 'DELETE' });
      if (detailProject === projectName) { setDetailProject(null); setProjectFiles([]); setCollectionInfo(null); }
      fetchRagStatus();
    } catch { /* silent */ }
  };

  const toggleProjectDetail = async (projectName) => {
    if (detailProject === projectName) {
      setDetailProject(null);
      setProjectFiles([]);
      setCollectionInfo(null);
      return;
    }
    setDetailProject(projectName);
    setProjectFiles([]);
    setCollectionInfo(null);
    setDetailLoading(true);
    try {
      const [filesRes, statusRes] = await Promise.all([
        api(`/api/rag/index/${encodeURIComponent(projectName)}/files`),
        api(`/api/rag/status/${encodeURIComponent(projectName)}`),
      ]);
      setProjectFiles(filesRes.files || []);
      setCollectionInfo(statusRes.collection || null);
    } catch { /* silent */ }
    setDetailLoading(false);
  };

  const selectProjectForChat = async (projectName) => {
    setSelectedProject(projectName);
    setActiveConvId(null);
    setMessages([]);
    if (!projectName) { setConversations([]); return; }
    try {
      const res = await api(`/api/rag/conversations/${encodeURIComponent(projectName)}`);
      setConversations(res.conversations || []);
    } catch { /* silent */ }
  };

  const loadConversation = async (convId) => {
    setActiveConvId(convId);
    try {
      const res = await api(`/api/rag/conversations/${encodeURIComponent(selectedProject)}/${convId}`);
      setMessages(res.messages || []);
    } catch { /* silent */ }
  };

  const deleteConversation = async (convId) => {
    try {
      await api(`/api/rag/conversations/${encodeURIComponent(selectedProject)}/${convId}`, { method: 'DELETE' });
      if (activeConvId === convId) { setActiveConvId(null); setMessages([]); }
      setConversations(prev => prev.filter(c => c.id !== convId));
    } catch { /* silent */ }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedProject || isTyping) return;

    const userContent = chatInput;
    setMessages(prev => [...prev, { role: 'user', content: userContent }]);
    setChatInput('');
    setIsTyping(true);

    try {
      const res = await api('/api/rag/chat', {
        method: 'POST',
        body: JSON.stringify({ projectName: selectedProject, conversationId: activeConvId, message: userContent }),
      });

      if (!activeConvId) {
        setActiveConvId(res.conversationId);
        const convs = await api(`/api/rag/conversations/${encodeURIComponent(selectedProject)}`);
        setConversations(convs.conversations || []);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: res.answer, sources: res.sources }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const indexedProjects = ragStatus.indexes?.filter(i => i.status === 'ready').map(i => i.project_name) || [];

  const statusBadge = (status) => {
    const map = {
      ready: { bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', label: 'Ready' },
      indexing: { bg: 'var(--primary-glow)', color: 'var(--primary)', label: 'Indexing...' },
      error: { bg: 'var(--danger-glow)', color: 'var(--danger)', label: 'Error' },
      pending: { bg: 'var(--warning-glow)', color: 'var(--warning)', label: 'Pending' },
      not_indexed: { bg: 'var(--bg-input)', color: 'var(--text-dim)', label: 'Not Indexed' },
    };
    const s = map[status] || map.not_indexed;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', backgroundColor: s.bg, color: s.color }}>
        {s.label}
      </span>
    );
  };

  if (loading) return <div className="page"><div className="loading">Loading RAG data...</div></div>;

  return (
    <div className="page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ backgroundColor: 'var(--primary-glow)', borderRadius: 'var(--radius-sm)', display: 'flex', padding: 8 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
        </div>
        <h2 className="page-title" style={{ margin: 0 }}>RAG Index</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20, flex: 1, minHeight: 0 }}>
        {/* LEFT PANEL */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Engine Status</span>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: ragStatus.qdrant?.ok ? 'var(--success)' : 'var(--danger)', display: 'inline-block', marginRight: 8 }} />
              Qdrant {ragStatus.qdrant?.ok ? 'Online' : 'Offline'}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Projects ({projects.length})
            </div>

            {projects.map(proj => {
              const status = getIndexStatus(proj.name);
              const prog = getProgressForProject(proj.name);
              const idx = ragStatus.indexes?.find(i => i.project_name === proj.name);
              const isExpanded = detailProject === proj.name;
              return (
                <div key={proj.name} style={{ padding: 12, borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-card-solid)', border: isExpanded ? '1px solid var(--primary)' : '1px solid var(--border-light)', marginBottom: 12, cursor: (status !== 'not_indexed') ? 'pointer' : 'default', transition: 'border-color 0.2s' }} onClick={() => { if (status !== 'not_indexed') toggleProjectDetail(proj.name); }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{proj.name}</div>
                        {status !== 'not_indexed' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                        )}
                      </div>
                      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {statusBadge(status)}
                        {idx && status === 'ready' && (
                          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{idx.total_files} files, {idx.total_chunks} chunks</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-xs btn-ghost" title={status === 'ready' ? 'Re-index' : 'Index'} onClick={() => handleIndexProject(proj.name)} disabled={indexingState.active || status === 'indexing'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      </button>
                      {(status === 'ready' || status === 'error') && (
                        <button className="btn btn-xs btn-ghost" style={{ color: 'var(--danger)' }} title="Delete Index" onClick={() => handleDeleteIndex(proj.name)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {status === 'error' && idx?.error_message && (
                    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 'var(--radius-xs)', backgroundColor: 'var(--danger-glow)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--danger)', textTransform: 'uppercase', marginBottom: 4 }}>Error details</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {idx.error_message}
                      </div>
                    </div>
                  )}
                  {status === 'indexing' && prog && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' }}>{prog.message}</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{prog.progress}%</span>
                      </div>
                      <div style={{ height: 3, backgroundColor: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${prog.progress}%`, backgroundColor: 'var(--primary)', transition: 'width 0.3s ease' }} />
                      </div>
                    </div>
                  )}
                  {/* Expanded stats panel */}
                  {isExpanded && idx && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)' }} onClick={(e) => e.stopPropagation()}>
                      {detailLoading ? (
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: 8, textAlign: 'center' }}>Loading stats...</div>
                      ) : (
                        <>
                          {/* Stats grid */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                            <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-xs)', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-light)' }}>
                              <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Files</div>
                              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{idx.total_files}</div>
                            </div>
                            <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-xs)', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-light)' }}>
                              <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Chunks</div>
                              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{idx.total_chunks}</div>
                            </div>
                            <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-xs)', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-light)' }}>
                              <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Vectors</div>
                              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)', marginTop: 2 }}>{collectionInfo?.vectors_count ?? '—'}</div>
                            </div>
                            <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-xs)', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-light)' }}>
                              <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Indexed</div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>{idx.updated_at ? new Date(idx.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                            </div>
                          </div>
                          {/* File list */}
                          {projectFiles.length > 0 && (
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>
                                Indexed Files ({projectFiles.length})
                              </div>
                              <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', backgroundColor: '#000', borderRadius: 4, padding: 8 }}>
                                {projectFiles.map((f, i) => (
                                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: i < projectFiles.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                    <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{f.file_path}</span>
                                    <span style={{ color: 'var(--primary)', whiteSpace: 'nowrap', fontSize: 10 }}>{f.chunk_count} chunks</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {(() => {
              // Show log panel if SSE active OR if we have polled logs for any indexing project
              const hasSSE = indexingState.active;
              const anyPolling = Object.values(polledProgress).some(p => p.active && p.logs?.length > 0);
              if (!hasSSE && !anyPolling) return null;

              const logProject = hasSSE ? indexingState.project : Object.keys(polledProgress).find(k => polledProgress[k].active);
              const logData = hasSSE ? indexingState : polledProgress[logProject] || {};
              const logs = hasSSE ? (indexingState.logs || []) : (logData.logs || []);
              const pct = hasSSE ? indexingState.progress : (logData.progress || 0);

              return (
                <div style={{ marginTop: 20, padding: 12, borderTop: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
                    <span style={{ color: 'var(--primary)' }}>Indexing: {logProject}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{pct}%</span>
                  </div>
                  <div style={{ height: 4, backgroundColor: 'var(--bg-input)', borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
                    <div style={{ height: '100%', width: `${pct}%`, backgroundColor: 'var(--primary)', transition: 'width 0.3s ease' }} />
                  </div>
                  <div style={{ height: 120, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-dim)', padding: 8, backgroundColor: '#000', borderRadius: 4 }}>
                    {logs.map((log, i) => <div key={i} style={{ marginBottom: 2 }}>{`> ${log}`}</div>)}
                    <div ref={logEndRef} />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
          {/* Conversations sidebar */}
          <div style={{ width: 220, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
              <select
                style={{ width: '100%', padding: 6, borderRadius: 'var(--radius-xs)', border: '1px solid var(--border)', backgroundColor: 'var(--bg-input)', color: 'var(--text)', fontSize: 12 }}
                onChange={(e) => selectProjectForChat(e.target.value)}
                value={selectedProject || ''}
              >
                <option value="">Select Indexed Project</option>
                {indexedProjects.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              <button
                className="btn btn-sm btn-ghost"
                style={{ width: '100%', justifyContent: 'flex-start', gap: 8, marginBottom: 12 }}
                onClick={() => { setActiveConvId(null); setMessages([]); }}
                disabled={!selectedProject}
              >
                + New Chat
              </button>

              {conversations.map(conv => (
                <div
                  key={conv.id}
                  style={{
                    padding: 10, borderRadius: 'var(--radius-xs)', fontSize: 12, cursor: 'pointer',
                    backgroundColor: activeConvId === conv.id ? 'var(--bg-hover)' : 'transparent',
                    color: activeConvId === conv.id ? 'var(--primary)' : 'var(--text-muted)',
                    marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: '0.2s',
                  }}
                >
                  <span onClick={() => loadConversation(conv.id)} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                    {conv.title || `Chat ${conv.id.substring(0, 8)}`}
                  </span>
                  <button className="btn btn-xs btn-ghost" style={{ padding: 2, minWidth: 'auto', color: 'var(--text-dim)' }} onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}>
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Chat area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {!selectedProject ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', padding: 40, textAlign: 'center' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 20, opacity: 0.2 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <h3 style={{ marginBottom: 8 }}>RAG Assistant</h3>
                <p style={{ fontSize: 13, maxWidth: 300 }}>Select an indexed project from the dropdown to start asking questions about the codebase.</p>
              </div>
            ) : (
              <>
                <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                  {messages.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                      <p style={{ fontSize: 13 }}>Ask a question like: "How is authentication handled?" or "Find the database connection logic."</p>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '85%', padding: '12px 16px', borderRadius: 'var(--radius)', marginBottom: 16, fontSize: 13, lineHeight: 1.6,
                        backgroundColor: msg.role === 'user' ? 'var(--primary)' : 'var(--bg-elevated)',
                        color: msg.role === 'user' ? '#fff' : 'var(--text)',
                        border: msg.role === 'user' ? 'none' : '1px solid var(--border-light)',
                        boxShadow: msg.role === 'user' ? '0 4px 12px var(--primary-glow)' : 'none',
                      }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>

                        {msg.sources && msg.sources.length > 0 && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--primary)', marginBottom: 8, textTransform: 'uppercase' }}>Sources</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {msg.sources.map((src, j) => (
                                <div key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-xs)', fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border-light)' }} title={`Score: ${(src.score * 100).toFixed(0)}%`}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                  <span>{src.filePath}</span>
                                  <span style={{ opacity: 0.5 }}>L{src.startLine}-{src.endLine}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {isTyping && (
                    <div style={{ display: 'flex', gap: 6, padding: '12px 20px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', maxWidth: 80, marginBottom: 16 }}>
                      {[0, 1, 2].map(i => (
                        <span key={i} style={{ width: 6, height: 6, backgroundColor: 'var(--text-dim)', borderRadius: '50%', animation: 'ragPulse 1.4s infinite ease-in-out', animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div style={{ padding: 20, borderTop: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.1)' }}>
                  <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 12, position: 'relative' }}>
                    <input
                      type="text"
                      placeholder={`Ask about ${selectedProject}...`}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      style={{ flex: 1, margin: 0, padding: '12px 50px 12px 16px', backgroundColor: 'var(--bg-input)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                    />
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={!chatInput.trim() || isTyping}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', padding: '6px 12px', minWidth: 'auto', borderRadius: 'var(--radius-sm)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ragPulse {
          0% { opacity: 0.3; }
          50% { opacity: 1; }
          100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
