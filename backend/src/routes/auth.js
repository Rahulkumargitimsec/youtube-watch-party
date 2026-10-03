import { Router } from 'express';
import { RoomError } from '../utils/errors.js';
import { RateLimiter } from '../utils/RateLimiter.js';

export function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Attaches `req.user` when a valid JWT is present; guests pass through untouched. */
export function optionalAuth(auth) {
  return async (req, _res, next) => {
    req.user = await auth.verify(bearerToken(req));
    next();
  };
}

export function createAuthRouter({ auth }) {
  const router = Router();
  const limiter = new RateLimiter(20, 60_000);

  router.use((req, _res, next) => {
    if (req.method === 'POST' && !limiter.consume(req.ip)) {
      throw new RoomError('RATE_LIMITED', 'Too many attempts, try again in a minute.', 429);
    }
    next();
  });

  router.post('/signup', async (req, res) => {
    const { name, email, password } = req.body ?? {};
    res.status(201).json(await auth.signup({ name, email, password }));
  });

  router.post('/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    res.json(await auth.login({ email, password }));
  });

  router.get('/me', async (req, res) => {
    const user = await auth.verify(bearerToken(req));
    if (!user) throw new RoomError('UNAUTHORIZED', 'Your session has expired. Please log in again.', 401);
    res.json({ user });
  });

  return router;
}
