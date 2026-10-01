import 'dotenv/config';
import { randomBytes } from 'node:crypto';

const splitList = (value) =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : null;

const isProduction = process.env.NODE_ENV === 'production';

function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isProduction) throw new Error('JWT_SECRET must be set in production.');
  console.warn('[auth] JWT_SECRET not set — using a random dev secret (logins reset on restart).');
  return randomBytes(32).toString('hex');
}

export const config = Object.freeze({
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  mongoUri: process.env.MONGODB_URI || '',
  // Secret used to sign login tokens (JWT). Must be a long random string in production.
  jwtSecret: jwtSecret(),
  // Only needed when the frontend is hosted on a different origin (e.g. Netlify + Render).
  clientOrigins: splitList(process.env.CLIENT_ORIGIN),
  // How long a disconnected user keeps their seat (page refresh, flaky network).
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS) || 15_000,
  // How long an empty room stays in memory before it is unloaded (it stays in MongoDB).
  idleRoomUnloadMs: Number(process.env.IDLE_ROOM_UNLOAD_MS) || 10 * 60_000,
});
