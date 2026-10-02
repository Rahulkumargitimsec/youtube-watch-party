import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import Chat from '../components/Chat.jsx';
import Icon, { ROLE_ICON } from '../components/Icons.jsx';
import ParticipantList, { AvatarStack, RoleBadge } from '../components/ParticipantList.jsx';
import PlaybackControls from '../components/PlaybackControls.jsx';
import { ReactionBar, ReactionLayer } from '../components/Reactions.jsx';
import RequestsPanel from '../components/RequestsPanel.jsx';
import ShareMenu from '../components/ShareMenu.jsx';
import { useToast } from '../components/Toasts.jsx';
import VideoForm from '../components/VideoForm.jsx';
import YouTubePlayer from '../components/YouTubePlayer.jsx';
import { useWatchRoom } from '../hooks/useWatchRoom.js';
import { useAuth } from '../lib/auth.jsx';
import { describeSync } from '../lib/format.js';
import { thumbnailUrl } from '../lib/youtube.js';
import { Logo } from './Home.jsx';

const ROLE_HINT = {
  host: { title: 'You’re the host', text: 'You control playback, change videos, approve requests and manage roles.' },
  moderator: { title: 'You’re a moderator', text: 'You can control playback for everyone and approve requests.' },
  participant: {
    title: 'You’re a participant',
    text: 'Play, pause, seek and video changes are sent to the host as requests.',
  },
  viewer: { title: 'You’re a viewer', text: 'You can watch, chat and react.' },
};

export default function Room() {
  const { roomId: rawId } = useParams();
  const roomId = rawId.toUpperCase();
  const { user, token } = useAuth();

  // Rooms are for logged-in users only: send guests (e.g. opening an invite link)
  // to the home page, which asks them to log in and then joins this room.
  if (!user) return <Navigate to={`/?join=${roomId}`} replace />;
  return <RoomView roomId={roomId} username={user.name} authToken={token} />;
}

