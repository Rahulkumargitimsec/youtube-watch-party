import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthModal from '../components/AuthModal.jsx';
import Icon, { ROLE_ICON } from '../components/Icons.jsx';
import UserMenu from '../components/UserMenu.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_LABELS, timeAgo } from '../lib/format.js';
import { storage } from '../lib/storage.js';
import { extractVideoId, thumbnailUrl } from '../lib/youtube.js';

const SAMPLE_VIDEO = 'https://www.youtube.com/watch?v=U0EI7XFkkV4'; // project's default video

/** Accepts a bare code ("K7PQ2M") or a full invite link (".../room/K7PQ2M"). */
function parseRoomCode(input) {
  const value = input.trim();
  const fromLink = value.match(/\/room\/([A-Za-z0-9]{4,12})/);
  const code = (fromLink ? fromLink[1] : value).toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

const ROLES = [
  {
    role: 'host',
    text: 'Controls playback and manages the room: assigns roles, removes people and can transfer host.',
    can: ['Play, pause and seek', 'Change video', 'Approve requests', 'Manage roles'],
  },
  {
    role: 'moderator',
    text: 'Controls playback and approves requests, but can’t change anyone’s role.',
    can: ['Play, pause and seek', 'Change video', 'Approve requests'],
  },
  {
    role: 'participant',
    text: 'Can request play, pause, seek or a new video. A host or moderator approves it.',
    can: ['Request changes', 'Chat and react'],
  },
  {
    role: 'viewer',
    text: 'Watches in sync. Can chat and react, but can’t request changes.',
    can: ['Watch in sync', 'Chat and react'],
  },
];

export default function Home() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const inviteCode = searchParams.get('join')?.toUpperCase() ?? '';

  const [tab, setTab] = useState(inviteCode ? 'join' : 'create');
  const [roomName, setRoomName] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [roomCode, setRoomCode] = useState(inviteCode);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState(() => storage.getRecentRooms());
  // Only logged-in users can create/join. If a guest tries, we ask them to log in
  // and then finish what they started (`pending`).
  const [authMode, setAuthMode] = useState(null); // 'login' | 'signup' | null
  const [pending, setPending] = useState(inviteCode ? 'join' : null); // 'create' | 'join' | null

  const previewId = extractVideoId(videoUrl);

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

  const joinRoom = async (codeInput = roomCode) => {
    const code = parseRoomCode(codeInput);
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

  const switchTab = (next) => {
    setTab(next);
    setError('');
  };

  const forget = (roomId) => {
    storage.forgetRoom(roomId);
    setRecent(storage.getRecentRooms());
  };

  return (
    <div className="home">
      <header className="home-nav">
        <Logo />
        <nav className="home-links" aria-label="Sections">
          <a href="#roles">Roles</a>
        </nav>
        <UserMenu />
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>Watch YouTube together, in sync.</h1>
            <p className="hero-sub">
              Create a room, share the code, and everyone sees the same moment of the same video. The host controls
              playback; everyone else can chat, react and request changes.
            </p>
            <ul className="hero-points">
              <li>
                <Icon name="check" size={16} /> Play, pause and seek sync for everyone
              </li>
              <li>
                <Icon name="check" size={16} /> Host, moderator, participant and viewer roles
              </li>
              <li>
                <Icon name="check" size={16} /> Requests the host can approve or decline
              </li>
            </ul>
          </div>

          <section className="action-card" aria-label="Start or join a watch party">
            {user ? (
              <div className="account-strip">
                <Icon name="check" size={16} />
                <span>
                  Signed in as <strong>{user.name}</strong>
                </span>
              </div>
            ) : (
              <div className="account-strip is-guest">
                <Icon name="lock" size={16} />
                <span>Sign in to create or join rooms.</span>
                <button type="button" className="link-btn" onClick={() => setAuthMode('signup')}>
                  Create account
                </button>
              </div>
            )}

            <div className="segmented" role="tablist" aria-label="Choose an action">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'create'}
                className={tab === 'create' ? 'active' : ''}
                onClick={() => switchTab('create')}
              >
                <Icon name="plus" size={15} /> Start a party
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'join'}
                className={tab === 'join' ? 'active' : ''}
                onClick={() => switchTab('join')}
              >
                <Icon name="arrowRight" size={15} /> Join with code
              </button>
              <span className="segmented-thumb" data-tab={tab} aria-hidden="true" />
            </div>

            {tab === 'create' ? (
              <form className="home-form" onSubmit={submit('create')}>
                <label className="field">
                  <span>Room name</span>
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
                  <span className="field-row">
                    Starting video <em>optional</em>
                    {!videoUrl && (
                      <button type="button" className="link-btn" onClick={() => setVideoUrl(SAMPLE_VIDEO)}>
                        Use a sample
                      </button>
                    )}
                  </span>
                  <input
                    type="text"
                    inputMode="url"
                    value={videoUrl}
                    placeholder="Paste a YouTube link"
                    onChange={(e) => setVideoUrl(e.target.value)}
                  />
                </label>
                {previewId && (
                  <div className="video-chip">
                    <img src={thumbnailUrl(previewId, 'default')} alt="" />
                    <span>
                      <strong>Video ready</strong>
                      <code>{previewId}</code>
                    </span>
                    <Icon name="check" size={16} className="video-chip-ok" />
                  </div>
                )}
                <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={Boolean(busy)}>
                  {busy === 'create' ? (
                    'Opening room…'
                  ) : (
                    <>
                      {user ? 'Create room' : 'Sign in & create room'} <Icon name="arrowRight" size={17} />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form className="home-form" onSubmit={submit('join')}>
                <label className="field">
                  <span>Room code or invite link</span>
                  <input
                    type="text"
                    className="code-input"
                    value={roomCode}
                    placeholder="K7PQ2M"
                    autoCapitalize="characters"
                    spellCheck={false}
                    onChange={(e) => setRoomCode(e.target.value)}
                  />
                </label>
                <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={Boolean(busy)}>
                  {busy === 'join' ? (
                    'Joining…'
                  ) : (
                    <>
                      {user ? 'Join room' : 'Sign in & join'} <Icon name="arrowRight" size={17} />
                    </>
                  )}
                </button>
              </form>
            )}

            {error && (
              <p className="form-error" role="alert">
                <Icon name="alert" size={15} /> {error}
              </p>
            )}

            {user && recent.length > 0 && (
              <div className="recent">
                <span className="recent-title">Jump back in</span>
                <ul>
                  {recent.slice(0, 3).map((r) => (
                    <li key={r.roomId}>
                      <button type="button" className="recent-room" onClick={() => joinRoom(r.roomId)}>
                        <span className="recent-thumb">
                          {r.videoId ? <img src={thumbnailUrl(r.videoId, 'default')} alt="" /> : <Icon name="film" />}
                        </span>
                        <span className="recent-text">
                          <strong>{r.name || r.roomId}</strong>
                          <span>
                            <code>{r.roomId}</code>
                            {r.role && ` · ${ROLE_LABELS[r.role]}`} · {timeAgo(r.ts)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn recent-forget"
                        aria-label={`Forget ${r.name || r.roomId}`}
                        onClick={() => forget(r.roomId)}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </section>

        <section className="roles" id="roles">
          <h2>Roles and permissions</h2>
          <p className="section-sub">Every action is checked on the server, so the rules hold for everyone in the room.</p>
          <div className="role-grid">
            {ROLES.map((r) => (
              <article key={r.role} className={`role-card role-card-${r.role}`}>
                <span className="role-card-icon">
                  <Icon name={ROLE_ICON[r.role]} size={20} />
                </span>
                <h3>{ROLE_LABELS[r.role]}</h3>
                <p>{r.text}</p>
                <ul>
                  {r.can.map((c) => (
                    <li key={c}>
                      <Icon name="check" size={13} /> {c}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

      </main>

      <footer className="home-footer">
        <Logo />
        <span>© {new Date().getFullYear()} WatchParty</span>
      </footer>

      {authMode && <AuthModal mode={authMode} onClose={closeAuth} />}
    </div>
  );
}

export function Logo({ compact = false }) {
  return (
    <Link className="logo" to="/" aria-label="WatchParty home">
      <span className="logo-mark" aria-hidden="true">
        <Icon name="play" size={13} />
      </span>
      {!compact && <span className="logo-word">WatchParty</span>}
    </Link>
  );
}
