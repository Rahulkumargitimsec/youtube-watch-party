const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Same parsing rules as the server (backend/src/utils/youtube.js). */
export function extractVideoId(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return null;
  if (VIDEO_ID_RE.test(value)) return value;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

/** Static thumbnail for a video id (no API key needed). */
export function thumbnailUrl(videoId, quality = 'mqdefault') {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/${quality}.jpg` : '';
}

export function formatTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** Where the room's video should be *right now*, given a sync_state snapshot. */
export function expectedTime(playback, clockOffset = 0) {
  if (!playback) return 0;
  if (!playback.isPlaying) return playback.currentTime;
  const serverNow = Date.now() + clockOffset;
  return playback.currentTime + Math.max(0, serverNow - playback.serverTime) / 1000;
}

let apiPromise = null;

/** Loads the YouTube IFrame Player API script once and resolves with window.YT. */
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the YouTube player. Check your connection or ad-blocker.'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export const PLAYER_STATE = Object.freeze({
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
});

export function describePlayerError(code) {
  switch (code) {
    case 2:
      return 'Invalid video id.';
    case 5:
      return 'This video cannot be played in the HTML5 player.';
    case 100:
      return 'Video not found — it may be private or removed.';
    case 101:
    case 150:
      return 'The owner of this video does not allow it to be embedded. Try another video.';
    default:
      return 'The video could not be played.';
  }
}
