import { useEffect, useState } from 'react';
import { formatTime } from '../lib/youtube.js';

/**
 * Custom control bar. `mode` decides what the buttons do:
 *   'control' → Host/Moderator: emits play/pause/seek directly
 *   'request' → Participant: sends a request that a Host/Moderator must approve
 *   'none'    → Viewer: watch only
 * Volume / mute / fullscreen are local and available to everyone.
 */
export default function PlaybackControls({ playerRef, playback, duration, mode, onPlay, onPause, onSeek }) {
  const [current, setCurrent] = useState(0);
  const [dragValue, setDragValue] = useState(null);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setCurrent(player.getCurrentTime());
      setMuted(player.isMuted());
    }, 250);
    return () => clearInterval(id);
  }, [playerRef]);

  const isPlaying = Boolean(playback?.isPlaying);
  const max = Math.max(duration || 0, current, 1);
  const shownTime = dragValue ?? current;
  const disabled = mode === 'none';
  const requesting = mode === 'request';

  const commitSeek = () => {
    if (dragValue === null) return;
    const value = dragValue;
    setDragValue(null);
    onSeek(value);
  };

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

  const playLabel = isPlaying ? 'Pause' : 'Play';

  return (
    <div className={`controls ${disabled ? 'controls-locked' : ''}`}>
      <button
        type="button"
        className={`control-play ${requesting ? 'is-request' : ''}`}
        onClick={isPlaying ? onPause : onPlay}
        disabled={disabled}
        title={
          disabled ? 'Viewers are watch-only' : requesting ? `Ask the host to ${playLabel.toLowerCase()}` : playLabel
        }
      >
        <span aria-hidden="true">{isPlaying ? '❚❚' : '▶'}</span>
        {requesting && <span className="control-play-label">Request {playLabel.toLowerCase()}</span>}
        <span className="sr-only">{playLabel}</span>
      </button>

      <span className="control-time">{formatTime(shownTime)}</span>

      <input
        className="seek"
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={Math.min(shownTime, max)}
        disabled={disabled}
        aria-label={requesting ? 'Request seek position' : 'Seek'}
        style={{ '--progress': `${(Math.min(shownTime, max) / max) * 100}%` }}
        onChange={(e) => setDragValue(Number(e.target.value))}
        onPointerUp={commitSeek}
        onKeyUp={commitSeek}
        onBlur={commitSeek}
      />

      <span className="control-time muted">{formatTime(duration)}</span>

      <div className="volume">
        <button type="button" className="icon-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted || volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'}
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
        className="icon-btn"
        title="Fullscreen"
        onClick={() => playerRef.current?.toggleFullscreen()}
      >
        ⛶
      </button>
    </div>
  );
}
