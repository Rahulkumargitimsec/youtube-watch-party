import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './app.js';
import { config } from './config.js';
import { createRepositories } from './db/repositories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const repositories = await createRepositories(config);
  const { httpServer, io, manager } = createServer({
    repositories,
    jwtSecret: config.jwtSecret,
    clientDist: path.resolve(__dirname, '../../frontend/dist'),
    clientOrigins: config.clientOrigins,
    graceMs: config.reconnectGraceMs,
    idleUnloadMs: config.idleRoomUnloadMs,
  });

  httpServer.listen(config.port, () => {
    console.log(`[server] Watch Party listening on http://localhost:${config.port} (${config.nodeEnv})`);
  });

  // Graceful shutdown: flush unsaved room state to MongoDB before exiting.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down…`);
    io.close();
    await manager.shutdown();
    await repositories.rooms.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
