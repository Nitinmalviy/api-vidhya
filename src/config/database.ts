import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';
import { WalletEntry } from '../models/WalletEntry';
import { Transaction } from '../models/Transaction';

/**
 * The money indexes are what make replays harmless (one ledger entry per
 * idempotency key, one transaction per Razorpay order). Build them before
 * serving and shout if they can't be built — usually duplicates already exist.
 */
export async function ensureMoneyIndexes(): Promise<boolean> {
  try {
    await Promise.all([WalletEntry.createIndexes(), Transaction.createIndexes()]);
  } catch (err) {
    logger.error({ err }, 'LEDGER: could not build wallet/transaction indexes — duplicate credits are possible until fixed');
  }
  return ledgerIndexOk();
}

/** True when the unique index on walletentries.idempotencyKey exists. */
export async function ledgerIndexOk(): Promise<boolean> {
  try {
    const indexes = await WalletEntry.collection.indexes();
    return indexes.some((i) => i.unique && Object.keys(i.key).join() === 'idempotencyKey');
  } catch {
    return false;
  }
}

/**
 * Drop stale indexes left over from schema migrations.
 * Safe to run repeatedly — errors are silently ignored if the index
 * doesn't exist or the collection hasn't been created yet.
 */
async function dropStaleIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;

  const stale: Array<{ collection: string; index: string }> = [
    // 'mobile' was renamed to 'phone' in the Doctor schema
    { collection: 'doctors', index: 'mobile_1' },
  ];

  for (const { collection, index } of stale) {
    try {
      await db.collection(collection).dropIndex(index);
      logger.info(`Dropped stale index "${index}" from "${collection}"`);
    } catch {
      // Index not found or collection doesn't exist yet — nothing to do
    }
  }
}

export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(env.MONGO_URI);
    logger.info({ host: conn.connection.host }, 'MongoDB connected');
    await dropStaleIndexes();
    if (!(await ensureMoneyIndexes())) logger.error('LEDGER: unique idempotencyKey index is missing on walletentries');
  } catch (error) {
    logger.error({ error }, 'MongoDB connection failed');
    process.exit(1);
  }
};

export const disconnectDB = async (): Promise<void> => {
  await mongoose.connection.close();
};