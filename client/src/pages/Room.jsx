import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import Chat from '../components/Chat.jsx';
import ParticipantList, { RoleBadge } from '../components/ParticipantList.jsx';
import PlaybackControls from '../components/PlaybackControls.jsx';
import { ReactionBar, ReactionLayer } from '../components/Reactions.jsx';
import RequestsPanel from '../components/RequestsPanel.jsx';
import { useToast } from '../components/Toasts.jsx';
import VideoForm from '../components/VideoForm.jsx';
import YouTubePlayer from '../components/YouTubePlayer.jsx';
import { useWatchRoom } from '../hooks/useWatchRoom.js';
import { useAuth } from '../lib/auth.jsx';
import { Logo } from './Home.jsx';

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
  const { notify } = useToast();
  const room = useWatchRoom(roomId, username, authToken);
  const { status, self, role, can, actions, playback, participants, requests } = room;

  const playerRef = useRef(null);
  const [videoInfo, setVideoInfo] = useState({ title: '', duration: 0 });
  const [tab, setTab] = useState('chat');
  const [unread, setUnread] = useState(0);
  const lastSeenCount = useRef(0);

  // Unread badge for chat while the People tab is open.
  useEffect(() => {
    const chatCount = room.messages.filter((m) => !m.system).length;
    if (tab === 'chat') {
      lastSeenCount.current = chatCount;
      setUnread(0);
    } else {
      setUnread(Math.max(0, chatCount - lastSeenCount.current));
    }
  }, [room.messages, tab]);

  const onInfo = useCallback((info) => setVideoInfo(info), []);

  // What the playback buttons do for this user's role.
  const mode = can('control_playback') ? 'control' : can('request_change') ? 'request' : 'none';
  const videoMode = can('change_video') ? 'control' : can('request_change') ? 'request' : 'none';

  const onPlay = () => (mode === 'control' ? actions.play() : actions.requestChange('play'));
  const onPause = () => (mode === 'control' ? actions.pause() : actions.requestChange('pause'));
  const onSeek = (time) => (mode === 'control' ? actions.seek(time) : actions.requestChange('seek', { time }));
  const onChangeVideo = (url, videoId) =>
    videoMode === 'control' ? actions.changeVideo(url) : actions.requestChange('change_video', { videoId });

  const inviteLink = `${window.location.origin}/room/${roomId}`;
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      notify('Invite link copied!', 'success');
    } catch {
      window.prompt('Copy this invite link:', inviteLink);
    }
  };

  const leave = async () => {
    await actions.leave();
    navigate('/');
  };

  if (status === 'removed') {
    return (
      <StatusScreen title="You were removed from this room" text="The host removed you from this watch party.">
        <Link className="btn btn-primary btn-block" to="/">
          Back to home
        </Link>
      </StatusScreen>
    );
  }

  if (status === 'error') {
    return (
      <StatusScreen title="Couldn't join the room" text={room.error}>
        <Link className="btn btn-primary btn-block" to="/">
          Back to home
        </Link>
      </StatusScreen>
    );
  }

  if (!self || !playback) {
    return (
      <StatusScreen title="Joining room…" text={`Connecting to ${roomId}`}>
        <div className="spinner" aria-hidden="true" />
      </StatusScreen>
    );
  }

  const roleHint = {
    host: 'You are the host — you control playback and manage roles.',
    moderator: 'You are a moderator — you can control playback and approve requests.',
    participant: 'You are a participant — play, pause, seek and video changes are sent to the host for approval.',
    viewer: 'You are a viewer — sit back and enjoy the show.',
  }[role];

  return (
    <div className="room">
      <header className="room-header">
        <Logo />
        <div className="room-title">
          <h1>{room.room?.name}</h1>
          <button type="button" className="room-code" onClick={copyInvite} title="Copy invite link">
            <span>{roomId}</span> <span aria-hidden="true">⧉</span> <span className="room-code-label">Invite</span>
          </button>
        </div>
        <div className="room-header-right">
          <ConnectionPill status={status} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={leave}>
            Leave
          </button>
        </div>
      </header>

      <main className="room-layout">
        <section className="stage">
          <YouTubePlayer ref={playerRef} playback={playback} clockOffset={room.clockOffset} onInfo={onInfo}>
            <ReactionLayer reactions={room.reactions} />
          </YouTubePlayer>

          <PlaybackControls
            playerRef={playerRef}
            playback={playback}
            duration={videoInfo.duration}
            mode={mode}
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

          <div className="stage-meta">
            <div className="now-playing">
              <span className="eyebrow">{playback.isPlaying ? '● Now playing' : '❚❚ Paused'}</span>
              <h2 title={videoInfo.title}>{videoInfo.title || 'Loading video…'}</h2>
            </div>
            <ReactionBar options={room.reactionOptions} onReact={actions.react} />
          </div>

          <VideoForm mode={videoMode} onChange={onChangeVideo} />

          <p className="role-hint">
            <RoleBadge role={role} /> {roleHint}
          </p>
        </section>

        <aside className="sidebar">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'chat'}
              className={tab === 'chat' ? 'active' : ''}
              onClick={() => setTab('chat')}
            >
              Chat {unread > 0 && <span className="badge">{unread}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'people'}
              className={tab === 'people' ? 'active' : ''}
              onClick={() => setTab('people')}
            >
              People <span className="count">{participants.length}</span>
            </button>
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
      </main>
    </div>
  );
}

function ConnectionPill({ status }) {
  const label = status === 'joined' ? 'Live' : status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
  return (
    <span className={`connection connection-${status}`}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function StatusScreen({ title, text, children }) {
  return (
    <div className="center-screen">
      <div className="card prompt-card">
        <Logo />
        <h2>{title}</h2>
        {text && <p className="muted">{text}</p>}
        {children}
      </div>
    </div>
  );
}
