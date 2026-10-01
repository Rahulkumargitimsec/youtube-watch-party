const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Big Buck Bunny (Blender Foundation) — freely embeddable, used as the default video.
export const DEFAULT_VIDEO_ID = 'aqz-KE-bpKQ';

/**
 * Accepts a raw 11-char video id or any common YouTube URL
 * (watch?v=, youtu.be/, /embed/, /shorts/, /live/) and returns the video id, or null.
 */
export function extractVideoId(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || value.length > 500) return null;
  if (VIDEO_ID_RE.test(value)) return value;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id = null;

  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      if (match) id = match[1];
    }
  }

  return id && VIDEO_ID_RE.test(id) ? id : null;
}

export function isValidVideoId(id) {
  return typeof id === 'string' && VIDEO_ID_RE.test(id);
}
