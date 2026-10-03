import mongoose from 'mongoose';

const { Schema } = mongoose;

const memberSchema = new Schema(
  {
    userId: { type: String, required: true },
    tokenHash: { type: String, required: true }, // SHA-256 of the session token, never the token itself
    accountId: { type: String, default: null }, // linked user account (null for guests)
    username: { type: String, required: true },
    role: { type: String, enum: ['host', 'moderator', 'participant', 'viewer'], required: true },
    joinedAt: { type: Date, default: Date.now },
    removed: { type: Boolean, default: false },
  },
  { _id: false },
);

const chatSchema = new Schema(
  {
    id: String,
    userId: String,
    username: String,
    role: String,
    text: String,
    ts: Date,
  },
  { _id: false },
);

const roomSchema = new Schema(
  {
    roomId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    hostUserId: { type: String, default: null },
    playback: {
      videoId: String,
      isPlaying: Boolean,
      position: Number,
      updatedAt: Number, // epoch ms
    },
    members: [memberSchema],
    chat: [chatSchema],
    createdAt: { type: Date, default: Date.now },
    // TTL index: rooms nobody has used for 7 days are deleted automatically by MongoDB.
    lastActiveAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 },
  },
  { versionKey: false },
);

export const RoomModel = mongoose.models.Room || mongoose.model('Room', roomSchema);
