import mongoose, { Schema } from 'mongoose';

/**
 * One counter per (limiter, client) pair. Lives in MongoDB rather than memory
 * because on Vercel each serverless instance has its own memory, so an
 * in-memory counter would reset on every cold start and differ per instance.
 */
export interface IRateLimitHit {
  _id: string;
  hits: number;
  resetAt: Date;
}

const rateLimitHitSchema = new Schema<IRateLimitHit>(
  {
    _id: { type: String, required: true },
    hits: { type: Number, required: true, default: 0 },
    // TTL index: Mongo drops the counter once its window is over.
    resetAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { versionKey: false }
);

export const RateLimitHit = mongoose.model<IRateLimitHit>('RateLimitHit', rateLimitHitSchema);
