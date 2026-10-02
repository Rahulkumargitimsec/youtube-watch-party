import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import AuthModal from './AuthModal.jsx';
import Icon from './Icons.jsx';
import { Avatar } from './ParticipantList.jsx';
import { useToast } from './Toasts.jsx';

/** Top-right account area: Log in / Sign up buttons, or the user's avatar menu. */
export default function UserMenu({ compact = false }) {
  const { user, logout } = useAuth();
  const { notify } = useToast();
  const [modal, setModal] = useState(null); // 'login' | 'signup' | null
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !menuRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!user) {
    return (
      <div className="auth-buttons">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal('login')}>
          Log in
        </button>
        {!compact && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal('signup')}>
            Sign up
          </button>
        )}
        {modal && <AuthModal mode={modal} onClose={() => setModal(null)} />}
      </div>
    );
  }

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={user.name} size={30} />
        {!compact && <span className="user-chip-name">{user.name}</span>}
        <svg className="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="user-dropdown card" role="menu">
          <div className="user-dropdown-head">
            <Avatar name={user.name} size={40} />
            <div>
              <strong>{user.name}</strong>
              <span className="muted">{user.email}</span>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="btn btn-ghost btn-block btn-sm"
            onClick={() => {
              logout();
              setOpen(false);
              notify('You have been logged out.', 'info');
            }}
          >
            <Icon name="logout" size={15} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
