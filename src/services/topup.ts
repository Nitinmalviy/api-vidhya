import { Transaction } from '../models/Transaction';
import { createNotification } from './notification';
import { inTransaction, isDuplicateKey, post, toPaise, topupPosting } from './wallet';
import { logger } from '../utils/logger';

/** "12 Oct, 3:40 pm" when the order is over 15 minutes old, else null. */
function lateNote(tx: { createdAt?: Date }): string | null {
  if (!tx.createdAt || Date.now() - new Date(tx.createdAt).getTime() < 15 * 60_000) return null;
  return new Date(tx.createdAt).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Credits a top-up exactly once; verify, webhook and sync can all call it and
 * only the first one credits. Call only after ensureCaptured said 'captured'.
 */
export async function completeTopup(orderId: string, paymentId: string, signature?: string): Promise<boolean> {
  const tx = await Transaction.findOne({ razorpayOrderId: orderId, type: 'WALLET_TOPUP' }).lean();
  if (!tx) return false;
  const { key, ops } = topupPosting({
    patientId: String(tx.patientId),
    amount: toPaise(tx.amount),
    transactionId: String(tx._id),
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
  });

  // Two independent locks in ONE MongoDB transaction: the top-up must move out of
  // PENDING here (only one request can do that), and the ledger key must be new.
  // Verify, webhook and sync racing each other therefore credit exactly once.
  let credited = false;
  try {
    credited = await inTransaction(async (session) => {
      const claimed = await Transaction.findOneAndUpdate(
        { _id: tx._id, status: { $ne: 'SUCCESS' } },
        { $set: { status: 'SUCCESS', razorpayPaymentId: paymentId, ...(signature ? { razorpaySignature: signature } : {}) } },
        { new: true, session }
      );
      if (!claimed) return false;
      return post(key, ops, session);
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
  if (credited) logger.info({ orderId, paymentId, transactionId: String(tx._id) }, 'WALLET: top-up credited');

  if (credited) {
    try {
      await createNotification({
        userId: String(tx.patientId),
        role: 'patient',
        type: 'GENERAL',
        title: 'Money added to wallet',
        // A payment confirmed long after it was started (late UPI, sync) says so, so
        // it isn't mistaken for a second credit of today's top-up.
        message: lateNote(tx as { createdAt?: Date })
          ? `Your ₹${tx.amount.toLocaleString('en-IN')} payment started on ${lateNote(tx as { createdAt?: Date })} was confirmed and added to your wallet.`
          : `₹${tx.amount.toLocaleString('en-IN')} was added to your VidhyaCare wallet.`,
      });
    } catch (err) {
      logger.warn({ err }, 'Top-up notification failed');
    }
  }
  return credited;
}

