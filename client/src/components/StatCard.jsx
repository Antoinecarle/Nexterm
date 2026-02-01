import React from 'react';

export default function StatCard({ title, value, subtitle, percent, color, icon }) {
  const clampedPercent = Math.min(percent, 100);

  return (
    <div className="stat-card" style={{ '--card-color': color, borderTop: `2px solid ${color}` }}>
      <div className="stat-card-top">
        <div className="stat-icon-container" style={{ backgroundColor: `${color}15`, color: color, boxShadow: `0 0 20px ${color}10`, border: `1px solid ${color}20` }}>
          {icon}
        </div>
        <div className="stat-info">
          <span className="stat-title">{title}</span>
          <div className="stat-value-row">
            <span className="stat-value">{value}</span>
            <span className="stat-percent" style={{ color }}>{clampedPercent}%</span>
          </div>
        </div>
      </div>
      <div className="stat-bar-bg">
        <div
          className="stat-bar"
          style={{
            width: `${clampedPercent}%`,
            backgroundColor: color,
            boxShadow: `0 0 10px ${color}40`,
            background: `linear-gradient(90deg, ${color}, ${color}ee)`,
          }}
        />
      </div>
      <p className="stat-subtitle">{subtitle}</p>
    </div>
  );
}
