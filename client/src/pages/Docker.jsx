import React, { useState, useEffect } from 'react';
import { api } from '../api';
import ContainerCard from '../components/ContainerCard';

export default function Docker() {
  const [containers, setContainers] = useState([]);
  const [images, setImages] = useState([]);
  const [tab, setTab] = useState('containers');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState(null);
  const [logsId, setLogsId] = useState(null);

  const fetchData = async () => {
    try {
      const [c, i] = await Promise.all([
        api('/api/docker/containers'),
        api('/api/docker/images')
      ]);
      setContainers(Array.isArray(c) ? c : []);
      setImages(Array.isArray(i) ? i : []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const containerAction = async (id, action) => {
    try {
      await api(`/api/docker/containers/${id}/${action}`, { method: 'POST' });
      fetchData();
    } catch (err) {
      setError(err.message);
    }
  };

  const viewLogs = async (id) => {
    try {
      const data = await api(`/api/docker/containers/${id}/logs?lines=200`);
      setLogs(data.logs);
      setLogsId(id);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <h2 className="page-title">Docker Management</h2>

      <div className="tabs">
        <button className={`tab ${tab === 'containers' ? 'active' : ''}`} onClick={() => setTab('containers')}>
          Containers ({containers.length})
        </button>
        <button className={`tab ${tab === 'images' ? 'active' : ''}`} onClick={() => setTab('images')}>
          Images ({images.length})
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {tab === 'containers' && (
        <div className="docker-grid">
          {containers.length === 0 ? (
            <div className="empty-state">No containers found</div>
          ) : (
            containers.map((c) => (
              <ContainerCard
                key={c.id}
                container={c}
                onAction={containerAction}
                onViewLogs={viewLogs}
              />
            ))
          )}
        </div>
      )}

      {tab === 'images' && (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Repository</th>
                  <th>Tag</th>
                  <th>ID</th>
                  <th>Size</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {images.map((img, i) => (
                  <tr key={i}>
                    <td>{img.repository}</td>
                    <td><span className="badge">{img.tag}</span></td>
                    <td><code>{img.id}</code></td>
                    <td>{img.size}</td>
                    <td>{img.created}</td>
                  </tr>
                ))}
                {images.length === 0 && (
                  <tr><td colSpan="5" className="empty">No images found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {logs !== null && (
        <div className="modal-overlay" onClick={() => setLogs(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Logs: {logsId}</h3>
              <button className="btn btn-sm" onClick={() => setLogs(null)}>&#10005; Close</button>
            </div>
            <pre className="logs-content">{logs || '(no logs)'}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
