import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from './Toasts.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Log in / Sign up dialog. `mode` is 'login' or 'signup'. */
export default function AuthModal({ mode: initialMode, onClose }) {
  const { login, signup } = useAuth();
  const { notify } = useToast();
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const firstField = useRef(null);
  const isSignup = mode === 'signup';

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onClose]);

  const update = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (error) setError('');
  };

  const validate = () => {
    if (isSignup && !form.name.trim()) return 'Please enter your name.';
    if (isSignup && form.name.trim().length > 24) return 'Name must be at most 24 characters.';
    if (!EMAIL_RE.test(form.email.trim())) return 'Please enter a valid email address.';
    if (form.password.length < 6) return 'Password must be at least 6 characters.';
    if (isSignup && form.password !== form.confirm) return 'Passwords do not match.';
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const credentials = { email: form.email.trim(), password: form.password };
      const session = isSignup ? await signup({ ...credentials, name: form.name.trim() }) : await login(credentials);
      notify(isSignup ? `Welcome, ${session.user.name}! Your account is ready.` : `Welcome back, ${session.user.name}!`, 'success');
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(isSignup ? 'login' : 'signup');
    setError('');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal card" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>

        <div className="modal-head">
          <span className="modal-mark" aria-hidden="true">
            <Icon name="play" size={16} />
          </span>
          <h2 id="auth-title">{isSignup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="muted">
            {isSignup
              ? 'Sign up to keep your name and host role on any device.'
              : 'Log in to continue to your watch parties.'}
          </p>
        </div>

        <div className="auth-switch" role="tablist">
          <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup ? 'active' : ''} onClick={() => isSignup && switchMode()}>
            Log in
          </button>
          <button type="button" role="tab" aria-selected={isSignup} className={isSignup ? 'active' : ''} onClick={() => !isSignup && switchMode()}>
            Sign up
          </button>
        </div>

        {isSignup && (
          <label className="field">
            <span>Full name</span>
            <input
              ref={firstField}
              type="text"
              value={form.name}
              maxLength={24}
              autoComplete="name"
              placeholder="e.g. Priya Sharma"
              onChange={update('name')}
            />
          </label>
        )}

        <label className="field">
          <span>Email</span>
          <input
            ref={isSignup ? undefined : firstField}
            type="email"
            value={form.email}
            autoComplete="email"
            placeholder="you@example.com"
            onChange={update('email')}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={form.password}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
            onChange={update('password')}
          />
        </label>

        {isSignup && (
          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              value={form.confirm}
              autoComplete="new-password"
              placeholder="Repeat your password"
              onChange={update('confirm')}
            />
          </label>
        )}

        {error && <p className="form-error">{error}</p>}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
        </button>

        <p className="modal-foot muted">
          {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button type="button" className="link-btn" onClick={switchMode}>
            {isSignup ? 'Log in' : 'Sign up'}
          </button>
        </p>
      </form>
    </div>
  );
}
