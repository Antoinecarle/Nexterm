import React, { useState, useEffect } from 'react';
import { api } from '../api';

const TABS = ['commands', 'permissions', 'agents', 'rules'];

export default function Claude() {
  const [activeTab, setActiveTab] = useState('commands');
  const [globalConfig, setGlobalConfig] = useState(null);
  const [projectConfigs, setProjectConfigs] = useState([]);
  const [agents, setAgents] = useState({});
  const [rules, setRules] = useState({ global: null, projects: [] });
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [editingProject, setEditingProject] = useState(null);
  const [editingRules, setEditingRules] = useState(null);
  const [rulesContent, setRulesContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Agent modal state
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [agentForm, setAgentForm] = useState({ name: '', description: '', prompt: '', model: '' });

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [configData, agentsData, rulesData, settingsData] = await Promise.all([
        api('/api/claude/config'),
        api('/api/claude/agents'),
        api('/api/claude/rules'),
        api('/api/claude/settings')
      ]);

      setGlobalConfig(configData.global);
      setProjectConfigs(configData.projects || []);
      setAgents(agentsData.agents || {});
      setRules(rulesData);
      setSettings(settingsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyCommand = (cmd) => {
    navigator.clipboard.writeText(cmd);
    setCopied(cmd);
    setTimeout(() => setCopied(''), 2000);
  };

  const applyGlobalToProject = async (projectPath) => {
    try {
      await api('/api/claude/apply-global', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath })
      });
      fetchAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const applyGlobalToAll = async () => {
    try {
      await api('/api/claude/apply-global-all', { method: 'POST' });
      fetchAll();
    } catch (err) {
      setError(err.message);
    }
  };

  // Rules management
  const openRulesEditor = (type, project = null) => {
    if (type === 'global') {
      setEditingRules({ type: 'global', path: rules.global?.path });
      setRulesContent(rules.global?.content || '');
    } else {
      setEditingRules({ type: 'project', path: project.path, name: project.name });
      setRulesContent(project.content || '');
    }
  };

  const saveRules = async () => {
    try {
      setSaving(true);
      await api('/api/claude/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editingRules.path, content: rulesContent })
      });
      setEditingRules(null);
      fetchAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Agent management
  const openAgentModal = (name = null) => {
    if (name && agents[name]) {
      setEditingAgent(name);
      setAgentForm({
        name,
        description: agents[name].description || '',
        prompt: agents[name].prompt || '',
        model: agents[name].model || ''
      });
    } else {
      setEditingAgent(null);
      setAgentForm({ name: '', description: '', prompt: '', model: '' });
    }
    setShowAgentModal(true);
  };

  const saveAgent = async () => {
    try {
      setSaving(true);
      const agentName = editingAgent || agentForm.name;
      await api(`/api/claude/agents/${encodeURIComponent(agentName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: agentForm.description,
          prompt: agentForm.prompt,
          model: agentForm.model || undefined
        })
      });
      setShowAgentModal(false);
      fetchAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteAgent = async (name) => {
    if (!confirm(`Delete agent "${name}"?`)) return;
    try {
      await api(`/api/claude/agents/${encodeURIComponent(name)}`, { method: 'DELETE' });
      fetchAll();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="page"><div className="loading">Loading Claude config...</div></div>;
  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;

  const commands = [
    { label: 'No permissions prompts', cmd: 'claude --nextmode', description: 'Bypass all permission checks' },
    { label: 'Continue last session', cmd: 'claude --nextmode -c', description: 'Resume previous conversation' },
    { label: 'Global settings only', cmd: 'claude --setting-sources user', description: 'Ignore project settings' },
    { label: 'Initialize project', cmd: 'claude-init', description: 'Copy global permissions to current project' },
    { label: 'With custom agents', cmd: 'claude --agents \'$(cat ~/.claude/agents.json)\'', description: 'Load custom agents from file' },
  ];

  return (
    <div className="page claude-page">
      <header className="claude-header">
        <h2 className="page-title">
          <span className="claude-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </span>
          Claude Code
        </h2>
      </header>

      {/* Tabs */}
      <div className="claude-tabs">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`claude-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'commands' && 'Quick Commands'}
            {tab === 'permissions' && 'Permissions'}
            {tab === 'agents' && 'Agents'}
            {tab === 'rules' && 'Rules (CLAUDE.md)'}
          </button>
        ))}
      </div>

      {/* Commands Tab */}
      {activeTab === 'commands' && (
        <section className="claude-section">
          <div className="commands-grid">
            {commands.map((item) => (
              <div key={item.cmd} className="command-card">
                <div className="command-header">
                  <span className="command-label">{item.label}</span>
                  <button
                    className={`btn btn-xs ${copied === item.cmd ? 'btn-success' : 'btn-ghost'}`}
                    onClick={() => copyCommand(item.cmd)}
                  >
                    {copied === item.cmd ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <code className="command-code">{item.cmd}</code>
                <span className="command-desc">{item.description}</span>
              </div>
            ))}
          </div>

          <div className="tips-card" style={{ marginTop: 24 }}>
            <h4 style={{ marginBottom: 12, color: 'var(--text)' }}>Tips</h4>
            <ul className="tips-list">
              <li><strong>--nextmode</strong> bypasses all permission prompts (alias in ~/.bashrc)</li>
              <li><strong>claude-init</strong> creates .claude/settings.local.json with full permissions</li>
              <li>Global settings apply to new projects without local config</li>
              <li>Project configs <strong>override</strong> global settings when present</li>
            </ul>
          </div>
        </section>
      )}

      {/* Permissions Tab */}
      {activeTab === 'permissions' && (
        <section className="claude-section">
          {/* Global Config */}
          <div className="section-header">
            <h3 className="section-title">Global Permissions</h3>
            <span className="config-path">~/.claude/settings.local.json</span>
          </div>
          <div className="config-card">
            {globalConfig?.permissions?.allow ? (
              <>
                <div className="permissions-header">
                  <span className="permissions-label">Allowed Tools ({globalConfig.permissions.allow.length})</span>
                  <button className="btn btn-xs btn-primary" onClick={applyGlobalToAll}>
                    Apply to All Projects
                  </button>
                </div>
                <div className="permissions-grid">
                  {globalConfig.permissions.allow.map((perm, i) => (
                    <span key={i} className={`permission-tag ${perm.includes('mcp__') ? 'mcp' : ''}`}>
                      {perm}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="no-config">No permissions configured</div>
            )}
            {settings?.settings?.content?.enabledPlugins && (
              <div className="plugins-section">
                <span className="plugins-label">Enabled Plugins</span>
                <div className="plugins-list">
                  {Object.keys(settings.settings.content.enabledPlugins)
                    .filter(k => settings.settings.content.enabledPlugins[k])
                    .map((plugin, i) => (
                      <span key={i} className="plugin-tag">{plugin.replace('@claude-plugins-official', '')}</span>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Project Configs */}
          <div className="section-header" style={{ marginTop: 32 }}>
            <h3 className="section-title">Project Permissions</h3>
            <span className="projects-count">{projectConfigs.length} projects</span>
          </div>
          <div className="projects-config-grid">
            {projectConfigs.map((project, idx) => (
              <div key={idx} className="project-config-card">
                <div className="project-header">
                  <span className="project-name">{project.name}</span>
                  <div className="project-actions">
                    <button
                      className="btn btn-xs btn-ghost"
                      onClick={() => setEditingProject(editingProject === idx ? null : idx)}
                    >
                      {editingProject === idx ? 'Hide' : 'Show'}
                    </button>
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => applyGlobalToProject(project.path)}
                    >
                      Sync
                    </button>
                  </div>
                </div>
                <span className="project-path">{project.path}</span>
                {project.config?.permissions?.allow && (
                  <div className="project-permissions-summary">
                    <span className={`status-indicator ${project.synced ? 'synced' : 'custom'}`}>
                      {project.synced ? '✓ Synced' : '⚠ Custom'}
                    </span>
                    <span className="permissions-count">{project.config.permissions.allow.length} tools</span>
                  </div>
                )}
                {editingProject === idx && project.config?.permissions?.allow && (
                  <div className="project-permissions-detail">
                    <div className="permissions-grid small">
                      {project.config.permissions.allow.map((perm, i) => (
                        <span key={i} className={`permission-tag small ${perm.includes('mcp__') ? 'mcp' : ''}`}>
                          {perm}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {projectConfigs.length === 0 && (
              <div className="no-projects">No project configurations found</div>
            )}
          </div>
        </section>
      )}

      {/* Agents Tab */}
      {activeTab === 'agents' && (
        <section className="claude-section">
          <div className="section-header">
            <h3 className="section-title">Custom Agents</h3>
            <button className="btn btn-sm btn-primary" onClick={() => openAgentModal()}>
              + Add Agent
            </button>
          </div>

          <div className="agents-info">
            <p>Custom agents can be used with: <code>claude --agents '{"'{...}'"}' </code></p>
            <p>Or load from file: <code>claude --agents '$(cat ~/.claude/agents.json)'</code></p>
          </div>

          <div className="agents-grid">
            {Object.keys(agents).length === 0 ? (
              <div className="no-agents">
                <p>No custom agents configured yet.</p>
                <p>Agents are specialized assistants with specific prompts and roles.</p>
              </div>
            ) : (
              Object.entries(agents).map(([name, agent]) => (
                <div key={name} className="agent-card">
                  <div className="agent-header">
                    <span className="agent-name">{name}</span>
                    <div className="agent-actions">
                      <button className="btn btn-xs btn-ghost" onClick={() => openAgentModal(name)}>
                        Edit
                      </button>
                      <button className="btn btn-xs btn-danger" onClick={() => deleteAgent(name)}>
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="agent-description">{agent.description}</p>
                  {agent.model && <span className="agent-model">Model: {agent.model}</span>}
                  <div className="agent-prompt">
                    <span className="agent-prompt-label">Prompt:</span>
                    <pre className="agent-prompt-text">{agent.prompt}</pre>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Rules Tab */}
      {activeTab === 'rules' && (
        <section className="claude-section">
          {editingRules ? (
            <div className="rules-editor">
              <div className="rules-editor-header">
                <h3>
                  {editingRules.type === 'global' ? 'Global Rules' : `Project: ${editingRules.name}`}
                </h3>
                <div className="rules-editor-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditingRules(null)}>
                    Cancel
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={saveRules} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              <span className="rules-path">{editingRules.path}</span>
              <textarea
                className="rules-textarea"
                value={rulesContent}
                onChange={(e) => setRulesContent(e.target.value)}
                placeholder="# CLAUDE.md rules..."
              />
            </div>
          ) : (
            <>
              {/* Global Rules */}
              <div className="section-header">
                <h3 className="section-title">Global Rules</h3>
                <button className="btn btn-sm btn-primary" onClick={() => openRulesEditor('global')}>
                  Edit
                </button>
              </div>
              <div className="rules-card">
                <span className="config-path">{rules.global?.path}</span>
                {rules.global?.content ? (
                  <pre className="rules-preview">{rules.global.content.slice(0, 500)}{rules.global.content.length > 500 ? '...' : ''}</pre>
                ) : (
                  <div className="no-config">No global CLAUDE.md found</div>
                )}
              </div>

              {/* Project Rules */}
              <div className="section-header" style={{ marginTop: 32 }}>
                <h3 className="section-title">Project Rules</h3>
              </div>
              <div className="rules-projects-grid">
                {rules.projects?.length === 0 ? (
                  <div className="no-projects">No project CLAUDE.md files found</div>
                ) : (
                  rules.projects?.map((project, idx) => (
                    <div key={idx} className="rules-project-card">
                      <div className="rules-project-header">
                        <span className="project-name">{project.name}</span>
                        <button className="btn btn-xs btn-ghost" onClick={() => openRulesEditor('project', project)}>
                          Edit
                        </button>
                      </div>
                      <span className="project-path">{project.path}</span>
                      <pre className="rules-preview small">{project.content.slice(0, 200)}{project.content.length > 200 ? '...' : ''}</pre>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* Agent Modal */}
      {showAgentModal && (
        <div className="modal-overlay" onClick={() => setShowAgentModal(false)}>
          <div className="modal agent-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingAgent ? `Edit Agent: ${editingAgent}` : 'New Agent'}</h3>
              <button className="modal-close" onClick={() => setShowAgentModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {!editingAgent && (
                <div className="form-group">
                  <label>Agent Name</label>
                  <input
                    type="text"
                    value={agentForm.name}
                    onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })}
                    placeholder="my-agent"
                  />
                </div>
              )}
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={agentForm.description}
                  onChange={(e) => setAgentForm({ ...agentForm, description: e.target.value })}
                  placeholder="What this agent does..."
                />
              </div>
              <div className="form-group">
                <label>Model (optional)</label>
                <select
                  value={agentForm.model}
                  onChange={(e) => setAgentForm({ ...agentForm, model: e.target.value })}
                >
                  <option value="">Default (inherit)</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="opus">Opus</option>
                  <option value="haiku">Haiku</option>
                </select>
              </div>
              <div className="form-group">
                <label>System Prompt</label>
                <textarea
                  value={agentForm.prompt}
                  onChange={(e) => setAgentForm({ ...agentForm, prompt: e.target.value })}
                  placeholder="You are a specialized agent that..."
                  rows={8}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowAgentModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={saveAgent}
                disabled={saving || (!editingAgent && !agentForm.name) || !agentForm.description || !agentForm.prompt}
              >
                {saving ? 'Saving...' : 'Save Agent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
