import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import CodeEditor from '../components/CodeEditor';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString();
}

function getLanguageLabel(filePath) {
  if (!filePath) return '';
  const ext = filePath.split('.').pop().toLowerCase();
  const labels = {
    js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX',
    mjs: 'JavaScript', cjs: 'JavaScript',
    json: 'JSON', css: 'CSS', html: 'HTML', htm: 'HTML',
    xml: 'XML', svg: 'SVG', md: 'Markdown', markdown: 'Markdown',
    py: 'Python', yaml: 'YAML', yml: 'YAML',
    sh: 'Shell', bash: 'Bash', txt: 'Text',
    env: 'Env', toml: 'TOML', ini: 'INI', cfg: 'Config',
    dockerfile: 'Dockerfile', gitignore: 'Git',
  };
  return labels[ext] || ext.toUpperCase();
}

function getFileName(filePath) {
  return filePath.split('/').pop();
}

const MOBILE_BREAKPOINT = 768;

export default function Files() {
  const [currentPath, setCurrentPath] = useState('/root');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNewDir, setShowNewDir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  // Tabs system
  const [tabs, setTabs] = useState([]);
  const [activeTabPath, setActiveTabPath] = useState(null);

  // Mobile view toggle: 'list' or 'editor'
  const [mobileView, setMobileView] = useState('list');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= MOBILE_BREAKPOINT);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeTab = tabs.find((t) => t.path === activeTabPath) || null;

  const fetchDir = useCallback(async (dirPath) => {
    setLoading(true);
    setError('');
    try {
      const data = await api(`/api/files/list?path=${encodeURIComponent(dirPath)}`);
      setItems(data.items);
      setCurrentPath(data.path);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDir(currentPath);
  }, []);

  const navigateTo = (name, isDir) => {
    if (isDir) {
      const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
      fetchDir(newPath);
    } else {
      openFile(name);
    }
  };

  const goUp = () => {
    if (currentPath === '/') return;
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    fetchDir(parent);
  };

  const openFile = async (name) => {
    const filePath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;

    // If tab already open, just activate it
    const existing = tabs.find((t) => t.path === filePath);
    if (existing) {
      setActiveTabPath(filePath);
      if (isMobile) setMobileView('editor');
      return;
    }

    try {
      const data = await api(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const newTab = {
        path: filePath,
        originalContent: data.content,
        content: data.content,
        modified: false,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabPath(filePath);
      if (isMobile) setMobileView('editor');
    } catch (err) {
      setError(err.message);
    }
  };

  const closeTab = (path, e) => {
    if (e) e.stopPropagation();
    const tab = tabs.find((t) => t.path === path);
    if (tab && tab.modified) {
      if (!confirm(`"${getFileName(path)}" has unsaved changes. Close anyway?`)) return;
    }
    setTabs((prev) => prev.filter((t) => t.path !== path));
    if (activeTabPath === path) {
      const remaining = tabs.filter((t) => t.path !== path);
      if (remaining.length > 0) {
        setActiveTabPath(remaining[remaining.length - 1].path);
      } else {
        setActiveTabPath(null);
        if (isMobile) setMobileView('list');
      }
    }
  };

  const updateTabContent = (path, newContent) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.path === path
          ? { ...t, content: newContent, modified: newContent !== t.originalContent }
          : t
      )
    );
  };

  const saveActiveFile = async () => {
    if (!activeTab) return;
    try {
      await api('/api/files/write', {
        method: 'POST',
        body: JSON.stringify({ path: activeTab.path, content: activeTab.content }),
      });
      setTabs((prev) =>
        prev.map((t) =>
          t.path === activeTab.path
            ? { ...t, originalContent: activeTab.content, modified: false }
            : t
        )
      );
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const downloadActiveFile = () => {
    if (!activeTab) return;
    const blob = new Blob([activeTab.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getFileName(activeTab.path);
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteItem = async (name, isDir) => {
    const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    if (!confirm(`Delete ${isDir ? 'directory' : 'file'} "${name}"?`)) return;
    try {
      await api(`/api/files?path=${encodeURIComponent(fullPath)}`, { method: 'DELETE' });
      // Close tab if this file was open
      setTabs((prev) => prev.filter((t) => t.path !== fullPath));
      if (activeTabPath === fullPath) {
        const remaining = tabs.filter((t) => t.path !== fullPath);
        setActiveTabPath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
      }
      fetchDir(currentPath);
    } catch (err) {
      setError(err.message);
    }
  };

  const createDir = async () => {
    if (!newDirName.trim()) return;
    const fullPath = currentPath === '/' ? `/${newDirName}` : `${currentPath}/${newDirName}`;
    try {
      await api('/api/files/mkdir', {
        method: 'POST',
        body: JSON.stringify({ path: fullPath }),
      });
      setNewDirName('');
      setShowNewDir(false);
      fetchDir(currentPath);
    } catch (err) {
      setError(err.message);
    }
  };

  const createFile = async () => {
    if (!newFileName.trim()) return;
    const fullPath = currentPath === '/' ? `/${newFileName}` : `${currentPath}/${newFileName}`;
    try {
      await api('/api/files/write', {
        method: 'POST',
        body: JSON.stringify({ path: fullPath, content: '' }),
      });
      setNewFileName('');
      setShowNewFile(false);
      fetchDir(currentPath);
      // Open the new file in a tab
      const newTab = {
        path: fullPath,
        originalContent: '',
        content: '',
        modified: false,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabPath(fullPath);
      if (isMobile) setMobileView('editor');
    } catch (err) {
      setError(err.message);
    }
  };

  // Global keyboard shortcut for Ctrl+S / Cmd+S
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeTab && activeTab.modified) {
          saveActiveFile();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab]);

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  const showFilesList = !isMobile || mobileView === 'list';
  const showEditor = !isMobile || mobileView === 'editor';

  return (
    <div className="page files-page">
      <h2 className="page-title">File Explorer</h2>

      {showFilesList && (
        <>
          <div className="breadcrumb">
            <span className="breadcrumb-item" onClick={() => fetchDir('/')}>
              /
            </span>
            {breadcrumbs.map((part, i) => (
              <span key={i}>
                <span className="breadcrumb-sep">/</span>
                <span
                  className="breadcrumb-item"
                  onClick={() => fetchDir('/' + breadcrumbs.slice(0, i + 1).join('/'))}
                >
                  {part}
                </span>
              </span>
            ))}
          </div>

          <div className="files-toolbar">
            <button className="btn btn-sm" onClick={goUp} disabled={currentPath === '/'}>
              &#8593; Up
            </button>
            <button className="btn btn-sm" onClick={() => fetchDir(currentPath)}>
              &#8635; Refresh
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => { setShowNewDir(!showNewDir); setShowNewFile(false); }}
            >
              + New Folder
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => { setShowNewFile(!showNewFile); setShowNewDir(false); }}
            >
              + New File
            </button>
          </div>

          {showNewDir && (
            <div className="new-dir-form">
              <input
                type="text"
                value={newDirName}
                onChange={(e) => setNewDirName(e.target.value)}
                placeholder="Folder name"
                onKeyDown={(e) => e.key === 'Enter' && createDir()}
                autoFocus
              />
              <button className="btn btn-sm btn-primary" onClick={createDir}>
                Create
              </button>
              <button className="btn btn-sm" onClick={() => setShowNewDir(false)}>
                Cancel
              </button>
            </div>
          )}

          {showNewFile && (
            <div className="new-dir-form">
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="File name (e.g. script.js)"
                onKeyDown={(e) => e.key === 'Enter' && createFile()}
                autoFocus
              />
              <button className="btn btn-sm btn-primary" onClick={createFile}>
                Create
              </button>
              <button className="btn btn-sm" onClick={() => setShowNewFile(false)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="files-layout">
        {showFilesList && (
          <div className={`files-list ${isMobile && mobileView === 'editor' ? 'mobile-hidden' : ''}`}>
            {loading ? (
              <div className="loading">Loading...</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Modified</th>
                    <th>Perms</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.name}
                      className={
                        activeTabPath && activeTabPath.endsWith('/' + item.name) ? 'selected' : ''
                      }
                    >
                      <td>
                        <span
                          className={`file-name ${item.isDirectory ? 'dir' : 'file'}`}
                          onClick={() => navigateTo(item.name, item.isDirectory)}
                        >
                          <span className="file-icon">
                            {item.isDirectory ? '\u{1F4C1}' : '\u{1F4C4}'}
                          </span>
                          {item.name}
                        </span>
                      </td>
                      <td>{item.isFile ? formatBytes(item.size) : '--'}</td>
                      <td>{formatDate(item.modified)}</td>
                      <td>
                        <code>{item.permissions}</code>
                      </td>
                      <td>
                        <button
                          className="btn btn-xs btn-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteItem(item.name, item.isDirectory);
                          }}
                        >
                          &#10005;
                        </button>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan="5" className="empty">
                        Empty directory
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {showEditor && (
          <div className={`editor-panel ${isMobile && mobileView === 'editor' ? 'mobile-fullscreen' : ''}`}>
            {tabs.length > 0 ? (
              <>
                {isMobile && mobileView === 'editor' && (
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                    <button
                      className="btn btn-sm mobile-back-btn"
                      onClick={() => setMobileView('list')}
                    >
                      &#8592; Back to files
                    </button>
                  </div>
                )}
                <div className="editor-tabs">
                  {tabs.map((tab) => (
                    <div
                      key={tab.path}
                      className={`editor-tab ${tab.path === activeTabPath ? 'active' : ''}`}
                      onClick={() => setActiveTabPath(tab.path)}
                    >
                      <span className="editor-tab-name">
                        {tab.modified ? '* ' : ''}
                        {getFileName(tab.path)}
                      </span>
                      <span
                        className="editor-tab-close"
                        onClick={(e) => closeTab(tab.path, e)}
                      >
                        &#10005;
                      </span>
                    </div>
                  ))}
                </div>

                {activeTab && (
                  <>
                    <div className="editor-toolbar">
                      <span className="editor-toolbar-path">{activeTab.path}</span>
                      <div className="editor-toolbar-actions">
                        <span className="badge editor-lang-badge">
                          {getLanguageLabel(activeTab.path)}
                        </span>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={saveActiveFile}
                          disabled={!activeTab.modified}
                        >
                          Save
                        </button>
                        <button className="btn btn-sm" onClick={downloadActiveFile}>
                          Download
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => closeTab(activeTab.path)}
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    <div className="editor-content">
                      <CodeEditor
                        key={activeTab.path}
                        value={activeTab.content}
                        onChange={(val) => updateTabContent(activeTab.path, val)}
                        filePath={activeTab.path}
                        onSave={saveActiveFile}
                      />
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="editor-empty">
                {isMobile && mobileView === 'editor' ? (
                  <>
                    <div className="editor-empty-icon">&#128196;</div>
                    <div className="editor-empty-text">No file open</div>
                    <button
                      className="btn btn-sm"
                      onClick={() => setMobileView('list')}
                      style={{ marginTop: '12px' }}
                    >
                      &#8592; Back to files
                    </button>
                  </>
                ) : (
                  <>
                    <div className="editor-empty-icon">&#128196;</div>
                    <div className="editor-empty-text">Select a file to open</div>
                    <div className="editor-empty-hint">
                      Click any file in the explorer to start editing
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
