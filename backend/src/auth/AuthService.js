import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { RoomError } from '../utils/errors.js';
import { cleanUsername, generateId } from '../utils/validate.js';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Sign up / log in with name, email and password.
 *
 * - Passwords are hashed with scrypt (built into Node, memory-hard, salted per user).
 * - After login the client receives a JWT (signed with JWT_SECRET, valid 7 days).
 *   It is sent as `Authorization: Bearer <jwt>` on REST calls and in the Socket.IO
 *   handshake, so the server knows which account a socket belongs to.
 */
export class AuthService {
  constructor({ users, secret, expiresIn = '7d' }) {
    this.users = users;
    this.secret = secret;
    this.expiresIn = expiresIn;
  }

  async signup({ name, email, password }) {
    const cleanName = cleanUsername(name);
    const cleanEmail = normalizeEmail(email);
    validatePassword(password);

    if (await this.users.findByEmail(cleanEmail)) {
      throw new RoomError('EMAIL_TAKEN', 'An account with this email already exists. Try logging in.', 409);
    }

    const user = await this.users.create({
      userId: generateId('acc'),
      name: cleanName,
      email: cleanEmail,
      passwordHash: await hashPassword(password),
      createdAt: new Date(),
    });
    return this.session(user);
  }

  async login({ email, password }) {
    const cleanEmail = normalizeEmail(email);
    if (typeof password !== 'string' || !password) {
      throw new RoomError('INVALID_CREDENTIALS', 'Incorrect email or password.', 401);
    }
    const user = await this.users.findByEmail(cleanEmail);
    // Same error whether the email or the password is wrong — don't reveal which emails exist.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new RoomError('INVALID_CREDENTIALS', 'Incorrect email or password.', 401);
    }
    return this.session(user);
  }

  /** Returns the public account for a valid JWT, or null. */
  async verify(token) {
    if (typeof token !== 'string' || !token) return null;
    try {
      const payload = jwt.verify(token, this.secret);
      const user = await this.users.findById(payload.sub);
      return user ? toPublicUser(user) : null;
    } catch {
      return null;
    }
  }

  session(user) {
    const token = jwt.sign({ sub: user.userId }, this.secret, { expiresIn: this.expiresIn });
    return { token, user: toPublicUser(user) };
  }
}

export function toPublicUser(user) {
  return { id: user.userId, name: user.name, email: user.email, createdAt: user.createdAt };
}

function normalizeEmail(email) {
  const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(value) || value.length > 254) {
    throw new RoomError('INVALID_EMAIL', 'Please enter a valid email address.');
  }
  return value;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw new RoomError('WEAK_PASSWORD', 'Password must be at least 6 characters.');
  }
  if (password.length > 128) {
    throw new RoomError('WEAK_PASSWORD', 'Password must be at most 128 characters.');
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, salt, hashHex] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return timingSafeEqual(expected, actual); // constant-time compare
}
