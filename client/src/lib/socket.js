import { io } from 'socket.io-client';
import { SERVER_URL } from './api.js';

/** `authToken` (JWT) is sent in the handshake so the server knows the logged-in account. */
export function createSocket(authToken) {
  return io(SERVER_URL || undefined, {
    autoConnect: false,
    auth: authToken ? { token: authToken } : {},
    transports: ['websocket', 'polling'], // try a real WebSocket first
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });
}

/** Emit and wait for the server's `{ ok, ... }` acknowledgement. Never throws. */
export async function emitAck(socket, event, payload = {}, timeoutMs = 8000) {
  try {
    return await socket.timeout(timeoutMs).emitWithAck(event, payload);
  } catch {
    return { ok: false, error: { code: 'TIMEOUT', message: 'The server did not respond. Check your connection.' } };
  }
}

/**
 * Estimates (serverClock - clientClock) in ms, NTP style: take the fastest of a few
 * round trips and assume the server answered halfway through it.
 */
export async function measureClockOffset(socket, samples = 4) {
  let best = null;
  for (let i = 0; i < samples; i += 1) {
    const t0 = Date.now();
    const res = await emitAck(socket, 'time_sync', {}, 3000);
    const t1 = Date.now();
    if (!res.ok) continue;
    const rtt = t1 - t0;
    if (!best || rtt < best.rtt) best = { rtt, offset: res.serverTime - (t0 + t1) / 2 };
  }
  return best ?? { rtt: 0, offset: 0 };
}