function RoomView({ roomId, username, authToken }) {
  const navigate = useNavigate();
  const room = useWatchRoom(roomId, username, authToken);
  const { status, self, role, can, actions, playback, participants, requests } = room;

  const playerRef = useRef(null);
  const [videoInfo, setVideoInfo] = useState({ title: '', duration: 0 });
  const [tab, setTab] = useState('chat');
  const [unread, setUnread] = useState(0);
  const [theater, setTheater] = useState(false);
  const lastSeenCount = useRef(0);

  // Unread badge for chat while the People tab is open (or the sidebar is hidden).
  const chatVisible = tab === 'chat' && !theater;
  useEffect(() => {
    const chatCount = room.messages.filter((m) => !m.system).length;
    if (chatVisible) {
      lastSeenCount.current = chatCount;
      setUnread(0);
    } else {
      setUnread(Math.max(0, chatCount - lastSeenCount.current));
    }
  }, [room.messages, chatVisible]);

  // Show the room name in the browser tab.
  useEffect(() => {
    if (!room.room?.name) return undefined;
    const previous = document.title;
    document.title = `${playback?.isPlaying ? '▶ ' : ''}${room.room.name} · WatchParty`;
    return () => {
      document.title = previous;
    };
  }, [room.room?.name, playback?.isPlaying]);

  const onInfo = useCallback((info) => setVideoInfo(info), []);

  // What the playback buttons do for this user's role.
  const mode = can('control_playback') ? 'control' : can('request_change') ? 'request' : 'none';
  const videoMode = can('change_video') ? 'control' : can('request_change') ? 'request' : 'none';

  const onPlay = () => (mode === 'control' ? actions.play() : actions.requestChange('play'));
  const onPause = () => (mode === 'control' ? actions.pause() : actions.requestChange('pause'));
  const onSeek = (time) => (mode === 'control' ? actions.seek(time) : actions.requestChange('seek', { time }));
  const onChangeVideo = (url, videoId) =>
    videoMode === 'control' ? actions.changeVideo(url) : actions.requestChange('change_video', { videoId });

  const leave = async () => {
    await actions.leave();
    navigate('/');
  };

  if (status === 'removed') {
    return (
      <StatusScreen icon="x" title="You were removed from this room" text="The host removed you from this watch party.">
        <Link className="btn btn-primary btn-block" to="/">
          Back to home
        </Link>
      </StatusScreen>
    );
  }

  if (status === 'error') {
    return (
      <StatusScreen icon="alert" title="Couldn't join the room" text={room.error}>
        <Link className="btn btn-primary btn-block" to="/">
          Back to home
        </Link>
      </StatusScreen>
    );
  }

  if (!self || !playback) {
    return (
      <StatusScreen title="Joining room…" text={`Syncing clocks with ${roomId}`}>
        <div className="spinner" aria-hidden="true" />
      </StatusScreen>
    );
  }

  const hint = ROLE_HINT[role];
  const lastAction = describeSync(playback.action);

  return (
    <div className={`room ${theater ? 'is-theater' : ''}`}>
      <header className="room-header">
        <Logo compact />
        <div className="room-title">
          <h1 title={room.room?.name}>{room.room?.name}</h1>
          <CopyCode code={roomId} />
        </div>
        <div className="room-header-right">
          <AvatarStack participants={participants} />
          <ConnectionPill status={status} latency={room.latency} />
          <ShareMenu roomId={roomId} roomName={room.room?.name} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={leave} title="Leave room">
            <Icon name="logout" size={15} /> <span className="hide-sm">Leave</span>
          </button>
        </div>
      </header>

      <main className="room-layout">
        <section className="stage">
          <div className="player-stage">
            <YouTubePlayer ref={playerRef} playback={playback} clockOffset={room.clockOffset} onInfo={onInfo}>
              <ReactionLayer reactions={room.reactions} />
            </YouTubePlayer>
          </div>

          <PlaybackControls
            playerRef={playerRef}
            playback={playback}
            clockOffset={room.clockOffset}
            duration={videoInfo.duration}
            mode={mode}
            theater={theater}
            onToggleTheater={() => setTheater((v) => !v)}
            onPlay={onPlay}
            onPause={onPause}
            onSeek={onSeek}
          />

          <RequestsPanel
            requests={requests}
            canResolve={can('resolve_requests')}
            selfId={self.userId}
            onResolve={actions.resolveRequest}
            onCancel={actions.cancelRequest}
          />

          <div className="now-playing">
            <img className="now-thumb" src={thumbnailUrl(playback.videoId)} alt="" />
            <div className="now-text">
              <span className={`now-state ${playback.isPlaying ? 'is-playing' : ''}`}>
                {playback.isPlaying ? (
                  <span className="eq" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <Icon name="pause" size={11} />
                )}
                {playback.isPlaying ? 'Now playing' : 'Paused'}
              </span>
              <h2 title={videoInfo.title}>{videoInfo.title || 'Loading video…'}</h2>
              {lastAction && <span className="now-last">{lastAction}</span>}
            </div>
            <ReactionBar options={room.reactionOptions} onReact={actions.react} />
          </div>

          <VideoForm mode={videoMode} onChange={onChangeVideo} />

          <div className={`role-card-inline role-inline-${role}`}>
            <span className="role-inline-icon">
              <Icon name={ROLE_ICON[role]} size={18} />
            </span>
            <div>
              <strong>
                {hint.title} <RoleBadge role={role} />
              </strong>
              <span>{hint.text}</span>
            </div>
          </div>
        </section>

        <aside className="sidebar" aria-label="Chat and people">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'chat'}
              className={tab === 'chat' ? 'active' : ''}
              onClick={() => setTab('chat')}
            >
              <Icon name="chat" size={16} /> Chat {unread > 0 && <span className="badge">{unread}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'people'}
              className={tab === 'people' ? 'active' : ''}
              onClick={() => setTab('people')}
            >
              <Icon name="users" size={16} /> People <span className="count">{participants.length}</span>
              {can('resolve_requests') && requests.length > 0 && <span className="badge badge-warn">{requests.length}</span>}
            </button>
            <span className="tabs-thumb" data-tab={tab} aria-hidden="true" />
          </div>

          <div className="tab-panel" hidden={tab !== 'chat'}>
            <Chat messages={room.messages} selfId={self.userId} onSend={actions.sendChat} />
          </div>
          <div className="tab-panel" hidden={tab !== 'people'}>
            <ParticipantList
              participants={participants}
              selfId={self.userId}
              canManage={can('assign_role')}
              onAssignRole={actions.assignRole}
              onRemove={actions.removeParticipant}
              onTransferHost={actions.transferHost}
            />
          </div>
        </aside>

        {theater && unread > 0 && (
          <button type="button" className="theater-unread" onClick={() => setTheater(false)}>
            <Icon name="chat" size={15} /> {unread} new message{unread > 1 ? 's' : ''}
          </button>
        )}
      </main>

    </div>
  );
}

/** Room code chip: one click copies it. */
function CopyCode({ code }) {
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API unavailable (http, old browser): fall back to a hidden textarea.
      const field = document.createElement('textarea');
      field.value = code;
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    notify(`Room code ${code} copied`, 'success');
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      className={`code-chip ${copied ? 'is-copied' : ''}`}
      onClick={copy}
      title="Copy room code"
      aria-label={`Copy room code ${code}`}
    >
      <span className="code-chip-label">Code</span>
      <span className="code-chip-value">{code}</span>
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      <span className="code-chip-hint">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function ConnectionPill({ status, latency }) {
  const label = status === 'joined' ? 'Live' : status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
  return (
    <span
      className={`connection connection-${status}`}
      title={latency != null ? `Round-trip to server: ${latency} ms` : undefined}
    >
      <span className="dot" aria-hidden="true" />
      {label}
      {status === 'joined' && latency != null && <span className="connection-ms">{latency < 1 ? '<1' : latency}ms</span>}
    </span>
  );
}

function StatusScreen({ icon, title, text, children }) {
  return (
    <div className="center-screen">
      <div className="card prompt-card">
        <Logo />
        {icon && (
          <span className="status-icon">
            <Icon name={icon} size={22} />
          </span>
        )}
        <h2>{title}</h2>
        {text && <p className="muted">{text}</p>}
        {children}
      </div>
    </div>
  );
}
