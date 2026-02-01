import React from 'react';

export default function ContainerCard({ container, onAction, onViewLogs }) {
  const isRunning = container.state === 'running';
  const isPaused = container.state === 'paused';

  return (
    <div className={`container-card ${isRunning ? 'running' : isPaused ? 'paused' : 'stopped'}`}>
      <div className="container-header">
        <span className={`status-dot ${container.state}`} />
        <h4>{container.name}</h4>
      </div>
      <div className="container-info">
        <div><strong>Image:</strong> {container.image}</div>
        <div><strong>Status:</strong> {container.status}</div>
        <div><strong>ID:</strong> <code>{container.id}</code></div>
        {container.ports && <div><strong>Ports:</strong> {container.ports}</div>}
      </div>
      <div className="container-actions">
        {isRunning ? (
          <>
            <button className="btn btn-xs btn-warning" onClick={() => onAction(container.id, 'stop')}>Stop</button>
            <button className="btn btn-xs" onClick={() => onAction(container.id, 'restart')}>Restart</button>
            <button className="btn btn-xs" onClick={() => onAction(container.id, 'pause')}>Pause</button>
          </>
        ) : isPaused ? (
          <button className="btn btn-xs btn-primary" onClick={() => onAction(container.id, 'unpause')}>Unpause</button>
        ) : (
          <button className="btn btn-xs btn-primary" onClick={() => onAction(container.id, 'start')}>Start</button>
        )}
        <button className="btn btn-xs" onClick={() => onViewLogs(container.id)}>Logs</button>
        <button className="btn btn-xs btn-danger" onClick={() => {
          if (confirm(`Remove container "${container.name}"?`)) onAction(container.id, 'remove');
        }}>Remove</button>
      </div>
    </div>
  );
}
