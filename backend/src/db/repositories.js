import mongoose from 'mongoose';
import { RoomModel } from './RoomModel.js';
import { UserModel } from './UserModel.js';
import { RoomError } from '../utils/errors.js';

/**
 * Repository pattern: RoomManager only knows `findById / exists / save`, so storage
 * can be MongoDB in production and an in-memory Map in tests or quick local runs.
 */
export class MongoRoomRepository {
  name = 'mongodb';

  async findById(roomId) {
    return RoomModel.findOne({ roomId }).lean();
  }

  async exists(roomId) {
    return Boolean(await RoomModel.exists({ roomId }));
  }

  async save(doc) {
    await RoomModel.updateOne({ roomId: doc.roomId }, { $set: doc }, { upsert: true });
  }

  async close() {
    await mongoose.disconnect();
  }
}

export class MemoryRoomRepository {
  name = 'memory';
  store = new Map();

  async findById(roomId) {
    const doc = this.store.get(roomId);
    return doc ? structuredClone(doc) : null;
  }

  async exists(roomId) {
    return this.store.has(roomId);
  }

  async save(doc) {
    this.store.set(doc.roomId, structuredClone(doc));
  }

  async close() {}
}

export class MongoUserRepository {
  async findByEmail(email) {
    return UserModel.findOne({ email }).lean();
  }

  async findById(userId) {
    return UserModel.findOne({ userId }).lean();
  }

  async create(user) {
    try {
      return (await UserModel.create(user)).toObject();
    } catch (err) {
      // Unique index on email: two signups racing with the same address.
      if (err.code === 11000) {
        throw new RoomError('EMAIL_TAKEN', 'An account with this email already exists. Try logging in.', 409);
      }
      throw err;
    }
  }
}

export class MemoryUserRepository {
  byId = new Map();

  async findByEmail(email) {
    for (const user of this.byId.values()) if (user.email === email) return structuredClone(user);
    return null;
  }

  async findById(userId) {
    const user = this.byId.get(userId);
    return user ? structuredClone(user) : null;
  }

  async create(user) {
    this.byId.set(user.userId, structuredClone(user));
    return structuredClone(user);
  }
}

/**
 * Connects to MongoDB when MONGODB_URI is set. In development it falls back to the
 * in-memory store if MongoDB is unreachable, so the app still runs; in production a
 * failed connection is fatal (the platform restarts the service).
 */
export async function createRepositories({ mongoUri, isProduction }) {
  if (!mongoUri) {
    console.warn('[db] MONGODB_URI not set — using in-memory storage (data is lost on restart).');
    return { rooms: new MemoryRoomRepository(), users: new MemoryUserRepository() };
  }

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([RoomModel.init(), UserModel.init()]); // make sure unique + TTL indexes exist
    console.log(`[db] connected to MongoDB (${mongoose.connection.name})`);
    return { rooms: new MongoRoomRepository(), users: new MongoUserRepository() };
  } catch (err) {
    if (isProduction) throw err;
    console.warn(`[db] could not connect to MongoDB (${err.message}) — falling back to in-memory storage.`);
    return { rooms: new MemoryRoomRepository(), users: new MemoryUserRepository() };
  }
}
