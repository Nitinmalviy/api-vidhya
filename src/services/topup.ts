import { Transaction } from '../models/Transaction';
import { createNotification } from './notification';
import { creditTopup, toPaise } from './wallet';
import { logger } from '../utils/logger';

/**
 * Credits a top-up exactly once; verify, webhook and sync can all call it and
 * only the first one credits. Call only after ensureCaptured said 'captured'.
 */
export async function completeTopup(orderId: string, paymentId: string, signature?: string): Promise<boolean> {
  const tx = await Transaction.findOne({ razorpayOrderId: orderId, type: 'WALLET_TOPUP' });
  if (!tx) return false;

  const credited = await creditTopup({
    patientId: String(tx.patientId),
    amount: toPaise(tx.amount),
    transactionId: String(tx._id),
    razorpayOrderId: orderId,
  });

  await Transaction.updateOne(
    { _id: tx._id, status: { $ne: 'SUCCESS' } },
    { status: 'SUCCESS', razorpayPaymentId: paymentId, ...(signature ? { razorpaySignature: signature } : {}) }
  );

  if (credited) {
    try {
      await createNotification({
        userId: String(tx.patientId),
        role: 'patient',
        type: 'GENERAL',
        title: 'Money added to wallet',
        message: `₹${tx.amount.toLocaleString('en-IN')} was added to your VidhyaCare wallet.`,
      });
    } catch (err) {
      logger.warn({ err }, 'Top-up notification failed');
    }
  }
  return credited;
}

