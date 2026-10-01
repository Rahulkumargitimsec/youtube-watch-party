import { RoomError } from '../utils/errors.js';
import { RateLimiter } from '../utils/RateLimiter.js';
import { normalizeRoomId } from '../utils/validate.js';

/**
 * Translates Socket.IO events into Room method calls.
 *
 * Every event is registered through `this.on(...)`, which gives each handler:
 *   - an acknowledgement callback: the client always gets `{ ok: true, ... }` or
 *     `{ ok: false, error: { code, message } }`
 *   - rate limiting per socket
 *   - the room + user context resolved from `socket.data`
 * so the individual handlers stay one-liners that delegate to the Room.
 */
export class MessageHandler {
  constructor(io, roomManager) {
    this.io = io;
    this.rooms = roomManager;
    this.limiters = {
      default: new RateLimiter(40, 5_000),
      chat: new RateLimiter(6, 5_000),
      reaction: new RateLimiter(10, 5_000),
      join: new RateLimiter(10, 30_000),
    };
  }

  attach(socket) {
    // Connection + clock sync (no room needed)
    this.on(socket, 'time_sync', () => ({ serverTime: Date.now() }), { requiresRoom: false });
    this.on(socket, 'join_room', this.handleJoin, { requiresRoom: false, limiter: 'join' });
    this.on(socket, 'leave_room', this.handleLeave, { requiresRoom: false });
    this.on(socket, 'request_sync', ({ room }) => ({ state: room.playback.snapshot() }));

    // Playback — Host/Moderator only (checked inside Room)
    this.on(socket, 'play', ({ room, userId }) => room.play(userId));
    this.on(socket, 'pause', ({ room, userId }) => room.pause(userId));
    this.on(socket, 'seek', ({ room, userId }, { time }) => room.seek(userId, time));
    this.on(socket, 'change_video', ({ room, userId }, { videoId, url }) =>
      room.changeVideo(userId, videoId ?? url),
    );

    // Participant requests → approval by Host/Moderator
    this.on(socket, 'request_change', ({ room, userId }, { type, payload }) => ({
      request: room.createRequest(userId, type, payload),
    }));
    this.on(socket, 'resolve_request', ({ room, userId }, { requestId, approve }) =>
      room.resolveRequest(userId, requestId, approve === true),
    );
    this.on(socket, 'cancel_request', ({ room, userId }, { requestId }) => room.cancelRequest(userId, requestId));

    // Host-only room management
    this.on(socket, 'assign_role', ({ room, userId }, { userId: target, role }) =>
      room.assignRole(userId, target, role),
    );
    this.on(socket, 'remove_participant', ({ room, userId }, { userId: target }) =>
      room.removeParticipant(userId, target),
    );
    this.on(socket, 'transfer_host', ({ room, userId }, { userId: target }) => room.transferHost(userId, target));

    // Social
    this.on(socket, 'chat_message', ({ room, userId }, { text }) => room.sendChat(userId, text), {
      limiter: 'chat',
    });
    this.on(socket, 'reaction', ({ room, userId }, { emoji }) => room.react(userId, emoji), {
      limiter: 'reaction',
    });

    socket.on('disconnect', () => {
      this.detach(socket);
      for (const limiter of Object.values(this.limiters)) limiter.clear(socket.id);
    });
  }

  on(socket, event, handler, { requiresRoom = true, limiter = 'default' } = {}) {
    socket.on(event, async (payload, ack) => {
      if (typeof payload === 'function') {
        ack = payload;
        payload = {};
      }
      const reply = typeof ack === 'function' ? ack : () => {};
      const data = payload && typeof payload === 'object' ? payload : {};

      try {
        if (!this.limiters[limiter].consume(socket.id)) {
          throw new RoomError('RATE_LIMITED', 'Slow down a little!', 429);
        }
        const context = requiresRoom ? this.context(socket) : { socket };
        const result = await handler.call(this, context, data, socket);
        reply({ ok: true, ...(result ?? {}) });
      } catch (err) {
        if (!(err instanceof RoomError)) console.error(`[socket] ${event} failed:`, err);
        const error = err instanceof RoomError ? err.toJSON() : { code: 'INTERNAL', message: 'Something went wrong.' };
        reply({ ok: false, error });
      }
    });
  }

  context(socket) {
    const { roomId, userId } = socket.data;
    const room = roomId ? this.rooms.getLoadedRoom(roomId) : null;
    if (!room || !userId) throw new RoomError('NOT_IN_ROOM', 'Join a room first.', 403);
    return { room, userId, socket };
  }

  async handleJoin({ socket }, { roomId: rawRoomId, token }) {
    // Only logged-in users can join: the JWT was verified in the handshake (io.use in app.js).
    const account = socket.data.account;
    if (!account) throw new RoomError('UNAUTHORIZED', 'Please log in or sign up to join a room.', 401);

    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) throw new RoomError('ROOM_NOT_FOUND', 'Invalid room code.', 404);
    const username = account.name;

    const room = await this.rooms.getRoom(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'This room does not exist or has expired.', 404);

    // A socket belongs to at most one room at a time.
    if (socket.data.roomId) this.detach(socket);

    const { participant, token: sessionToken } = room.join({
      token,
      username,
      socketId: socket.id,
      accountId: account.id,
    });
    const how = sessionToken === token ? 'rejoined' : 'joined';
    console.log(`[room ${room.id}] ${participant.username} ${how} as ${participant.role} (socket ${socket.id})`);
    socket.data.roomId = room.id;
    socket.data.userId = participant.userId;
    socket.join([room.channel, room.userChannel(participant.userId)]);

    return { token: sessionToken, state: room.stateFor(participant.userId) };
  }

  handleLeave({ socket }) {
    const { roomId, userId } = socket.data;
    const room = roomId ? this.rooms.getLoadedRoom(roomId) : null;
    if (room && userId) {
      socket.leave(room.channel);
      socket.leave(room.userChannel(userId));
      room.leave(userId, socket.id);
    }
    socket.data.roomId = null;
    socket.data.userId = null;
  }

  /** Socket closed or switched rooms: start the reconnect grace period. */
  detach(socket) {
    const { roomId, userId } = socket.data;
    const room = roomId ? this.rooms.getLoadedRoom(roomId) : null;
    if (room && userId) {
      socket.leave(room.channel);
      socket.leave(room.userChannel(userId));
      room.handleDisconnect(userId, socket.id);
    }
    socket.data.roomId = null;
    socket.data.userId = null;
  }
}
