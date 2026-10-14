import type { Response } from 'express';
import { Types } from 'mongoose';
import { ledgerIndexOk } from '../../config/database';
import type { AdminRequest } from '../../middleware/adminAccess';
import { Patient } from '../../models/Patient';
import { Transaction } from '../../models/Transaction';
import { WalletEntry } from '../../models/WalletEntry';
import { createNotification } from '../../services/notification';
import { InsufficientFundsError, postOnce, toPaise, toRupees } from '../../services/wallet';
import { BadRequestError, NotFoundError } from '../../utils/AppError';
import { logger } from '../../utils/logger';

/* ─────────────────────────────────────────────
   Wallet check: finds top-ups credited more than once and lets a super admin
   take the extra credit back. Reads the ledger, never trusts a cached balance.
───────────────────────────────────────────── */

type CreditCount = { _id: Types.ObjectId; count: number; amount: number; firstAt: Date; lastAt: Date };

/** How many TOPUP credits and TOPUP_REVERSAL debits each top-up transaction has. */
async function creditCounts(transactionIds?: Types.ObjectId[]) {
  const match = transactionIds ? { refId: { $in: transactionIds } } : {};
  const [credits, reversals] = await Promise.all([
    WalletEntry.aggregate<CreditCount>([
      { $match: { kind: 'TOPUP', refType: 'Transaction', ...match } },
      { $group: { _id: '$refId', count: { $sum: 1 }, amount: { $first: '$amount' }, firstAt: { $min: '$createdAt' }, lastAt: { $max: '$createdAt' } } },
    ]),
    WalletEntry.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { kind: 'TOPUP_REVERSAL', refType: 'Transaction', ...match } },
      { $group: { _id: '$refId', count: { $sum: 1 } } },
    ]),
  ]);
  const reversed = new Map(reversals.map((r) => [String(r._id), r.count]));
  return new Map(credits.map((c) => [String(c._id), { ...c, reversed: reversed.get(String(c._id)) ?? 0 }]));
}

/* GET /api/v1/admin/wallet-check */
export const getWalletCheck = async (_req: AdminRequest, res: Response): Promise<void> => {
  const [indexOk, all, recentTx] = await Promise.all([
    ledgerIndexOk(),
    creditCounts(),
    Transaction.find({ type: 'WALLET_TOPUP' }).sort({ createdAt: -1 }).limit(40).lean(),
  ]);

  const duplicateIds = [...all.values()].filter((c) => c.count - c.reversed > 1).map((c) => c._id);
  const dupTx = await Transaction.find({ _id: { $in: duplicateIds } }).lean();

  const patientIds = [...new Set([...dupTx, ...recentTx].map((t) => String(t.patientId)))];
  const patients = new Map(
    (await Patient.find({ _id: { $in: patientIds } }).select('name phone').lean()).map((p) => [String(p._id), p])
  );

  const row = (t: (typeof recentTx)[number]) => {
    const c = all.get(String(t._id));
    const p = patients.get(String(t.patientId));
    return {
      transactionId: String(t._id),
      patient: { id: String(t.patientId), name: p?.name ?? 'Patient', phone: p?.phone ?? null },
      amount: t.amount,
      status: t.status,
      orderId: t.razorpayOrderId,
      paymentId: t.razorpayPaymentId ?? null,
      orderedAt: (t as { createdAt?: Date }).createdAt ?? null,
      credits: c?.count ?? 0,
      reversed: c?.reversed ?? 0,
      firstCreditAt: c?.firstAt ?? null,
      lastCreditAt: c?.lastAt ?? null,
    };
  };

  res.status(200).json({
    success: true,
    data: {
      ledgerIndexOk: indexOk,
      duplicates: dupTx.map(row).map((r) => ({ ...r, extra: r.credits - r.reversed - 1 })),
      recent: recentTx.map(row),
    },
  });
};

/**
 * POST /api/v1/admin/wallet-check/:transactionId/reverse (super admin)
 * Debits each extra credit of one top-up. Idempotent: reversal n has its own key.
 */
export const reverseDuplicateTopup = async (req: AdminRequest, res: Response): Promise<void> => {
  const id = req.params.transactionId;
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Top-up');
  const tx = await Transaction.findOne({ _id: id, type: 'WALLET_TOPUP' }).lean();
  if (!tx) throw new NotFoundError('Top-up');

  const c = (await creditCounts([new Types.ObjectId(id)])).get(id);
  if (!c || c.count - c.reversed <= 1) throw new BadRequestError('This top-up was credited only once — nothing to reverse');

  const amount = c.amount || toPaise(tx.amount);
  let reversedNow = 0;
  for (let n = c.reversed + 1; n <= c.count - 1; n += 1) {
    try {
      const done = await postOnce(`topup-reversal:${id}:${n}`, [
        {
          ownerType: 'patient',
          ownerId: String(tx.patientId),
          bucket: 'balance',
          direction: 'DEBIT',
          amount,
          kind: 'TOPUP_REVERSAL',
          description: `Correction · duplicate credit of top-up ${tx.razorpayOrderId}`,
          refType: 'Transaction',
          refId: String(tx._id),
        },
      ]);
      if (done) reversedNow += 1;
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new BadRequestError(
          `The patient has already spent part of the extra ₹${toRupees(amount)}${reversedNow ? ` (${reversedNow} reversed)` : ''}. Reverse the rest once their balance allows, or settle it with them directly.`
        );
      }
      throw err;
    }
  }

  logger.warn({ transactionId: id, reversedNow, by: req.admin?.id }, 'WALLET: duplicate top-up credit reversed');
  if (reversedNow) {
    await createNotification({
      userId: String(tx.patientId),
      role: 'patient',
      type: 'GENERAL',
      title: 'Wallet corrected',
      message: `Your ₹${tx.amount.toLocaleString('en-IN')} top-up was credited more than once by mistake. We removed the extra ₹${(toRupees(amount) * reversedNow).toLocaleString('en-IN')}.`,
    }).catch(() => undefined);
  }

  res.status(200).json({
    success: true,
    message: reversedNow ? `Removed ${reversedNow} extra credit${reversedNow > 1 ? 's' : ''}` : 'Already corrected',
  });
};
