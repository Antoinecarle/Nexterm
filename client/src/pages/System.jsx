import React, { useState, useEffect } from 'react';
import { api } from '../api';
import StatCard from '../components/StatCard';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function SystemPage() {
  const [system, setSystem] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      const [sys, procs] = await Promise.all([
        api('/api/system/info'),
        api('/api/system/processes')
      ]);
      setSystem(sys);
      setProcesses(Array.isArray(procs) ? procs : []);
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
  if (!system) return <div className="page"><div className="loading">Loading system info...</div></div>;

  return (
    <div className="page">
      <h2 className="page-title">System Monitor</h2>
      <p className="page-subtitle">{system.hostname} &mdash; {system.platform} &mdash; Uptime: {system.uptime}</p>

      <div className="stats-grid">
        <StatCard
          title="CPU Usage"
          value={`${system.cpu.percent}%`}
          subtitle={`${system.cpu.cores} cores | Load: ${system.loadAvg.join(', ')}`}
          percent={system.cpu.percent}
          color="#3b82f6"
        />
        <StatCard
          title="Memory"
          value={`${formatBytes(system.memory.used)} / ${formatBytes(system.memory.total)}`}
          subtitle={`${system.memory.percent}% used | Free: ${formatBytes(system.memory.free)}`}
          percent={system.memory.percent}
          color="#8b5cf6"
        />
        <StatCard
          title="Disk"
          value={`${formatBytes(system.disk.used)} / ${formatBytes(system.disk.total)}`}
          subtitle={`${system.disk.percent}% used | Free: ${formatBytes(system.disk.available)}`}
          percent={system.disk.percent}
          color="#f59e0b"
        />
      </div>

      <div className="card mt-4">
        <h3>Top Processes (by memory)</h3>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>PID</th>
                <th>User</th>
                <th>CPU %</th>
                <th>MEM %</th>
                <th>Command</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p, i) => (
                <tr key={i}>
                  <td>{p.pid}</td>
                  <td>{p.user}</td>
                  <td>{p.cpu}</td>
                  <td>{p.mem}</td>
                  <td className="truncate">{p.command}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
