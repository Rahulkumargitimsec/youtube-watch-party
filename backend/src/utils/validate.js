import { randomBytes } from 'node:crypto';
import { RoomError } from './errors.js';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
const MAX_VIDEO_SECONDS = 24 * 60 * 60;

const collapse = (value) => value.replace(/\s+/g, ' ').trim();

export function cleanUsername(value) {
  if (typeof value !== 'string') throw new RoomError('INVALID_USERNAME', 'Please enter a name.');
  const name = collapse(value);
  if (name.length < 1 || name.length > 24) {
    throw new RoomError('INVALID_USERNAME', 'Name must be between 1 and 24 characters.');
  }
  return name;
}

export function cleanRoomName(value) {
  const name = typeof value === 'string' ? collapse(value) : '';
  if (name.length < 2 || name.length > 40) {
    throw new RoomError('INVALID_ROOM_NAME', 'Room name is required (2–40 characters).');
  }
  return name;
}

export function normalizeRoomId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(id) ? id : null;
}

export function cleanTime(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time < 0 || time > MAX_VIDEO_SECONDS) {
    throw new RoomError('INVALID_TIME', 'Invalid seek position.');
  }
  return Math.round(time * 1000) / 1000;
}

export function cleanText(value, maxLength) {
  if (typeof value !== 'string') throw new RoomError('INVALID_MESSAGE', 'Message cannot be empty.');
  const text = value.trim();
  if (!text) throw new RoomError('INVALID_MESSAGE', 'Message cannot be empty.');
  if (text.length > maxLength) {
    throw new RoomError('INVALID_MESSAGE', `Message must be at most ${maxLength} characters.`);
  }
  return text;
}

export function generateRoomCode(length = 6) {
  const bytes = randomBytes(length);
  let code = '';
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  return code;
}

export function generateId(prefix, bytes = 6) {
  return `${prefix}_${randomBytes(bytes).toString('hex')}`;
}
