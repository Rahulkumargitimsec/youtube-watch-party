import { useEffect, useRef, useState } from 'react';
import { expectedTime, formatTime, PLAYER_STATE } from '../lib/youtube.js';
import Icon from './Icons.jsx';

/**
 * Custom control bar. `mode` decides what the buttons do:
 *   'control' → Host/Moderator: emits play/pause/seek directly
 *   'request' → Participant: sends a request that a Host/Moderator must approve
 *   'none'    → Viewer: watch only
 * Volume / mute / fullscreen / theater are local and available to everyone.
 */
export default function PlaybackControls({
  playerRef,
  playback,
  clockOffset,
  duration,
  mode,
  theater,
  onToggleTheater,
  onPlay,
  onPause,
  onSeek,
}) {
  const [current, setCurrent] = useState(0);
  const [dragValue, setDragValue] = useState(null);
  const [hover, setHover] = useState(null); // { pct, time } while hovering the seek bar
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [drift, setDrift] = useState(null); // ms between this player and the room, null = not measurable
  const [started, setStarted] = useState(false); // user clicked in (browsers block autoplay before that)
  const playbackRef = useRef(playback);
  const offsetRef = useRef(clockOffset);
  playbackRef.current = playback;
  offsetRef.current = clockOffset;

  useEffect(() => {
    const id = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const time = player.getCurrentTime();
      setCurrent(time);
      setMuted(player.isMuted());
      const state = player.getState?.();
      setStarted(Boolean(player.hasStarted?.()));
      if (player.hasStarted?.() && (state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.PAUSED)) {
        setDrift(Math.abs(time - expectedTime(playbackRef.current, offsetRef.current)) * 1000);
      } else {
        setDrift(null);
      }
    }, 250);
    return () => clearInterval(id);
  }, [playerRef]);

  const isPlaying = Boolean(playback?.isPlaying);
  const max = Math.max(duration || 0, current, 1);
  const shownTime = dragValue ?? current;
  const disabled = mode === 'none';
  const requesting = mode === 'request';
  const pct = (Math.min(shownTime, max) / max) * 100;

  const commitSeek = () => {
    if (dragValue === null) return;
    const value = dragValue;
    setDragValue(null);
    onSeek(value);
  };

  const skip = (delta) => onSeek(Math.min(Math.max(0, current + delta), Math.max(0, (duration || max) - 1)));

  const changeVolume = (value) => {
    setVolume(value);
    playerRef.current?.setVolume(value);
    if (value > 0 && muted) playerRef.current?.unMute();
  };

  const toggleMute = () => {
    if (muted) playerRef.current?.unMute();
    else playerRef.current?.mute();
    setMuted(!muted);
  };

  const onSeekHover = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover({ pct: ratio * 100, time: ratio * max });
  };

  const playLabel = isPlaying ? 'Pause' : 'Play';
  const syncState = drift == null ? 'idle' : drift < 500 ? 'ok' : drift < 1500 ? 'catching' : 'off';
  const syncText = { idle: started ? 'Ready' : 'Not started', ok: 'In sync', catching: 'Catching up', off: 'Re-syncing' }[syncState];
  const volumeIcon = muted || volume === 0 ? 'mute' : volume < 50 ? 'volumeLow' : 'volume';

  return (
    <div className={`controls ${disabled ? 'controls-locked' : ''}`}>
      <div
        className="seek-wrap"
        onPointerMove={onSeekHover}
        onPointerLeave={() => setHover(null)}
        style={{ '--progress': `${pct}%` }}
      >
        <input
          className="seek"
          type="range"
          min={0}
          max={max}
          step={0.1}
          value={Math.min(shownTime, max)}
          disabled={disabled}
          aria-label={requesting ? 'Request seek position' : 'Seek'}
          aria-valuetext={formatTime(shownTime)}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onPointerUp={commitSeek}
          onKeyUp={commitSeek}
          onBlur={commitSeek}
        />
        {hover && !disabled && (
          <span className="seek-tip" style={{ left: `${hover.pct}%` }}>
            {requesting && <small>request</small>}
            {formatTime(hover.time)}
          </span>
        )}
      </div>

      <div className="controls-row">
        <button
          type="button"
          className={`control-play ${requesting ? 'is-request' : ''}`}
          onClick={isPlaying ? onPause : onPlay}
          disabled={disabled}
          title={
            disabled ? 'Viewers are watch-only' : requesting ? `Ask the host to ${playLabel.toLowerCase()}` : playLabel
          }
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size={18} />
          {requesting && <span className="control-play-label">Request {playLabel.toLowerCase()}</span>}
          <span className="sr-only">{playLabel}</span>
        </button>

        {!disabled && (
          <>
            <button type="button" className="icon-btn" onClick={() => skip(-10)} title="Back 10 seconds" aria-label="Back 10 seconds">
              <Icon name="back10" size={19} strokeWidth={1.8} />
            </button>
            <button type="button" className="icon-btn" onClick={() => skip(10)} title="Forward 10 seconds" aria-label="Forward 10 seconds">
              <Icon name="fwd10" size={19} strokeWidth={1.8} />
            </button>
          </>
        )}

        <span className="control-time">
          {formatTime(shownTime)} <span className="muted">/ {formatTime(duration)}</span>
        </span>

        {disabled && (
          <span className="locked-note">
            <Icon name="eye" size={14} /> Watch-only
          </span>
        )}

        <span className="controls-spacer" />

        <span
          className={`sync-chip sync-${syncState}`}
          title={
            drift == null
              ? started
                ? 'Cued at the room’s position — starts with the room'
                : 'Click the player to sync with the room'
              : `Your player is ${Math.round(drift)} ms from the room’s position`
          }
        >
          <span className="sync-dot" />
          {syncText}
          {drift != null && <span className="sync-ms">{drift < 1000 ? `${Math.round(drift)}ms` : `${(drift / 1000).toFixed(1)}s`}</span>}
        </span>

        <div className="volume">
          <button type="button" className="icon-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
            <Icon name={volumeIcon} size={18} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            aria-label="Volume"
            style={{ '--progress': `${muted ? 0 : volume}%` }}
            onChange={(e) => changeVolume(Number(e.target.value))}
          />
        </div>

        <button
          type="button"
          className={`icon-btn hide-sm ${theater ? 'is-on' : ''}`}
          title="Theater mode"
          aria-pressed={theater}
          onClick={onToggleTheater}
        >
          <Icon name="theater" size={18} />
        </button>
        <button type="button" className="icon-btn" title="Fullscreen" onClick={() => playerRef.current?.toggleFullscreen()}>
          <Icon name="fullscreen" size={18} />
        </button>
      </div>
    </div>
  );
}
