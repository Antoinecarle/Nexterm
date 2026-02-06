import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

export default function Settings() {
  const [sshKey, setSshKey] = useState(null);
  const [keyExists, setKeyExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  // API Keys state
  const [apiKeys, setApiKeys] = useState({ openai: {}, googleAi: {} });
  const [openaiKey, setOpenaiKey] = useState('');
  const [googleAiKey, setGoogleAiKey] = useState('');
  const [savingKeys, setSavingKeys] = useState(false);
  const [keysSaved, setKeysSaved] = useState(false);

  const fetchApiKeys = useCallback(async () => {
    try {
      const data = await api('/api/settings/api-keys');
      setApiKeys(data);
    } catch (_) {}
  }, []);

  const handleSaveApiKeys = async () => {
    setSavingKeys(true);
    setKeysSaved(false);
    try {
      await api('/api/settings/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openaiApiKey: openaiKey || undefined,
          googleAiApiKey: googleAiKey || undefined,
        }),
      });
      setOpenaiKey('');
      setGoogleAiKey('');
      setKeysSaved(true);
      setTimeout(() => setKeysSaved(false), 2000);
      await fetchApiKeys();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKeys(false);
    }
  };

  const fetchKey = useCallback(async () => {
    try {
      setError(null);
      const data = await api('/api/settings/ssh-key');
      setSshKey(data.key);
      setKeyExists(data.exists);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKey();
    fetchApiKeys();
  }, [fetchKey, fetchApiKeys]);

  const handleCopy = async () => {
    if (!sshKey) return;
    try {
      await navigator.clipboard.writeText(sshKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS or older browsers
      const ta = document.createElement('textarea');
      ta.value = sshKey;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await api('/api/settings/ssh-test', { method: 'POST' });
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    setError(null);
    setTestResult(null);
    try {
      const data = await api('/api/settings/ssh-key/regenerate', { method: 'POST' });
      setSshKey(data.key);
      setKeyExists(data.exists);
      setConfirmRegen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) return <div className="page"><div className="loading">Loading...</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Server configuration and integrations</p>

      {error && <div className="alert alert-error">{error}</div>}

      {/* GitHub SSH Section */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">GitHub SSH</h2>
          <div className="settings-section-desc">
            Configure SSH key authentication for Git operations with GitHub.
          </div>
        </div>

        {/* SSH Key Display */}
        <div className="settings-card">
          <div className="settings-card-header">
            <h3>SSH Public Key</h3>
            <div className="settings-card-actions">
              {keyExists && (
                <button className="btn btn-sm" onClick={handleCopy} disabled={!sshKey}>
                  {copied ? '\u2713 Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>
          {keyExists ? (
            <div className="ssh-key-block">
              <code className="ssh-key-content">{sshKey}</code>
            </div>
          ) : (
            <div className="ssh-key-empty">
              No SSH key found. Generate one to get started.
            </div>
          )}
        </div>

        {/* Connection Status */}
        <div className="settings-card">
          <div className="settings-card-header">
            <h3>GitHub Connection</h3>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleTest}
              disabled={testing || !keyExists}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
          {testResult && (
            <div className={`ssh-test-result ${testResult.success ? 'success' : 'failure'}`}>
              <span className={`ssh-status-dot ${testResult.success ? 'connected' : 'disconnected'}`}></span>
              {testResult.success ? (
                <span>Connected as <strong>{testResult.username}</strong></span>
              ) : (
                <span>{testResult.error}</span>
              )}
            </div>
          )}
          {!testResult && !testing && (
            <div className="ssh-test-hint">
              Click "Test Connection" to verify your SSH key is added to GitHub.
            </div>
          )}
        </div>

        {/* Regenerate Key */}
        <div className="settings-card">
          <div className="settings-card-header">
            <h3>Regenerate Key</h3>
            {!confirmRegen ? (
              <button
                className="btn btn-sm btn-danger"
                onClick={() => setConfirmRegen(true)}
              >
                Regenerate
              </button>
            ) : (
              <div className="settings-card-actions">
                <button
                  className="btn btn-sm btn-danger"
                  onClick={handleRegenerate}
                  disabled={regenerating}
                >
                  {regenerating ? 'Generating...' : 'Confirm'}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setConfirmRegen(false)}
                  disabled={regenerating}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {confirmRegen && (
            <div className="alert alert-error" style={{ margin: '8px 0 0 0' }}>
              This will replace the current SSH key. You will need to re-add the new key to GitHub.
            </div>
          )}
          <div className="ssh-regen-hint">
            Generates a new Ed25519 SSH key pair. The previous key will be permanently deleted.
          </div>
        </div>

        {/* Instructions */}
        <div className="settings-card">
          <h3 style={{ marginBottom: '12px' }}>Add Key to GitHub</h3>
          <div className="ssh-instructions">
            <ol>
              <li>Copy the SSH public key above</li>
              <li>Go to <a href="https://github.com/settings/keys" target="_blank" rel="noopener noreferrer">GitHub &rarr; Settings &rarr; SSH and GPG keys</a></li>
              <li>Click <strong>New SSH key</strong></li>
              <li>Set a title (e.g. "VPS Core") and paste the key</li>
              <li>Click <strong>Add SSH key</strong></li>
              <li>Come back here and click "Test Connection" to verify</li>
            </ol>
          </div>
        </div>
      </div>
      {/* API Keys Section */}
      <div className="settings-section" style={{ marginTop: '32px' }}>
        <div className="settings-section-header">
          <h2 className="settings-section-title">API Keys</h2>
          <div className="settings-section-desc">
            Configure API keys for AI features (campaigns, image generation).
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <h3>OpenAI API Key</h3>
            <span style={{
              fontSize: '12px',
              padding: '2px 10px',
              borderRadius: '10px',
              background: apiKeys.openai?.configured ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: apiKeys.openai?.configured ? 'var(--success)' : 'var(--danger)',
            }}>
              {apiKeys.openai?.configured ? 'Configured' : 'Not set'}
            </span>
          </div>
          {apiKeys.openai?.configured && (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Current: {apiKeys.openai.masked}
            </div>
          )}
          <input
            type="password"
            placeholder="sk-proj-..."
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', background: 'var(--bg-input)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text)', fontSize: '13px', outline: 'none',
            }}
          />
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <h3>Google AI API Key</h3>
            <span style={{
              fontSize: '12px',
              padding: '2px 10px',
              borderRadius: '10px',
              background: apiKeys.googleAi?.configured ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: apiKeys.googleAi?.configured ? 'var(--success)' : 'var(--danger)',
            }}>
              {apiKeys.googleAi?.configured ? 'Configured' : 'Not set'}
            </span>
          </div>
          {apiKeys.googleAi?.configured && (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Current: {apiKeys.googleAi.masked}
            </div>
          )}
          <input
            type="password"
            placeholder="AIzaSy..."
            value={googleAiKey}
            onChange={(e) => setGoogleAiKey(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', background: 'var(--bg-input)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text)', fontSize: '13px', outline: 'none',
            }}
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={handleSaveApiKeys}
          disabled={savingKeys || (!openaiKey && !googleAiKey)}
          style={{ marginTop: '8px' }}
        >
          {savingKeys ? 'Saving...' : keysSaved ? 'Saved!' : 'Save API Keys'}
        </button>
      </div>
    </div>
  );
}
