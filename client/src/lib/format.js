import { formatTime } from './youtube.js';

export const ROLE_LABELS = {
  host: 'Host',
  moderator: 'Moderator',
  participant: 'Participant',
  viewer: 'Viewer',
};

const AVATAR_COLORS = ['#f97316', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#eab308', '#14b8a6', '#6366f1'];

export function avatarColor(seed = '') {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Human description of a play/pause/seek/change_video action or request. */
export function describeAction(type, payload = {}) {
  switch (type) {
    case 'play':
      return 'play the video';
    case 'pause':
      return 'pause the video';
    case 'seek':
      return `seek to ${formatTime(payload.time)}`;
    case 'change_video':
      return 'change the video';
    default:
      return type;
  }
}

export function describeSync(action) {
  if (!action) return null;
  const who = action.by?.username ?? 'Someone';
  const via = action.requestedBy ? ` (requested by ${action.requestedBy.username})` : '';
  switch (action.type) {
    case 'play':
      return `${who} pressed play${via}`;
    case 'pause':
      return `${who} paused the video${via}`;
    case 'seek':
      return `${who} jumped to ${formatTime(action.time)}${via}`;
    case 'change_video':
      return `${who} changed the video${via}`;
    default:
      return null;
  }
}

export function timeOfDay(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
