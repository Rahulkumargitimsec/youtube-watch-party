/**
 * Role-based access control. Every socket event that changes the room is checked
 * against this matrix on the server — the UI only mirrors it to disable buttons.
 */
export const ROLES = Object.freeze({
  HOST: 'host',
  MODERATOR: 'moderator',
  PARTICIPANT: 'participant',
  VIEWER: 'viewer',
});

export const ACTIONS = Object.freeze({
  CONTROL_PLAYBACK: 'control_playback', // play / pause / seek
  CHANGE_VIDEO: 'change_video',
  RESOLVE_REQUESTS: 'resolve_requests', // approve / reject participant requests
  REQUEST_CHANGE: 'request_change', // ask a host/moderator to play/pause/seek/change video
  ASSIGN_ROLE: 'assign_role',
  REMOVE_PARTICIPANT: 'remove_participant',
  TRANSFER_HOST: 'transfer_host',
  CHAT: 'chat',
  REACT: 'react',
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.HOST]: new Set([
    ACTIONS.CONTROL_PLAYBACK,
    ACTIONS.CHANGE_VIDEO,
    ACTIONS.RESOLVE_REQUESTS,
    ACTIONS.ASSIGN_ROLE,
    ACTIONS.REMOVE_PARTICIPANT,
    ACTIONS.TRANSFER_HOST,
    ACTIONS.CHAT,
    ACTIONS.REACT,
  ]),
  [ROLES.MODERATOR]: new Set([
    ACTIONS.CONTROL_PLAYBACK,
    ACTIONS.CHANGE_VIDEO,
    ACTIONS.RESOLVE_REQUESTS,
    ACTIONS.CHAT,
    ACTIONS.REACT,
  ]),
  // Participants watch, and can *request* changes that a host/moderator must approve.
  [ROLES.PARTICIPANT]: new Set([ACTIONS.REQUEST_CHANGE, ACTIONS.CHAT, ACTIONS.REACT]),
  // Viewers are watch-only (they can still chat and react).
  [ROLES.VIEWER]: new Set([ACTIONS.CHAT, ACTIONS.REACT]),
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.HOST]: 'Host',
  [ROLES.MODERATOR]: 'Moderator',
  [ROLES.PARTICIPANT]: 'Participant',
  [ROLES.VIEWER]: 'Viewer',
});

// Roles the host can hand out with assign_role (host itself moves via transfer_host).
export const ASSIGNABLE_ROLES = Object.freeze([ROLES.MODERATOR, ROLES.PARTICIPANT, ROLES.VIEWER]);

export const ROLE_RANK = Object.freeze({
  [ROLES.HOST]: 0,
  [ROLES.MODERATOR]: 1,
  [ROLES.PARTICIPANT]: 2,
  [ROLES.VIEWER]: 3,
});

export function can(role, action) {
  return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}

/** Plain-object version of the matrix, sent to clients so the UI can mirror it. */
export function permissionMatrix() {
  return Object.fromEntries(
    Object.entries(ROLE_PERMISSIONS).map(([role, actions]) => [role, [...actions]]),
  );
}
