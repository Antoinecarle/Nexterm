import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatCard from '../components/StatCard';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function Dashboard() {
  const [system, setSystem] = useState(null);
  const [containers, setContainers] = useState([]);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      const [sys, dock] = await Promise.all([
        api('/api/system/info'),
        api('/api/docker/containers').catch(() => [])
      ]);
      setSystem(sys);
      setContainers(Array.isArray(dock) ? dock : []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;
  if (!system) return <div className="page"><div className="loading">Loading dashboard...</div></div>;

  const runningContainers = containers.filter(c => c.state === 'running').length;

  return (
    <div className="page">
      <header className="dashboard-header">
        <div>
          <h2 className="page-title">System Overview</h2>
          <div className="dashboard-meta">
            <span className="server-status-badge">
              <span className="status-dot-online"></span>
              Online
            </span>
            <span className="meta-sep">&bull;</span>
            <span>{system.hostname}</span>
            <span className="meta-sep">&bull;</span>
            <span>{system.platform}</span>
          </div>
        </div>
        <div className="dashboard-uptime">
          Uptime: <span>{system.uptime}</span>
        </div>
      </header>

      <div className="stats-grid">
        <StatCard
          title="CPU"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/></svg>}
          value={`${system.cpu.percent}%`}
          subtitle={`${system.cpu.cores} Cores · Load: ${system.loadAvg[0]}`}
          percent={system.cpu.percent}
          color="#3b82f6"
        />
        <StatCard
          title="Memory"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 19v2"/><path d="M10 19v2"/><path d="M14 19v2"/><path d="M18 19v2"/><path d="M8 11h8V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2Z"/><path d="M18 5h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/><path d="M4 5h2"/><path d="M4 9h2"/><path d="M4 13h2"/><path d="M4 17h2"/><path d="M6 5v14"/><path d="M18 5v14"/></svg>}
          value={`${formatBytes(system.memory.used)} / ${formatBytes(system.memory.total)}`}
          subtitle={`${system.memory.percent}% Utilized`}
          percent={system.memory.percent}
          color="#8b5cf6"
        />
        <StatCard
          title="Storage"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6" y2="6.01"/><line x1="6" y1="18" x2="6" y2="18.01"/></svg>}
          value={`${formatBytes(system.disk.used)} / ${formatBytes(system.disk.total)}`}
          subtitle={`${system.disk.percent}% used`}
          percent={system.disk.percent}
          color="#f59e0b"
        />
        <StatCard
          title="Docker"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>}
          value={`${runningContainers} Active`}
          subtitle={`${containers.length} Total Containers`}
          percent={containers.length > 0 ? (runningContainers / containers.length) * 100 : 0}
          color="#10b981"
        />
      </div>

      <div className="section-label">Quick Access</div>

      <div className="dashboard-links">
        <Link to="/files" className="dash-link">
          <span className="dash-link-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
          </span>
          <span>Explorer</span>
        </Link>
        <Link to="/terminal" className="dash-link">
          <span className="dash-link-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
          </span>
          <span>Terminal</span>
        </Link>
        <Link to="/system" className="dash-link">
          <span className="dash-link-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>
          </span>
          <span>Monitor</span>
        </Link>
        <Link to="/docker" className="dash-link">
          <span className="dash-link-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </span>
          <span>Docker</span>
        </Link>
        <Link to="/projects" className="dash-link">
          <span className="dash-link-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
          </span>
          <span>Projects</span>
        </Link>
      </div>
    </div>
  );
}
