import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import usePresence from '../hooks/usePresence';

const styles = {
  page: { padding: '24px', maxWidth: '1200px', margin: '0 auto' },
  header: { marginBottom: '28px' },
  title: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.3px', marginBottom: '6px' },
  subtitle: { color: 'var(--text-muted)', fontSize: '14px' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '24px', background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', padding: '4px', border: '1px solid var(--border)', width: 'fit-content' },
  tab: (active) => ({ padding: '8px 20px', borderRadius: 'var(--radius-xs)', border: 'none', background: active ? 'var(--primary)' : 'transparent', color: active ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', fontWeight: 500, fontFamily: 'inherit', transition: 'all var(--transition)' }),
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: '13px' },
  badge: (color) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: color === 'green' ? 'var(--success-glow)' : color === 'red' ? 'var(--danger-glow)' : color === 'yellow' ? 'var(--warning-glow)' : 'var(--primary-glow)', color: color === 'green' ? 'var(--success)' : color === 'red' ? 'var(--danger)' : color === 'yellow' ? 'var(--warning)' : 'var(--primary)' }),
  actionBtn: { padding: '5px 12px', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text)', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', transition: 'all var(--transition)', marginRight: '6px' },
  inviteForm: { display: 'flex', gap: '12px', padding: '20px', borderBottom: '1px solid var(--border)', alignItems: 'flex-end', flexWrap: 'wrap' },
  formField: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' },
  input: { padding: '8px 14px', background: 'var(--bg-input)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-xs)', color: 'var(--text)', fontSize: '13px', fontFamily: 'inherit', outline: 'none', minWidth: '240px' },
  select: { padding: '8px 14px', background: 'var(--bg-input)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-xs)', color: 'var(--text)', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  alert: (type) => ({ padding: '10px 16px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '13px', background: type === 'error' ? 'var(--danger-glow)' : 'var(--success-glow)', color: type === 'error' ? 'var(--danger)' : 'var(--success)', border: `1px solid ${type === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}` }),
  presenceDot: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', display: 'inline-block', marginRight: '8px', boxShadow: '0 0 6px var(--success)' },
  emptyState: { padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' },
};

function StatusBadge({ status }) {
  const color = status === 'active' ? 'green' : status === 'pending' ? 'yellow' : status === 'accepted' ? 'green' : status === 'expired' ? 'red' : status === 'revoked' ? 'red' : status === 'deactivated' ? 'red' : 'blue';
  return <span style={styles.badge(color)}>{status}</span>;
}

function RoleBadge({ role }) {
  const color = role === 'admin' ? 'blue' : 'green';
  return <span style={styles.badge(color)}>{role}</span>;
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminBackoffice() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [emailSettings, setEmailSettings] = useState({ resendApiKey: '', fromEmail: '', configured: false });
  const [editFromEmail, setEditFromEmail] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const { onlineUsers } = usePresence();

  const onlineUserIds = new Set(onlineUsers.map(u => u.userId));

  const fetchData = useCallback(async () => {
    try {
      const [usersData, invData, emailData] = await Promise.all([
        api('/api/admin/users'),
        api('/api/admin/invitations'),
        api('/api/admin/email-settings')
      ]);
      setUsers(usersData);
      setInvitations(invData);
      setEmailSettings(emailData);
      setEditFromEmail(emailData.fromEmail || '');
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const showMsg = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleToggleStatus = async (user) => {
    const newStatus = user.status === 'active' ? 'deactivated' : 'active';
    try {
      await api(`/api/admin/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
      showMsg('success', `User ${user.email} ${newStatus}`);
      fetchData();
    } catch (err) {
      showMsg('error', err.message);
    }
  };

  const handleChangeRole = async (user, newRole) => {
    try {
      await api(`/api/admin/users/${user.id}/role`, { method: 'PATCH', body: JSON.stringify({ role: newRole }) });
      showMsg('success', `Role updated to ${newRole}`);
      fetchData();
    } catch (err) {
      showMsg('error', err.message);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const data = await api('/api/admin/invitations', { method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole }) });
      showMsg('success', `Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      setInviteRole('member');
      fetchData();
    } catch (err) {
      showMsg('error', err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async (id) => {
    try {
      await api(`/api/admin/invitations/${id}`, { method: 'DELETE' });
      showMsg('success', 'Invitation revoked');
      fetchData();
    } catch (err) {
      showMsg('error', err.message);
    }
  };

  const handleSaveEmailSettings = async (e) => {
    e.preventDefault();
    setSavingEmail(true);
    try {
      const body = { fromEmail: editFromEmail };
      if (editApiKey) body.resendApiKey = editApiKey;
      await api('/api/admin/email-settings', { method: 'PUT', body: JSON.stringify(body) });
      showMsg('success', 'Email settings updated');
      setEditApiKey('');
      fetchData();
    } catch (err) {
      showMsg('error', err.message);
    } finally {
      setSavingEmail(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Admin Backoffice</h1>
        <p style={styles.subtitle}>Manage users, invitations, and monitor activity</p>
      </div>

      {message && <div style={styles.alert(message.type)}>{message.text}</div>}

      <div style={styles.tabs}>
        <button style={styles.tab(activeTab === 'users')} onClick={() => setActiveTab('users')}>Users ({users.length})</button>
        <button style={styles.tab(activeTab === 'invitations')} onClick={() => setActiveTab('invitations')}>Invitations ({invitations.length})</button>
        <button style={styles.tab(activeTab === 'email')} onClick={() => setActiveTab('email')}>Email</button>
      </div>

      {activeTab === 'users' && (
        <div style={styles.card}>
          {loading ? (
            <div style={styles.emptyState}>Loading users...</div>
          ) : users.length === 0 ? (
            <div style={styles.emptyState}>No users found</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>User</th>
                    <th style={styles.th}>Role</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Last Login</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id}>
                      <td style={styles.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {onlineUserIds.has(user.id) && <span style={styles.presenceDot} />}
                          <div>
                            <div style={{ fontWeight: 500 }}>
                              {user.first_name || user.last_name ? `${user.first_name} ${user.last_name}`.trim() : '—'}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={styles.td}><RoleBadge role={user.role} /></td>
                      <td style={styles.td}><StatusBadge status={user.status} /></td>
                      <td style={styles.td}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{formatDate(user.last_login_at)}</span>
                      </td>
                      <td style={styles.td}>
                        <button
                          style={{ ...styles.actionBtn, ...(user.status === 'active' ? { borderColor: 'rgba(239,68,68,0.3)', color: 'var(--danger)' } : { borderColor: 'rgba(16,185,129,0.3)', color: 'var(--success)' }) }}
                          onClick={() => handleToggleStatus(user)}
                        >
                          {user.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                        <select
                          value={user.role}
                          onChange={(e) => handleChangeRole(user, e.target.value)}
                          style={{ ...styles.select, padding: '5px 8px', fontSize: '12px' }}
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'invitations' && (
        <div style={styles.card}>
          <form onSubmit={handleInvite} style={styles.inviteForm}>
            <div style={{ ...styles.formField, flex: 1 }}>
              <label style={styles.label}>Email Address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                required
                style={styles.input}
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.label}>Role</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={styles.select}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={inviting} style={{ height: '37px' }}>
              {inviting ? 'Sending...' : 'Send Invitation'}
            </button>
          </form>

          {loading ? (
            <div style={styles.emptyState}>Loading invitations...</div>
          ) : invitations.length === 0 ? (
            <div style={styles.emptyState}>No invitations yet</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Email</th>
                    <th style={styles.th}>Role</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Created</th>
                    <th style={styles.th}>Expires</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map(inv => (
                    <tr key={inv.id}>
                      <td style={styles.td}>{inv.email}</td>
                      <td style={styles.td}><RoleBadge role={inv.role} /></td>
                      <td style={styles.td}><StatusBadge status={inv.status} /></td>
                      <td style={styles.td}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{formatDate(inv.created_at)}</span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{formatDate(inv.expires_at)}</span>
                      </td>
                      <td style={styles.td}>
                        {inv.status === 'pending' && (
                          <button
                            style={{ ...styles.actionBtn, borderColor: 'rgba(239,68,68,0.3)', color: 'var(--danger)' }}
                            onClick={() => handleRevoke(inv.id)}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'email' && (
        <div style={styles.card}>
          <form onSubmit={handleSaveEmailSettings} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '500px' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Resend Email Configuration</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Configure the email service used for sending invitation emails.</p>
            </div>

            <div style={styles.formField}>
              <label style={styles.label}>Status</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: emailSettings.configured ? 'var(--success)' : 'var(--danger)' }} />
                <span style={{ fontSize: '13px', color: emailSettings.configured ? 'var(--success)' : 'var(--danger)' }}>
                  {emailSettings.configured ? 'Configured' : 'Not configured'}
                </span>
                {emailSettings.configured && (
                  <span style={{ fontSize: '12px', color: 'var(--text-dim)', marginLeft: '8px' }}>Key: {emailSettings.resendApiKey}</span>
                )}
              </div>
            </div>

            <div style={styles.formField}>
              <label style={styles.label}>Sender Email (From)</label>
              <input
                type="text"
                value={editFromEmail}
                onChange={(e) => setEditFromEmail(e.target.value)}
                placeholder="NextTerm <noreply@flowser.eu>"
                style={styles.input}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Format: Name &lt;email@domain&gt; — The domain must be verified in Resend.</span>
            </div>

            <div style={styles.formField}>
              <label style={styles.label}>Resend API Key (leave empty to keep current)</label>
              <input
                type="password"
                value={editApiKey}
                onChange={(e) => setEditApiKey(e.target.value)}
                placeholder="re_xxxxxxxxx..."
                style={styles.input}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={savingEmail} style={{ alignSelf: 'flex-start' }}>
              {savingEmail ? 'Saving...' : 'Save Email Settings'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
