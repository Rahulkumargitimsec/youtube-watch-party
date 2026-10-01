import { Room } from './Room.js';
import { RoomError } from '../utils/errors.js';
import { cleanRoomName, generateRoomCode } from '../utils/validate.js';
import { DEFAULT_VIDEO_ID, extractVideoId } from '../utils/youtube.js';

/**
 * Owns every Room that is live on this server.
 *
 * - Rooms are loaded lazily from the repository (MongoDB) the first time someone joins.
 * - Changes are written back with a small debounce so a burst of seeks = one DB write.
 * - Empty rooms are unloaded from memory after a while; they stay in the database, so
 *   the invite link keeps working.
 */
export class RoomManager {
  constructor({ io, repository, graceMs = 15_000, idleUnloadMs = 10 * 60_000, saveDebounceMs = 750 }) {
    this.io = io;
    this.repository = repository;
    this.graceMs = graceMs;
    this.idleUnloadMs = idleUnloadMs;
    this.saveDebounceMs = saveDebounceMs;

    this.rooms = new Map();
    this.loading = new Map();
    this.saveTimers = new Map();
    this.unloadTimers = new Map();
  }

  roomDeps(getRoom) {
    return {
      io: this.io,
      graceMs: this.graceMs,
      onChange: () => this.scheduleSave(getRoom()),
      onEmpty: () => this.scheduleUnload(getRoom()),
    };
  }

  async createRoom({ username, roomName, videoInput, accountId = null }) {
    const name = cleanRoomName(roomName);
    let videoId = DEFAULT_VIDEO_ID;
    if (videoInput) {
      videoId = extractVideoId(videoInput);
      if (!videoId) throw new RoomError('INVALID_VIDEO', 'That does not look like a YouTube link or video id.');
    }

    const id = await this.generateUniqueId();
    let room;
    room = new Room(
      { id, name, playback: { videoId } },
      this.roomDeps(() => room),
    );
    const { participant, token } = room.createHost(username, accountId);

    this.rooms.set(id, room);
    await this.repository.save(room.toDocument());
    this.scheduleUnload(room); // in case the creator never actually joins

    return { roomId: id, name: room.name, userId: participant.userId, token };
  }

  async generateUniqueId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = generateRoomCode();
      if (!this.rooms.has(id) && !(await this.repository.exists(id))) return id;
    }
    throw new RoomError('ROOM_ID_EXHAUSTED', 'Could not create a room, please try again.', 503);
  }

  /** Returns the live room, loading it from the database if needed (or null). */
  async getRoom(roomId) {
    if (this.rooms.has(roomId)) return this.rooms.get(roomId);
    if (this.loading.has(roomId)) return this.loading.get(roomId);

    const promise = (async () => {
      const doc = await this.repository.findById(roomId);
      if (!doc) return null;
      let room;
      room = Room.fromDocument(doc, this.roomDeps(() => room));
      this.rooms.set(roomId, room);
      return room;
    })().finally(() => this.loading.delete(roomId));

    this.loading.set(roomId, promise);
    return promise;
  }

  getLoadedRoom(roomId) {
    return this.rooms.get(roomId) ?? null;
  }

  scheduleSave(room) {
    if (!room || this.saveTimers.has(room.id)) return;
    const timer = setTimeout(() => {
      this.saveTimers.delete(room.id);
      this.persist(room);
    }, this.saveDebounceMs);
    timer.unref?.();
    this.saveTimers.set(room.id, timer);
  }

  async persist(room) {
    try {
      await this.repository.save(room.toDocument());
    } catch (err) {
      console.error(`[rooms] failed to save room ${room.id}:`, err.message);
    }
  }

  scheduleUnload(room) {
    if (!room) return;
    clearTimeout(this.unloadTimers.get(room.id));
    const timer = setTimeout(async () => {
      this.unloadTimers.delete(room.id);
      if (room.activeMembers().length > 0) return;
      await this.flush(room);
      room.dispose();
      this.rooms.delete(room.id);
    }, this.idleUnloadMs);
    timer.unref?.();
    this.unloadTimers.set(room.id, timer);
  }

  async flush(room) {
    clearTimeout(this.saveTimers.get(room.id));
    this.saveTimers.delete(room.id);
    await this.persist(room);
  }

  async shutdown() {
    await Promise.all([...this.rooms.values()].map((room) => this.flush(room)));
    for (const room of this.rooms.values()) room.dispose();
    for (const timer of this.unloadTimers.values()) clearTimeout(timer);
  }

  stats() {
    let participants = 0;
    for (const room of this.rooms.values()) participants += room.activeMembers().length;
    return { liveRooms: this.rooms.size, participants };
  }
}
