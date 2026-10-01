import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AuthModal from '../components/AuthModal.jsx';
import UserMenu from '../components/UserMenu.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { storage } from '../lib/storage.js';
import { extractVideoId } from '../lib/youtube.js';

/** Accepts a bare code ("K7PQ2M") or a full invite link (".../room/K7PQ2M"). */
function parseRoomCode(input) {
  const value = input.trim();
  const fromLink = value.match(/\/room\/([A-Za-z0-9]{4,12})/);
  const code = (fromLink ? fromLink[1] : value).toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

export default function Home() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const inviteCode = searchParams.get('join')?.toUpperCase() ?? '';

  const [roomName, setRoomName] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [roomCode, setRoomCode] = useState(inviteCode);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  // Only logged-in users can create/join. If a guest tries, we ask them to log in
  // and then finish what they started (`pending`).
  const [authMode, setAuthMode] = useState(null); // 'login' | 'signup' | null
  const [pending, setPending] = useState(inviteCode ? 'join' : null); // 'create' | 'join' | null

  // Opened from an invite link while logged out (/?join=CODE): ask to log in first.
  useEffect(() => {
    if (inviteCode && !user) {
      setError(`Log in or sign up to join room ${inviteCode}.`);
      setAuthMode('login');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRoom = async () => {
    const cleanRoomName = roomName.trim();
    if (cleanRoomName.length < 2) {
      setError('Please enter a room name (at least 2 characters).');
      return;
    }
    if (videoUrl.trim() && !extractVideoId(videoUrl)) {
      setError('That starting video is not a valid YouTube link.');
      return;
    }
    setBusy('create');
    try {
      const room = await api.createRoom({ roomName: cleanRoomName, videoUrl: videoUrl.trim() || undefined });
      storage.setToken(room.roomId, room.token); // this token makes us the Host
      navigate(`/room/${room.roomId}`);
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };

  const joinRoom = async () => {
    const code = parseRoomCode(roomCode);
    if (!code) {
      setError('Enter a valid room code or invite link.');
      return;
    }
    setBusy('join');
    try {
      await api.getRoom(code);
      navigate(`/room/${code}`);
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };

  const submit = (action) => (e) => {
    e.preventDefault();
    setError('');
    if (!user) {
      setPending(action);
      setError(`Please log in or sign up to ${action === 'create' ? 'create' : 'join'} a room.`);
      setAuthMode('login');
      return;
    }
    if (action === 'create') createRoom();
    else joinRoom();
  };

  // Right after logging in, continue the create/join the user was trying to do.
  useEffect(() => {
    if (!user || !pending) return;
    const action = pending;
    setPending(null);
    setError('');
    if (inviteCode) setSearchParams({}, { replace: true });
    if (action === 'create') createRoom();
    else joinRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const closeAuth = () => {
    setAuthMode(null);
    if (!user) setPending(null);
  };

  return (
    <div className="home">
      <header className="home-nav">
        <Logo />
        <UserMenu />
      </header>

      <main className="home-main">
        <section className="hero">
          <span className="eyebrow">Real-time · Synced · Together</span>
          <h1>
            Watch YouTube <span className="gradient-text">together</span>, perfectly in sync.
          </h1>
          <p>
            Create a room, share the link, and every play, pause and seek happens for everyone at the same moment.
            Hosts stay in control with roles and approvals.
          </p>
          <ul className="feature-list">
            <li>⚡ WebSocket sync</li>
            <li>👑 Host &amp; moderator roles</li>
            <li>✋ Approval requests</li>
            <li>💬 Live chat &amp; reactions</li>
          </ul>
        </section>

        <section className="home-card">
          {user ? (
            <div className="signed-in">
              <span className="signed-in-check" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>Signed in as {user.name}</strong>
                <span className="muted">{user.email}</span>
              </div>
            </div>
          ) : (
            <div className="auth-gate">
              <strong>🔒 Log in to start watching</strong>
              <span className="muted">You need an account to create or join a watch party.</span>
              <div className="auth-gate-buttons">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAuthMode('login')}>
                  Log in
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setAuthMode('signup')}>
                  Sign up
                </button>
              </div>
            </div>
          )}

          <form className="home-form" onSubmit={submit('create')}>
            <h2>Start a watch party</h2>
            <label className="field">
              <span>
                Room name <span className="required">*</span>
              </span>
              <input
                type="text"
                value={roomName}
                required
                minLength={2}
                maxLength={40}
                placeholder="Friday movie night"
                onChange={(e) => setRoomName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Starting video (optional)</span>
              <input
                type="text"
                value={videoUrl}
                placeholder="https://www.youtube.com/watch?v=…"
                onChange={(e) => setVideoUrl(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-primary btn-block" disabled={Boolean(busy)}>
              {busy === 'create' ? 'Creating…' : user ? 'Create room' : '🔒 Log in to create room'}
            </button>
          </form>

          <div className="divider">
            <span>or join one</span>
          </div>

          <form className="home-form" onSubmit={submit('join')}>
            <div className="input-with-button">
              <input
                type="text"
                value={roomCode}
                placeholder="Room code or invite link"
                aria-label="Room code or invite link"
                onChange={(e) => setRoomCode(e.target.value)}
              />
              <button type="submit" className="btn btn-secondary" disabled={Boolean(busy)}>
                {busy === 'join' ? 'Joining…' : user ? 'Join' : '🔒 Join'}
              </button>
            </div>
          </form>

          {error && <p className="form-error">{error}</p>}
        </section>
      </main>

      {authMode && <AuthModal mode={authMode} onClose={closeAuth} />}
    </div>
  );
}

export function Logo() {
  return (
    <a className="logo" href="/">
      <span className="logo-mark" aria-hidden="true">
        ▶
      </span>
      WatchParty
    </a>
  );
}
