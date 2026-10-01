import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { AuthService } from './auth/AuthService.js';
import { RoomManager } from './core/RoomManager.js';
import { createApiRouter } from './routes/api.js';
import { createAuthRouter, optionalAuth } from './routes/auth.js';
import { MessageHandler } from './socket/MessageHandler.js';
import { RoomError } from './utils/errors.js';

/**
 * Builds the HTTP server, the Socket.IO server and the room manager.
 * Kept separate from index.js so tests can spin up a server with an in-memory repository.
 */
export function createServer({ repositories, jwtSecret, clientDist, clientOrigins = null, graceMs, idleUnloadMs }) {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway's proxy: req.ip is the real client IP
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  if (clientOrigins) app.use(cors({ origin: clientOrigins }));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: clientOrigins ? { origin: clientOrigins } : undefined,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 100_000,
  });

  const auth = new AuthService({ users: repositories.users, secret: jwtSecret });
  const manager = new RoomManager({ io, repository: repositories.rooms, graceMs, idleUnloadMs });
  const messageHandler = new MessageHandler(io, manager);

  // Socket.IO middleware: a logged-in client sends its JWT in the handshake
  // (`io(url, { auth: { token } })`). Invalid/missing tokens simply connect as a guest.
  io.use(async (socket, next) => {
    socket.data.account = await auth.verify(socket.handshake.auth?.token);
    next();
  });
  io.on('connection', (socket) => messageHandler.attach(socket));

  app.use('/api/auth', createAuthRouter({ auth }));
  app.use('/api', optionalAuth(auth), createApiRouter({ manager, repository: repositories.rooms }));

  // In production the same service serves the built React app (one URL, no CORS).
  if (clientDist && existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof RoomError) return res.status(err.status).json({ error: err.toJSON() });
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Invalid JSON body.' } });
    }
    console.error('[http]', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
  });

  return { app, httpServer, io, manager, auth };
}
