import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function SetPassword() {
  const { token } = useParams();

  const [isValidating, setIsValidating] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [invitation, setInvitation] = useState({ email: '', role: '' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const validateToken = async () => {
      try {
        const response = await fetch(`/api/auth/validate-invitation/${token}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'The invitation link is invalid or has expired.');
        }
        setInvitation({ email: data.email, role: data.role });
      } catch (err) {
        setError(err.message);
      } finally {
        setIsValidating(false);
      }
    };

    if (token) {
      validateToken();
    } else {
      setError('No invitation token provided.');
      setIsValidating(false);
    }
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to accept invitation.');
      }
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (isValidating) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div className="login-header">
            <div className="login-icon" style={{ fontSize: '20px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <h1>Verifying invitation...</h1>
            <p>Please wait while we validate your link</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state (invalid/expired)
  if (error && !invitation.email && !success) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <div className="login-icon" style={{ background: 'linear-gradient(135deg, var(--danger), #dc2626)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </div>
            <h1>Invalid Invitation</h1>
            <p>This link may be expired or already used</p>
          </div>
          <div className="alert alert-error" style={{ marginBottom: '20px' }}>{error}</div>
          <Link to="/login" className="btn btn-primary btn-full" style={{ textDecoration: 'none', textAlign: 'center', display: 'block' }}>
            Return to Login
          </Link>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <div className="login-icon" style={{ background: 'linear-gradient(135deg, var(--success), #059669)', boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h1>Account Created</h1>
            <p>Your password has been set successfully</p>
          </div>
          <div className="alert alert-success" style={{ marginBottom: '20px' }}>
            Welcome to NextTerm! You can now sign in with your new credentials.
          </div>
          <Link to="/login" className="btn btn-primary btn-full" style={{ textDecoration: 'none', textAlign: 'center', display: 'block' }}>
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  // Form state
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <h1>Create Your Password</h1>
          <p>Setting up your account for <strong style={{ color: 'var(--text)' }}>{invitation.email}</strong></p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input type="text" value={invitation.email} readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} />
          </div>

          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              placeholder="Minimum 6 characters"
              required
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              placeholder="Re-type your password"
              required
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(null); }}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account...' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
