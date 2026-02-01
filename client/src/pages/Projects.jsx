import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getToken } from '../api';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Terminal data per project: { [projectName]: [session, ...] }
  const [projectTerminals, setProjectTerminals] = useState({});

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Import modal
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importName, setImportName] = useState('');
  const [cloning, setCloning] = useState(false);
  const [cloneLog, setCloneLog] = useState('');

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadFiles, setUploadFiles] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null);

  const fetchProjects = async () => {
    try {
      const data = await api('/api/projects');
      setProjects(data);
      setError('');
      return data;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const fetchTerminalsForProjects = useCallback(async (projectList) => {
    const terminals = {};
    await Promise.all(
      projectList.map(async (p) => {
        try {
          const sessions = await api(`/api/projects/${encodeURIComponent(p.name)}/terminals`);
          terminals[p.name] = sessions;
        } catch (_) {
          terminals[p.name] = [];
        }
      })
    );
    setProjectTerminals(terminals);
  }, []);

  useEffect(() => {
    fetchProjects().then((data) => {
      if (data.length > 0) fetchTerminalsForProjects(data);
    });
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName('');
      setShowCreate(false);
      const data = await fetchProjects();
      if (data.length > 0) fetchTerminalsForProjects(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleImport = () => {
    if (!importUrl.trim() || cloning) return;
    setCloning(true);
    setCloneLog('');

    const token = getToken();
    fetch('/api/projects/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ url: importUrl.trim(), name: importName.trim() || undefined }),
    }).then(async (response) => {
      if (!response.ok && !response.headers.get('content-type')?.includes('text/event-stream')) {
        const data = await response.json().catch(() => ({}));
        setCloneLog(prev => prev + '\nError: ' + (data.error || `HTTP ${response.status}`));
        setCloning(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processChunk = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7);
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (currentEvent === 'progress') {
                  setCloneLog(prev => prev + data.message);
                } else if (currentEvent === 'done') {
                  setCloneLog(prev => prev + '\n' + data.message);
                  setCloning(false);
                  fetchProjects().then((d) => {
                    if (d.length > 0) fetchTerminalsForProjects(d);
                  });
                } else if (currentEvent === 'error') {
                  setCloneLog(prev => prev + '\nError: ' + data.message);
                  setCloning(false);
                }
              } catch (_) {}
              currentEvent = '';
            }
          }
        }
      };

      await processChunk();
      setCloning(false);
    }).catch((err) => {
      setCloneLog(prev => prev + '\nError: ' + err.message);
      setCloning(false);
    });
  };

  const handleFolderSelect = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadFiles(files);
    setUploadError('');
    setUploadSuccess('');
    // Pre-fill project name from folder name
    const firstPath = files[0].webkitRelativePath || '';
    const folderName = firstPath.split('/')[0] || '';
    if (folderName && !uploadName) {
      setUploadName(folderName);
    }
  };

  const getUploadTotalSize = () => {
    if (!uploadFiles) return 0;
    let total = 0;
    for (let i = 0; i < uploadFiles.length; i++) {
      total += uploadFiles[i].size;
    }
    return total;
  };

  const handleUpload = () => {
    if (!uploadFiles || uploadFiles.length === 0 || !uploadName.trim() || uploading) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError('');
    setUploadSuccess('');

    const formData = new FormData();
    formData.append('projectName', uploadName.trim());

    // Build relative paths (strip the root folder name)
    const relativePaths = [];
    for (let i = 0; i < uploadFiles.length; i++) {
      const fullPath = uploadFiles[i].webkitRelativePath || uploadFiles[i].name;
      // Remove the root folder prefix
      const parts = fullPath.split('/');
      const relPath = parts.slice(1).join('/');
      relativePaths.push(relPath || parts[0]);
      formData.append('files', uploadFiles[i]);
    }
    formData.append('relativePaths', JSON.stringify(relativePaths));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/projects/upload');

    const token = getToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          setUploadSuccess(`Project "${data.name}" created with ${data.fileCount} files.`);
          fetchProjects().then((d) => {
            if (d.length > 0) fetchTerminalsForProjects(d);
          });
        } catch (_) {
          setUploadSuccess('Upload completed.');
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          setUploadError(data.error || `Upload failed (HTTP ${xhr.status})`);
        } catch (_) {
          setUploadError(`Upload failed (HTTP ${xhr.status})`);
        }
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setUploadError('Network error during upload.');
    };

    xhr.send(formData);
  };

  const closeUploadModal = () => {
    if (uploading) return;
    setShowUpload(false);
    setUploadName('');
    setUploadFiles(null);
    setUploadProgress(0);
    setUploadError('');
    setUploadSuccess('');
  };

  const handleDelete = async (name) => {
    try {
      await api(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setDeleteTarget(null);
      const data = await fetchProjects();
      if (data.length > 0) fetchTerminalsForProjects(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleNewTerminal = async (projectName) => {
    navigate(`/terminal?project=${encodeURIComponent(projectName)}`);
  };

  const handleOpenTerminal = (sessionId) => {
    navigate(`/terminal?session=${encodeURIComponent(sessionId)}`);
  };

  const handleOpenInTerminal = (projectName) => {
    navigate(`/terminal?project=${encodeURIComponent(projectName)}`);
  };

  const closeImportModal = () => {
    if (cloning) return;
    setShowImport(false);
    setImportUrl('');
    setImportName('');
    setCloneLog('');
  };

  if (loading) return <div className="page"><div className="loading">Loading projects...</div></div>;

  return (
    <div className="page">
      <div className="projects-header">
        <div>
          <h2 className="page-title">Projects</h2>
          <p className="page-subtitle">Manage your projects in /root/ProjectList</p>
        </div>
        <div className="projects-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setShowCreate(true); setNewName(''); }}
          >
            + New Project
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setShowUpload(true)}
          >
            Upload Folder
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setShowImport(true)}
          >
            Import from GitHub
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showCreate && (
        <div className="new-dir-form">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setShowCreate(false);
            }}
            autoFocus
          />
          <button className="btn btn-sm btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create'}
          </button>
          <button className="btn btn-sm" onClick={() => setShowCreate(false)}>
            Cancel
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty-state">No projects yet. Create one or import from GitHub.</div>
      ) : (
        <div className="projects-grid">
          {projects.map((p) => {
            const terminals = projectTerminals[p.name] || [];
            const activeTerminals = terminals.filter(t => !t.exited);
            return (
              <div key={p.name} className="project-card">
                <div className="project-card-header">
                  <h4>{p.name}</h4>
                </div>
                <div className="project-card-info">
                  <div>Created: {formatDate(p.created)}</div>
                  <div>Size: {formatBytes(p.size)}</div>
                </div>

                {/* Terminals section */}
                <div className="project-terminals">
                  <div className="project-terminals-header">
                    <span className="project-terminals-label">
                      Terminals {terminals.length > 0 && `(${activeTerminals.length} active)`}
                    </span>
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => handleNewTerminal(p.name)}
                    >
                      + New Terminal
                    </button>
                  </div>
                  {terminals.length === 0 ? (
                    <div className="project-terminals-empty">No active terminals</div>
                  ) : (
                    <div className="project-terminals-list">
                      {terminals.map((t) => (
                        <div key={t.id} className="project-terminal-item">
                          <span className={`project-terminal-status ${t.exited ? 'exited' : 'active'}`} />
                          <span className="project-terminal-name">{t.title}</span>
                          <button
                            className="project-open-btn"
                            onClick={() => handleOpenTerminal(t.id)}
                          >
                            Open
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Main action button */}
                <button
                  className="btn btn-sm btn-full"
                  style={{ marginBottom: 8 }}
                  onClick={() => handleOpenInTerminal(p.name)}
                >
                  Open in Terminal
                </button>

                <div className="project-card-actions">
                  {deleteTarget === p.name ? (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--danger)' }}>Confirm delete?</span>
                      <button className="btn btn-xs btn-danger" onClick={() => handleDelete(p.name)}>
                        Yes, delete
                      </button>
                      <button className="btn btn-xs" onClick={() => setDeleteTarget(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-xs btn-danger" onClick={() => setDeleteTarget(p.name)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Folder Modal */}
      {showUpload && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeUploadModal(); }}>
          <div className="modal" style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <h3>Upload Folder</h3>
              <button className="btn btn-xs btn-ghost" onClick={closeUploadModal} disabled={uploading}>
                &#10005;
              </button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div className="form-group">
                <label>Select folder</label>
                <input
                  type="file"
                  ref={(el) => { if (el) el.webkitdirectory = true; }}
                  style={{ display: 'none' }}
                  id="folder-upload-input"
                  onChange={handleFolderSelect}
                  disabled={uploading}
                />
                <button
                  className="btn btn-sm"
                  onClick={() => document.getElementById('folder-upload-input').click()}
                  disabled={uploading}
                >
                  Choose Folder...
                </button>
              </div>

              {uploadFiles && uploadFiles.length > 0 && (
                <div className="upload-preview">
                  <div>{uploadFiles.length} file{uploadFiles.length > 1 ? 's' : ''} selected — {formatBytes(getUploadTotalSize())}</div>
                  {uploadFiles.length > 2000 && (
                    <div style={{ color: 'var(--warning)', marginTop: 4, fontSize: 12 }}>
                      Warning: Large number of files ({uploadFiles.length}). Upload may be slow.
                    </div>
                  )}
                </div>
              )}

              <div className="form-group" style={{ marginTop: 12 }}>
                <label>Project name</label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="my-project"
                  disabled={uploading}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleUpload(); }}
                />
              </div>

              <button
                className="btn btn-primary btn-sm"
                onClick={handleUpload}
                disabled={uploading || !uploadFiles || uploadFiles.length === 0 || !uploadName.trim()}
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>

              {uploading && (
                <div style={{ marginTop: 14 }}>
                  <div className="upload-progress-bar">
                    <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <div className="upload-progress-text">{uploadProgress}%</div>
                </div>
              )}

              {uploadError && (
                <div className="alert alert-error" style={{ marginTop: 14 }}>{uploadError}</div>
              )}
              {uploadSuccess && (
                <div style={{ marginTop: 14, color: 'var(--success)', fontSize: 13 }}>{uploadSuccess}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeImportModal(); }}>
          <div className="modal" style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <h3>Import from GitHub</h3>
              <button className="btn btn-xs btn-ghost" onClick={closeImportModal} disabled={cloning}>
                &#10005;
              </button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div className="form-group">
                <label>Repository URL</label>
                <input
                  type="text"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://github.com/user/repo"
                  disabled={cloning}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleImport(); }}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Project name (optional, defaults to repo name)</label>
                <input
                  type="text"
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="my-project"
                  disabled={cloning}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleImport(); }}
                />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleImport}
                disabled={cloning || !importUrl.trim()}
              >
                {cloning ? 'Cloning...' : 'Clone'}
              </button>
              {cloneLog && (
                <pre className="clone-progress">{cloneLog}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
