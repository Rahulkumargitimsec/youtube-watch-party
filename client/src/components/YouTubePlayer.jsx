import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { describePlayerError, expectedTime, loadYouTubeApi, PLAYER_STATE } from '../lib/youtube.js';

// How far (seconds) a client may drift before we correct it.
const HARD_SYNC_THRESHOLD = 0.4; // right after a server event (play/pause/seek)
const SOFT_SYNC_THRESHOLD = 1.2; // periodic drift check while playing
const DRIFT_CHECK_MS = 1000;
const START_FIX_GRACE_MS = 2000;
const PAUSED_SYNC_THRESHOLD = 0.1;

/**
 * Wraps the YouTube IFrame Player API and keeps it locked to the room state.
 *
 * The player itself has no controls (controls: 0) and a transparent shield on top, so
 * users can't change playback locally — every change goes through the server and comes
 * back as a `sync_state` that this component applies.
 */
const YouTubePlayer = forwardRef(function YouTubePlayer({ playback, clockOffset, onInfo, children }, ref) {
  const frameRef = useRef(null);
  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const loadedVideoRef = useRef(null);
  const cuedAtRef = useRef(0); // position a cued (not yet started) video will start from
  const playbackRef = useRef(playback);
  const offsetRef = useRef(clockOffset);
  const interactedRef = useRef(false);
  const lastStartFixRef = useRef(0); // last post-buffering correction (at most one per grace period)
  const syncRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [videoError, setVideoError] = useState(null);

  playbackRef.current = playback;
  offsetRef.current = clockOffset;

  const reportInfo = useCallback(() => {
    const player = playerRef.current;
    if (!player?.getVideoData) return;
    onInfo?.({ title: player.getVideoData()?.title || '', duration: player.getDuration() || 0 });
  }, [onInfo]);

  // 1) Create the player once.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        const target = document.createElement('div'); // YT replaces this node with an <iframe>
        mountRef.current.appendChild(target);
        playerRef.current = new YT.Player(target, {
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: () => !cancelled && setReady(true),
            onStateChange: (e) => {
              if (e.data === PLAYER_STATE.PLAYING || e.data === PLAYER_STATE.CUED) reportInfo();
              // Starting playback (or recovering from buffering) costs time the room didn't wait for:
              // re-check with the tight threshold — at most once per grace period, so a correction
              // that itself buffers can't start a seek loop.
              if (e.data === PLAYER_STATE.PLAYING && Date.now() - lastStartFixRef.current > START_FIX_GRACE_MS) {
                lastStartFixRef.current = Date.now();
                syncRef.current?.(HARD_SYNC_THRESHOLD);
              }
            },
            onError: (e) => setVideoError(describePlayerError(e.data)),
          },
        });
      })
      .catch((err) => setLoadError(err.message));

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* player already gone */
      }
      playerRef.current = null;
      loadedVideoRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Bring the local player in line with the room state.
  const syncToRoom = useCallback((threshold) => {
    const player = playerRef.current;
    const state = playbackRef.current;
    if (!player?.getPlayerState || !state) return;

    const target = expectedTime(state, offsetRef.current);
    const canPlay = interactedRef.current; // browsers block autoplay-with-sound before a click

    // New video → load (autoplay) or cue (paused) it at the right position.
    if (loadedVideoRef.current !== state.videoId) {
      loadedVideoRef.current = state.videoId;
      setVideoError(null);
      const options = { videoId: state.videoId, startSeconds: target };
      cuedAtRef.current = target;
      if (state.isPlaying && canPlay) player.loadVideoById(options);
      else player.cueVideoById(options);
      return;
    }
    if (!canPlay) return; // wait for the user's click before touching playback

    const playerState = player.getPlayerState();
    const duration = player.getDuration() || Infinity;
    const clamped = Math.min(target, Math.max(0, duration - 0.5));
    const notStarted = playerState === PLAYER_STATE.CUED || playerState === PLAYER_STATE.UNSTARTED;
    // A cued video reports an unreliable current time, so compare with where we cued it.
    const localTime = notStarted ? cuedAtRef.current : player.getCurrentTime();
    const drift = Math.abs(localTime - clamped);

    if (!state.isPlaying) {
      if (playerState === PLAYER_STATE.PLAYING || playerState === PLAYER_STATE.BUFFERING) player.pauseVideo();
      // Seeking a paused video is invisible, so paused players snap to the exact frame.
      if (drift > Math.min(threshold, PAUSED_SYNC_THRESHOLD)) {
        // seekTo() on a cued video would start playback, so re-cue at the new spot instead.
        if (notStarted) {
          cuedAtRef.current = clamped;
          player.cueVideoById({ videoId: state.videoId, startSeconds: clamped });
        } else {
          player.seekTo(clamped, true);
        }
      }
      return;
    }

    // Room is playing.
    if (playerState === PLAYER_STATE.ENDED && target >= duration - 1) return; // video finished
    if (drift > threshold) player.seekTo(clamped, true);
    if (playerState !== PLAYER_STATE.PLAYING && playerState !== PLAYER_STATE.BUFFERING) player.playVideo();
  }, []);

  syncRef.current = syncToRoom;

  // Every server update applies with a tight threshold…
  useEffect(() => {
    if (ready) syncToRoom(HARD_SYNC_THRESHOLD);
  }, [ready, playback, syncToRoom]);

  // …and a periodic check fixes slow drift (buffering, slow devices, background tabs).
  useEffect(() => {
    if (!ready) return undefined;
    const id = setInterval(() => syncToRoom(SOFT_SYNC_THRESHOLD), DRIFT_CHECK_MS);
    return () => clearInterval(id);
  }, [ready, syncToRoom]);

  const startWatching = () => {
    interactedRef.current = true;
    setInteracted(true);
    playerRef.current?.unMute?.();
    syncToRoom(HARD_SYNC_THRESHOLD);
  };

  useImperativeHandle(
    ref,
    () => ({
      getCurrentTime: () => playerRef.current?.getCurrentTime?.() ?? expectedTime(playbackRef.current, offsetRef.current),
      getDuration: () => playerRef.current?.getDuration?.() || 0,
      getVolume: () => playerRef.current?.getVolume?.() ?? 100,
      setVolume: (v) => playerRef.current?.setVolume?.(v),
      isMuted: () => playerRef.current?.isMuted?.() ?? false,
      mute: () => playerRef.current?.mute?.(),
      unMute: () => playerRef.current?.unMute?.(),
      toggleFullscreen: () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else frameRef.current?.requestFullscreen?.();
      },
      resync: () => syncToRoom(0.25),
      hasStarted: () => interactedRef.current,
      getState: () => playerRef.current?.getPlayerState?.(),
    }),
    [syncToRoom],
  );

  return (
    <div className="player-frame" ref={frameRef}>
      <div className="player-mount" ref={mountRef} />
      <div
        className="player-shield"
        aria-hidden="true"
        onDoubleClick={() => (document.fullscreenElement ? document.exitFullscreen?.() : frameRef.current?.requestFullscreen?.())}
      />

      {children}

      {(loadError || videoError) && (
        <div className="player-overlay player-error">
          <Icon name="alert" size={28} />
          <strong>{loadError ? 'Player unavailable' : 'Video unavailable'}</strong>
          <span>{loadError || videoError}</span>
        </div>
      )}

      {!interacted && !loadError && (
        <button type="button" className="player-overlay player-start" onClick={startWatching}>
          <span className="play-disc" aria-hidden="true">
            <Icon name="play" size={30} />
          </span>
          <strong>{playback?.isPlaying ? 'This room is already playing' : 'Join playback'}</strong>
          <span>Click to sync with the room</span>
        </button>
      )}

      {!ready && !loadError && interacted && (
        <div className="player-overlay">
          <span className="spinner" />
          Loading player…
        </div>
      )}
    </div>
  );
});

export default YouTubePlayer;
