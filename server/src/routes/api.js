import { Router } from 'express';
import { RoomError } from '../utils/errors.js';
import { RateLimiter } from '../utils/RateLimiter.js';
import { normalizeRoomId } from '../utils/validate.js';

/**
 * Small REST surface for things that happen *before* a socket joins a room.
 * Everything real-time goes over WebSockets.
 */
export function createApiRouter({ manager, repository }) {
  const router = Router();
  const createLimiter = new RateLimiter(10, 60_000);

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', storage: repository.name, uptime: Math.round(process.uptime()), ...manager.stats() });
  });

  // Create a room — only for logged-in users (req.user comes from the JWT).
  // The creator becomes Host and receives the Host session token.
  router.post('/rooms', async (req, res) => {
    if (!req.user) throw new RoomError('UNAUTHORIZED', 'Please log in or sign up to create a room.', 401);
    if (!createLimiter.consume(req.ip)) {
      throw new RoomError('RATE_LIMITED', 'Too many rooms created, try again in a minute.', 429);
    }
    const { roomName, videoUrl } = req.body ?? {};
    const result = await manager.createRoom({
      username: req.user.name,
      roomName,
      videoInput: videoUrl,
      accountId: req.user.id,
    });
    res.status(201).json(result);
  });

  // Check that a room exists before joining (used by the join form and invite links).
  router.get('/rooms/:roomId', async (req, res) => {
    const roomId = normalizeRoomId(req.params.roomId);
    const room = roomId ? await manager.getRoom(roomId) : null;
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'This room does not exist or has expired.', 404);
    res.json(room.summary());
  });

  router.use((_req, _res) => {
    throw new RoomError('NOT_FOUND', 'Unknown API route.', 404);
  });

  return router;
}
