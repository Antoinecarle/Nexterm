import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, LogOut, Trash2, Save, Key, Bell, User, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api, getToken, clearToken } from '../api';

const AccountPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [profile, setProfile] = useState({
    firstName: '',
    lastName: '',
    email: '',
    hasAvatar: false,
    notifications: {
      email: false,
      security: false,
      updates: false,
      maintenance: false
    }
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [avatarUrl, setAvatarUrl] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const data = await api('/api/account/profile');
      setProfile(data);
      if (data.hasAvatar) {
        fetchAvatar();
      }
      setLoading(false);
    } catch (err) {
      showToast('error', 'Failed to load profile data');
      setLoading(false);
    }
  };

  const fetchAvatar = async () => {
    try {
      const response = await fetch('/api/account/avatar?t=' + Date.now(), {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (response.ok) {
        const blob = await response.blob();
        setAvatarUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      console.error('Avatar fetch failed', err);
    }
  };

  const showToast = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setSubmitting('profile');
    try {
      await api('/api/account/profile', {
        method: 'PUT',
        body: JSON.stringify({
          firstName: profile.firstName,
          lastName: profile.lastName
        })
      });
      showToast('success', 'Profile updated successfully');
    } catch (err) {
      showToast('error', 'Failed to update profile');
    } finally {
      setSubmitting(null);
    }
  };

  const handleNotificationToggle = async (key) => {
    const prev = profile.notifications;
    const updatedNotifications = { ...prev, [key]: !prev[key] };

    setProfile(p => ({ ...p, notifications: updatedNotifications }));

    try {
      await api('/api/account/notifications', {
        method: 'PUT',
        body: JSON.stringify({ notifications: updatedNotifications })
      });
    } catch (err) {
      showToast('error', 'Failed to update notification preferences');
      setProfile(p => ({ ...p, notifications: prev }));
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showToast('error', 'Image must be less than 2MB');
      return;
    }

    setSubmitting('avatar');
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        await api('/api/account/avatar', {
          method: 'POST',
          body: JSON.stringify({ avatar: reader.result })
        });
        showToast('success', 'Avatar updated');
        fetchAvatar();
        setProfile(p => ({ ...p, hasAvatar: true }));
      } catch (err) {
        showToast('error', 'Failed to upload avatar');
      } finally {
        setSubmitting(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteAvatar = async () => {
    if (!window.confirm('Delete your profile picture?')) return;
    try {
      await api('/api/account/avatar', { method: 'DELETE' });
      setAvatarUrl(null);
      setProfile(p => ({ ...p, hasAvatar: false }));
      showToast('success', 'Avatar removed');
    } catch (err) {
      showToast('error', 'Failed to delete avatar');
    }
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast('error', 'New passwords do not match');
      return;
    }

    setSubmitting('password');
    try {
      await api('/api/account/password', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      });
      showToast('success', 'Password updated successfully');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      showToast('error', err.message || 'Failed to update password');
    } finally {
      setSubmitting(null);
    }
  };

  const handleSignOut = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  const toggleStyle = (active) => ({
    width: '36px',
    height: '20px',
    borderRadius: '20px',
    backgroundColor: active ? 'var(--primary)' : 'var(--bg-input)',
    border: `1px solid ${active ? 'var(--primary)' : 'var(--border-light)'}`,
    position: 'relative',
    cursor: 'pointer',
    transition: 'var(--transition)',
    flexShrink: 0
  });

  const toggleThumbStyle = (active) => ({
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    backgroundColor: '#fff',
    position: 'absolute',
    top: '2px',
    left: active ? '18px' : '2px',
    transition: 'var(--transition)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
  });

  return (
    <div className="page">
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <header style={{ marginBottom: '32px' }}>
          <h1 className="page-title">Account Settings</h1>
          <p className="page-subtitle">Manage your profile, security preferences, and account details.</p>
        </header>

        {message.text && (
          <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {message.text}
          </div>
        )}

        {/* Profile Section */}
        <section className="settings-section">
          <div className="settings-card">
            <div className="settings-card-header" style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <User size={18} style={{ color: 'var(--primary)' }} />
                <h3>Personal Information</h3>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
              {/* Avatar Upload */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '96px',
                    height: '96px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--bg-input)',
                    border: '2px solid var(--border-light)',
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  onMouseEnter={(e) => { const o = e.currentTarget.querySelector('.avatar-overlay'); if (o) o.style.opacity = '1'; }}
                  onMouseLeave={(e) => { const o = e.currentTarget.querySelector('.avatar-overlay'); if (o) o.style.opacity = '0'; }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <User size={40} style={{ color: 'var(--text-dim)' }} />
                  )}
                  <div
                    className="avatar-overlay"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundColor: 'rgba(0,0,0,0.5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      transition: '0.2s ease'
                    }}
                  >
                    {submitting === 'avatar' ? <Loader2 size={20} className="animate-spin" style={{ color: '#fff' }} /> : <Camera size={20} color="white" />}
                  </div>
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleAvatarUpload}
                  accept="image/*"
                  style={{ display: 'none' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>JPG or PNG. Max 2MB.</span>
              </div>

              {/* Profile Form */}
              <form onSubmit={handleProfileUpdate} style={{ flex: 1, minWidth: '280px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div className="form-group">
                    <label>First Name</label>
                    <input
                      type="text"
                      value={profile.firstName}
                      onChange={(e) => setProfile({...profile, firstName: e.target.value})}
                      placeholder="Enter first name"
                    />
                  </div>
                  <div className="form-group">
                    <label>Last Name</label>
                    <input
                      type="text"
                      value={profile.lastName}
                      onChange={(e) => setProfile({...profile, lastName: e.target.value})}
                      placeholder="Enter last name"
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: '24px' }}>
                  <label>Email Address</label>
                  <input
                    type="email"
                    value={profile.email}
                    disabled
                    style={{ cursor: 'not-allowed', opacity: 0.7 }}
                  />
                  <small style={{ color: 'var(--text-dim)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                    Email address cannot be changed. Contact support for assistance.
                  </small>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={submitting === 'profile'}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  {submitting === 'profile' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Changes
                </button>
              </form>
            </div>
          </div>
        </section>

        {/* Notifications Section */}
        <section className="settings-section">
          <div className="settings-card">
            <div className="settings-card-header" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Bell size={18} style={{ color: 'var(--primary)' }} />
                <h3>Notification Preferences</h3>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', backgroundColor: 'var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              {[
                { id: 'email', label: 'Email Notifications', desc: 'Receive general account activity and summary reports via email.' },
                { id: 'security', label: 'Security Alerts', desc: 'Get notified about login attempts and password changes.' },
                { id: 'updates', label: 'Product Updates', desc: 'Be the first to know about new features and VPS performance upgrades.' },
                { id: 'maintenance', label: 'Maintenance Alerts', desc: 'Critical notifications about scheduled server maintenance.' }
              ].map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px',
                    backgroundColor: 'var(--bg-card-solid)',
                    transition: 'var(--transition)'
                  }}
                >
                  <div style={{ paddingRight: '20px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '2px' }}>{item.label}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{item.desc}</div>
                  </div>
                  <div
                    style={toggleStyle(profile.notifications[item.id])}
                    onClick={() => handleNotificationToggle(item.id)}
                  >
                    <div style={toggleThumbStyle(profile.notifications[item.id])} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Change Password */}
        <section className="settings-section">
          <div className="settings-card">
            <div className="settings-card-header" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Key size={18} style={{ color: 'var(--primary)' }} />
                <h3>Security</h3>
              </div>
            </div>

            <form onSubmit={handlePasswordUpdate} style={{ maxWidth: '400px' }}>
              <div className="form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                  autoComplete="current-password"
                />
              </div>
              <div className="form-group">
                <label>New Password</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label>Confirm New Password</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                  autoComplete="new-password"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={submitting === 'password'}
              >
                {submitting === 'password' ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="settings-section">
          <div
            className="settings-card"
            style={{
              border: '1px solid rgba(239, 68, 68, 0.2)',
              background: 'linear-gradient(to right, rgba(239, 68, 68, 0.03), transparent)'
            }}
          >
            <div className="settings-card-header" style={{ marginBottom: '20px' }}>
              <h3 style={{ color: 'var(--danger)', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Danger Zone</h3>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={handleSignOut}
                className="btn btn-sm"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <LogOut size={14} />
                Sign Out
              </button>

              {profile.hasAvatar && (
                <button
                  onClick={handleDeleteAvatar}
                  className="btn btn-danger btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Trash2 size={14} />
                  Delete Avatar
                </button>
              )}
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '16px' }}>
              Signing out will end your current session. Deleting your avatar is permanent and cannot be undone.
            </p>
          </div>
        </section>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        .alert-success {
          background: var(--success-glow);
          color: #6ee7b7;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }
      `}} />
    </div>
  );
};

export default AccountPage;
