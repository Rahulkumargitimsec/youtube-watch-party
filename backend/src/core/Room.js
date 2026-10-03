import { createHash, randomBytes } from 'node:crypto';
import { Participant } from './Participant.js';
import { PlaybackState } from './PlaybackState.js';
import {
  ACTIONS,
  ASSIGNABLE_ROLES,
  ROLES,
  ROLE_LABELS,
  ROLE_RANK,
  can,
  permissionMatrix,
} from './permissions.js';
import { RoomError } from '../utils/errors.js';
import { cleanText, cleanTime, generateId } from '../utils/validate.js';
import { extractVideoId } from '../utils/youtube.js';

export const REQUEST_TYPES = Object.freeze(['play', 'pause', 'seek', 'change_video']);
export const REACTIONS = Object.freeze(['👍', '😂', '😮', '😍', '🔥', '👏', '😢', '🎉']);

const MAX_PENDING_REQUESTS_PER_USER = 3;
const CHAT_HISTORY_LIMIT = 100;
const CHAT_MAX_LENGTH = 500;

const FORBIDDEN_MESSAGES = {
  [ACTIONS.CONTROL_PLAYBACK]: 'Only the host or a moderator can control playback.',
  [ACTIONS.CHANGE_VIDEO]: 'Only the host or a moderator can change the video.',
  [ACTIONS.RESOLVE_REQUESTS]: 'Only the host or a moderator can approve requests.',
  [ACTIONS.REQUEST_CHANGE]: 'Viewers are watch-only and cannot send requests.',
  [ACTIONS.ASSIGN_ROLE]: 'Only the host can assign roles.',
  [ACTIONS.REMOVE_PARTICIPANT]: 'Only the host can remove participants.',
  [ACTIONS.TRANSFER_HOST]: 'Only the host can transfer the host role.',
};

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * A watch party room: participants, roles, playback state, pending requests and chat.
 *
 * All permission checks happen here, so no matter which transport calls a method
 * (Socket.IO today, anything else tomorrow) the rules are enforced in one place.
 * Broadcasting is done through the injected Socket.IO server.
 */
export class Room {
  constructor(
    { id, name, hostUserId = null, playback, members = [], chat = [], createdAt = Date.now() },
    { io, graceMs = 15_000, onChange = () => {}, onEmpty = () => {}, now = () => Date.now() },
  ) {
    this.id = id;
    this.name = name;
    this.hostUserId = hostUserId;
    this.createdAt = new Date(createdAt).getTime();
    this.playback = new PlaybackState(playback);
    this.members = new Map(members.map((m) => [m.userId, new Participant(m)]));
    this.chat = chat.slice(-CHAT_HISTORY_LIMIT);
    this.requests = new Map(); // pending approval requests (in-memory only)

    this.io = io;
    this.graceMs = graceMs;
    this.onChange = onChange;
    this.onEmpty = onEmpty;
    this.now = now;
    this.hostCheckTimer = null;
  }

  /** Rebuild a room from its MongoDB document. */
  static fromDocument(doc, deps) {
    const room = new Room(
      {
        id: doc.roomId,
        name: doc.name,
        hostUserId: doc.hostUserId,
        playback: doc.playback,
        members: doc.members ?? [],
        chat: (doc.chat ?? []).map((m) => ({ ...m, ts: new Date(m.ts).getTime() })),
        createdAt: doc.createdAt,
      },
      deps,
    );
    // Nobody is connected right after a restart: freeze the video where it was.
    const lastActive = doc.lastActiveAt ? new Date(doc.lastActiveAt).getTime() : room.now();
    if (room.playback.isPlaying) room.playback.pause(lastActive);
    return room;
  }

  // ---------------------------------------------------------------- channels

  get channel() {
    return `room:${this.id}`;
  }

  userChannel(userId) {
    return `room:${this.id}:user:${userId}`;
  }

