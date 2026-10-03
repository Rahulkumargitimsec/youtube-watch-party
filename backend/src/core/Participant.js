/**
 * A member of a room.
 *
 * - `userId` is public (sent to everyone, used as a target for assign_role etc.).
 * - The session token is secret and only its SHA-256 hash is stored. Presenting the
 *   token on join_room restores this identity (and role) after a refresh or reconnect.
 * - A user may have several sockets (multiple tabs); they are online while any is open.
 */
export class Participant {
  constructor({ userId, tokenHash, accountId = null, username, role, joinedAt = Date.now(), removed = false }) {
    this.userId = userId;
    this.tokenHash = tokenHash;
    this.accountId = accountId; // set when the member is logged in with an account
    this.username = username;
    this.role = role;
    this.joinedAt = new Date(joinedAt).getTime();
    this.removed = removed;

    // Runtime-only state (not persisted).
    this.active = false; // currently part of the room (online, or offline within the grace period)
    this.inactiveSince = Date.now();
    this.sockets = new Set();
    this.disconnectTimer = null;
  }

  get isOnline() {
    return this.sockets.size > 0;
  }

  attachSocket(socketId) {
    this.sockets.add(socketId);
    this.clearDisconnectTimer();
  }

  detachSocket(socketId) {
    this.sockets.delete(socketId);
  }

  clearDisconnectTimer() {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  ref() {
    return { userId: this.userId, username: this.username };
  }

  toPublic() {
    return {
      userId: this.userId,
      username: this.username,
      role: this.role,
      online: this.isOnline,
      verified: Boolean(this.accountId),
      joinedAt: this.joinedAt,
    };
  }

  toDocument() {
    return {
      userId: this.userId,
      tokenHash: this.tokenHash,
      accountId: this.accountId,
      username: this.username,
      role: this.role,
      joinedAt: new Date(this.joinedAt),
      removed: this.removed,
    };
  }
}
