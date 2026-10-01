import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true }, // "scrypt:<salt>:<hash>", never the plain password
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export const UserModel = mongoose.models.User || mongoose.model('User', userSchema);