  broadcast(event, payload) {
    this.io.to(this.channel).emit(event, payload);
  }

  emitToUser(userId, event, payload) {
    this.io.to(this.userChannel(userId)).emit(event, payload);
  }

  // ---------------------------------------------------------------- membership

  activeMembers() {
    return [...this.members.values()].filter((p) => p.active && !p.removed);
  }

  publicParticipants() {
    return this.activeMembers()
      .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.joinedAt - b.joinedAt)
      .map((p) => p.toPublic());
  }

  createMember(username, role, accountId = null) {
    const token = randomBytes(24).toString('base64url');
    const participant = new Participant({
      userId: generateId('u'),
      tokenHash: hashToken(token),
      accountId,
      username,
      role,
      joinedAt: this.now(),
    });
    this.members.set(participant.userId, participant);
    return { participant, token };
  }

  /** Called once when the room is created via the REST API. */
  createHost(username, accountId = null) {
    const result = this.createMember(username, ROLES.HOST, accountId);
    this.hostUserId = result.participant.userId;
    return result;
  }

  findByToken(token) {
    if (typeof token !== 'string' || token.length > 200) return null;
    const hash = hashToken(token);
    for (const member of this.members.values()) {
      if (member.tokenHash === hash) return member;
    }
    return null;
  }

  /**
   * Who is joining? A matching session token (same browser) wins; a logged-in user is
   * also recognised by their account, so they get their seat back on any device.
   */
  findReturningMember(token, accountId) {
    const byToken = this.findByToken(token);
    if (!accountId) return byToken;
    if (byToken && (!byToken.accountId || byToken.accountId === accountId)) return byToken;
    for (const member of this.members.values()) {
      if (member.accountId === accountId) return member;
    }
    return null;
  }

  /**
   * join_room: returning users get their identity and role back,
   * new users become Participants.
   */
  join({ token, username, socketId, accountId = null }) {
    let participant = this.findReturningMember(token, accountId);
    let issuedToken = token;

    if (participant?.removed) {
      throw new RoomError('REMOVED', 'You were removed from this room by the host.', 403);
    }
    if (!participant) {
      ({ participant, token: issuedToken } = this.createMember(username, ROLES.PARTICIPANT, accountId));
    } else if (!this.findByToken(token)) {
      // Recognised by account on a new device: issue a fresh session token for this browser.
      issuedToken = randomBytes(24).toString('base64url');
      participant.tokenHash = hashToken(issuedToken);
    }
    if (accountId && !participant.accountId) participant.accountId = accountId;

    const wasActive = participant.active;
    participant.username = username;
    participant.active = true;
    participant.attachSocket(socketId);

    if (wasActive) {
      // Reconnect within the grace period: nobody "joined", just refresh presence.
      this.broadcastParticipants();
    } else {
      this.broadcast('user_joined', {
        ...participant.ref(),
        role: participant.role,
        participants: this.publicParticipants(),
      });
    }

    this.ensureHost();
    this.onChange();
    return { participant, token: issuedToken };
  }

  /** A socket closed. Keep the seat for `graceMs` so a refresh doesn't drop the user. */
  handleDisconnect(userId, socketId) {
    const participant = this.members.get(userId);
    if (!participant) return;
    participant.detachSocket(socketId);
    if (!participant.active || participant.isOnline) return;

    participant.clearDisconnectTimer();
    participant.disconnectTimer = setTimeout(() => {
      participant.disconnectTimer = null;
      if (participant.active && !participant.isOnline) this.markLeft(participant);
    }, this.graceMs);
    participant.disconnectTimer.unref?.();

    this.broadcastParticipants();
  }

  /** leave_room: explicit leave, no grace period. */
  leave(userId, socketId) {
    const participant = this.members.get(userId);
    if (!participant?.active) return;
    participant.detachSocket(socketId);
    if (participant.isOnline) return; // another tab is still open
    this.markLeft(participant);
  }

  markLeft(participant) {
    participant.clearDisconnectTimer();
    participant.active = false;
    participant.inactiveSince = this.now();
    this.dropRequestsFrom(participant.userId);

    this.broadcast('user_left', { ...participant.ref(), participants: this.publicParticipants() });

    if (participant.userId === this.hostUserId) this.ensureHost({ immediate: true });
    this.emitRequests();
    this.onChange();
    if (this.activeMembers().length === 0) this.onEmpty();
  }

  /**
   * A room always needs a host. If the host left, promote the longest-standing
   * moderator (or participant). After a server restart the host gets a grace period
   * to reconnect before someone else is promoted.
   */
  ensureHost({ immediate = false } = {}) {
    const host = this.members.get(this.hostUserId);
    if (host?.active && !host.removed) return;

    if (host && !host.removed && !immediate) {
      const wait = host.inactiveSince + this.graceMs - this.now();
      if (wait > 0) {
        if (!this.hostCheckTimer) {
          this.hostCheckTimer = setTimeout(() => {
            this.hostCheckTimer = null;
            this.ensureHost();
          }, wait + 50);
          this.hostCheckTimer.unref?.();
        }
        return;
      }
    }

    const candidate = this.activeMembers()
      .filter((p) => p.userId !== this.hostUserId)
      .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.joinedAt - b.joinedAt)[0];
    if (!candidate) return;

    this.setHost(candidate, host, 'host_left');
  }

  setHost(newHost, previousHost, reason) {
    if (previousHost && !previousHost.removed) previousHost.role = ROLES.MODERATOR;
    newHost.role = ROLES.HOST;
    this.hostUserId = newHost.userId;
    this.dropRequestsFrom(newHost.userId);

    this.broadcast('host_transferred', {
      from: previousHost ? previousHost.ref() : null,
      to: newHost.ref(),
      reason,
      participants: this.publicParticipants(),
    });
    this.emitRequests();
    this.onChange();
  }

  // ---------------------------------------------------------------- permissions

  requireMember(userId) {
    const participant = this.members.get(userId);
    if (!participant || !participant.active || participant.removed) {
      throw new RoomError('NOT_IN_ROOM', 'You are not part of this room.', 403);
    }
    return participant;
  }

  requireTarget(userId) {
    const participant = this.members.get(userId);
    if (!participant || !participant.active || participant.removed) {
      throw new RoomError('USER_NOT_FOUND', 'That user is no longer in the room.', 404);
    }
    return participant;
  }

  authorize(participant, action) {
    if (!can(participant.role, action)) {
      throw new RoomError('FORBIDDEN', FORBIDDEN_MESSAGES[action] ?? 'You are not allowed to do that.', 403);
    }
  }

  // ---------------------------------------------------------------- playback

  play(userId) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.CONTROL_PLAYBACK);
    this.applyAction(actor, 'play', {});
  }

  pause(userId) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.CONTROL_PLAYBACK);
    this.applyAction(actor, 'pause', {});
  }

  seek(userId, time) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.CONTROL_PLAYBACK);
    this.applyAction(actor, 'seek', this.normalizePayload('seek', { time }));
  }

  changeVideo(userId, input) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.CHANGE_VIDEO);
    this.applyAction(actor, 'change_video', this.normalizePayload('change_video', { videoId: input }));
  }

  normalizePayload(type, payload = {}) {
    switch (type) {
      case 'play':
      case 'pause':
        return {};
      case 'seek':
        return { time: cleanTime(payload.time) };
      case 'change_video': {
        const videoId = extractVideoId(payload.videoId ?? payload.url);
        if (!videoId) throw new RoomError('INVALID_VIDEO', 'That does not look like a YouTube link or video id.');
        return { videoId };
      }
      default:
        throw new RoomError('INVALID_REQUEST', 'Unknown action.');
    }
  }

  applyAction(actor, type, payload, extra = {}) {
    const now = this.now();
    if (type === 'play') this.playback.play(now);
    else if (type === 'pause') this.playback.pause(now);
    else if (type === 'seek') this.playback.seek(payload.time, now);
    else if (type === 'change_video') this.playback.changeVideo(payload.videoId, now);

    this.broadcastSync({ type, by: actor.ref(), ...payload, ...extra });
    this.onChange();
  }

  broadcastSync(action = null) {
    this.broadcast('sync_state', { ...this.playback.snapshot(this.now()), action });
  }

  // ---------------------------------------------------------------- approval requests

  /** A participant asks for play/pause/seek/change_video; hosts & moderators decide. */
  createRequest(userId, type, payload) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.REQUEST_CHANGE);
    if (!REQUEST_TYPES.includes(type)) throw new RoomError('INVALID_REQUEST', 'Unknown request type.');
    const cleanPayload = this.normalizePayload(type, payload);

    // A newer request of the same kind replaces the older one.
    for (const [id, request] of this.requests) {
      if (request.userId === actor.userId && request.type === type) this.requests.delete(id);
    }
    const pendingCount = [...this.requests.values()].filter((r) => r.userId === actor.userId).length;
    if (pendingCount >= MAX_PENDING_REQUESTS_PER_USER) {
      throw new RoomError('TOO_MANY_REQUESTS', 'Wait for your pending requests to be answered first.', 429);
    }

    const request = {
      id: generateId('r'),
      userId: actor.userId,
      username: actor.username,
      type,
      payload: cleanPayload,
      createdAt: this.now(),
    };
    this.requests.set(request.id, request);
    this.emitRequests();
    return request;
  }

  resolveRequest(userId, requestId, approve) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.RESOLVE_REQUESTS);
    const request = this.requests.get(requestId);
    if (!request) throw new RoomError('REQUEST_NOT_FOUND', 'That request was already handled.', 404);
    this.requests.delete(requestId);

    if (approve) {
      this.applyAction(actor, request.type, request.payload, {
        requestedBy: { userId: request.userId, username: request.username },
      });
    }

    this.emitToUser(request.userId, 'request_resolved', {
      requestId,
      type: request.type,
      payload: request.payload,
      approved: Boolean(approve),
      resolvedBy: actor.ref(),
    });
    this.emitRequests();
  }

  cancelRequest(userId, requestId) {
    const request = this.requests.get(requestId);
    if (!request || request.userId !== userId) {
      throw new RoomError('REQUEST_NOT_FOUND', 'That request was already handled.', 404);
    }
    this.requests.delete(requestId);
    this.emitRequests();
  }

  dropRequestsFrom(userId) {
    for (const [id, request] of this.requests) {
      if (request.userId === userId) this.requests.delete(id);
    }
  }

  requestsVisibleTo(participant) {
    const all = [...this.requests.values()];
    return can(participant.role, ACTIONS.RESOLVE_REQUESTS)
      ? all
      : all.filter((r) => r.userId === participant.userId);
  }

  /** Hosts/moderators see every pending request, everyone else only their own. */
  emitRequests() {
    for (const participant of this.activeMembers()) {
      this.emitToUser(participant.userId, 'requests_update', {
        requests: this.requestsVisibleTo(participant),
      });
    }
  }

  // ---------------------------------------------------------------- host powers

  assignRole(userId, targetUserId, role) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.ASSIGN_ROLE);
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new RoomError('INVALID_ROLE', 'Role must be moderator, participant or viewer.');
    }
    const target = this.requireTarget(targetUserId);
    if (target.userId === actor.userId) throw new RoomError('INVALID_TARGET', 'You cannot change your own role.');
    if (target.role === ROLES.HOST) throw new RoomError('INVALID_TARGET', 'Use "transfer host" to change the host.');
    if (target.role === role) return;

    target.role = role;
    if (!can(role, ACTIONS.REQUEST_CHANGE)) this.dropRequestsFrom(target.userId);

    this.broadcast('role_assigned', {
      ...target.ref(),
      role,
      assignedBy: actor.ref(),
      participants: this.publicParticipants(),
    });
    this.emitRequests();
    this.onChange();
  }

  removeParticipant(userId, targetUserId) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.REMOVE_PARTICIPANT);
    const target = this.requireTarget(targetUserId);
    if (target.userId === actor.userId) throw new RoomError('INVALID_TARGET', 'You cannot remove yourself.');

    target.removed = true;
    target.active = false;
    target.inactiveSince = this.now();
    target.clearDisconnectTimer();
    this.dropRequestsFrom(target.userId);

    // Tell the removed user, then detach all their sockets from the room channels.
    this.emitToUser(target.userId, 'removed_from_room', { by: actor.ref() });
    this.io.in(this.userChannel(target.userId)).socketsLeave([this.channel, this.userChannel(target.userId)]);
    target.sockets.clear();

    this.broadcast('participant_removed', {
      ...target.ref(),
      removedBy: actor.ref(),
      participants: this.publicParticipants(),
    });
    this.emitRequests();
    this.onChange();
  }

  transferHost(userId, targetUserId) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.TRANSFER_HOST);
    const target = this.requireTarget(targetUserId);
    if (target.userId === actor.userId) throw new RoomError('INVALID_TARGET', 'You are already the host.');
    this.setHost(target, actor, 'transfer');
  }

  // ---------------------------------------------------------------- chat & reactions

  sendChat(userId, text) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.CHAT);
    const message = {
      id: generateId('m'),
      ...actor.ref(),
      role: actor.role,
      text: cleanText(text, CHAT_MAX_LENGTH),
      ts: this.now(),
    };
    this.chat.push(message);
    if (this.chat.length > CHAT_HISTORY_LIMIT) this.chat.splice(0, this.chat.length - CHAT_HISTORY_LIMIT);
    this.broadcast('chat_message', message);
    this.onChange();
  }

  react(userId, emoji) {
    const actor = this.requireMember(userId);
    this.authorize(actor, ACTIONS.REACT);
    if (!REACTIONS.includes(emoji)) throw new RoomError('INVALID_REACTION', 'Unsupported reaction.');
    this.broadcast('reaction', {
      id: generateId('x'),
      ...actor.ref(),
      emoji,
      videoTime: this.playback.currentTime(this.now()),
    });
  }

  // ---------------------------------------------------------------- snapshots

  /** Everything a client needs right after join_room. */
  stateFor(userId) {
    const self = this.members.get(userId);
    return {
      room: { id: this.id, name: this.name, createdAt: this.createdAt },
      self: { ...self.ref(), role: self.role },
      participants: this.publicParticipants(),
      playback: this.playback.snapshot(this.now()),
      requests: this.requestsVisibleTo(self),
      chat: this.chat,
      rolePermissions: permissionMatrix(),
      roleLabels: ROLE_LABELS,
      reactions: REACTIONS,
    };
  }

  broadcastParticipants() {
    this.broadcast('participants_update', { participants: this.publicParticipants() });
  }

  summary() {
    return {
      roomId: this.id,
      name: this.name,
      participantCount: this.activeMembers().length,
      videoId: this.playback.videoId,
      createdAt: this.createdAt,
    };
  }

  toDocument() {
    return {
      roomId: this.id,
      name: this.name,
      hostUserId: this.hostUserId,
      playback: this.playback.toJSON(),
      members: [...this.members.values()].map((m) => m.toDocument()),
      chat: this.chat.map((m) => ({ ...m, ts: new Date(m.ts) })),
      createdAt: new Date(this.createdAt),
      lastActiveAt: new Date(this.now()),
    };
  }

  dispose() {
    clearTimeout(this.hostCheckTimer);
    for (const member of this.members.values()) member.clearDisconnectTimer();
  }
}
