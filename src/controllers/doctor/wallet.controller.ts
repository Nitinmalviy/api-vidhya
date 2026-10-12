import type { Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Doctor } from '../../models/Doctor';
import { WalletEntry } from '../../models/WalletEntry';
import { Withdrawal } from '../../models/Withdrawal';
import { createBankFundAccount, isPayoutsConfigured } from '../../services/razorpayx';
import { getOrCreateWallet, toPaise, toRupees, walletSummary } from '../../services/wallet';
import { MIN_WITHDRAWAL_PAISE, requestWithdrawal } from '../../services/withdrawals';
import type { AuthRequest } from '../../types';
import { NotFoundError, UnauthorizedError } from '../../utils/AppError';

export const bankAccountSchema = z
  .object({
    holderName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits'),
    confirmAccountNumber: z.string().trim(),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, e.g. HDFC0001234'),
  })
  .refine((v) => v.accountNumber === v.confirmAccountNumber, {
    message: 'Account numbers do not match',
    path: ['confirmAccountNumber'],
  });

export const withdrawSchema = z.object({
  // zod's multipleOf(0.01) misfires on floats (100.1 % 0.01 ≠ 0), so check paise directly.
  amount: z.coerce
    .number()
    .positive()
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most 2 decimal places'),
});

const serializeWithdrawal = (w: {
  _id: unknown;
  amount: number;
  status: string;
  mode: string;
  bank: { last4: string; ifsc: string };
  utr?: string;
  failureReason?: string;
  createdAt?: Date;
  processedAt?: Date;
}) => ({
  id: String(w._id),
  amount: toRupees(w.amount),
  status: w.status,
  mode: w.mode,
  bankLast4: w.bank.last4,
  ifsc: w.bank.ifsc,
  utr: w.utr ?? null,
  failureReason: w.failureReason ?? null,
  createdAt: w.createdAt ?? null,
  processedAt: w.processedAt ?? null,
});

/* GET /api/v1/doctor/wallet */
export const getDoctorWallet = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const doctorId = req.user.id;

  const [summary, doctor, withdrawals, wallet] = await Promise.all([
    walletSummary('doctor', doctorId, 30),
    Doctor.findById(doctorId).select('payoutAccount').lean(),
    Withdrawal.find({ doctorId }).sort({ createdAt: -1 }).limit(20).lean(),
    getOrCreateWallet('doctor', doctorId),
  ]);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [totals] = await WalletEntry.aggregate<{ earned: number; reversed: number; withdrawnThisMonth: number }>([
    { $match: { walletId: wallet._id } },
    {
      $group: {
        _id: null,
        earned: { $sum: { $cond: [{ $eq: ['$kind', 'CONSULT_EARNING'] }, '$amount', 0] } },
        reversed: { $sum: { $cond: [{ $eq: ['$kind', 'EARNING_REVERSED'] }, '$amount', 0] } },
        withdrawnThisMonth: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$kind', 'WITHDRAWAL'] }, { $gte: ['$createdAt', monthStart] }] },
              '$amount',
              0,
            ],
          },
        },
      },
    },
  ]);

  const acct = doctor?.payoutAccount;
  res.status(200).json({
    success: true,
    data: {
      available: summary.balance,
      pending: summary.pending,
      lifetimeEarnings: toRupees((totals?.earned ?? 0) - (totals?.reversed ?? 0)),
      withdrawnThisMonth: toRupees(totals?.withdrawnThisMonth ?? 0),
      minWithdrawal: toRupees(MIN_WITHDRAWAL_PAISE),
      payoutsEnabled: isPayoutsConfigured(),
      bankAccount: acct
        ? { holderName: acct.holderName, ifsc: acct.ifsc, last4: acct.last4, addedAt: acct.addedAt }
        : null,
      entries: summary.entries,
      withdrawals: withdrawals.map(serializeWithdrawal),
    },
  });
};

/* PUT /api/v1/doctor/wallet/bank-account */
export const saveBankAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { holderName, accountNumber, ifsc } = req.body as z.infer<typeof bankAccountSchema>;

  const doctor = await Doctor.findById(req.user.id).select('name email phone').lean();
  if (!doctor) throw new NotFoundError('Doctor');

  // The full account number goes to RazorpayX only; we keep the last 4 digits.
  const { contactId, fundAccountId } = await createBankFundAccount({
    doctorId: req.user.id,
    name: doctor.name,
    email: doctor.email,
    phone: doctor.phone,
    holderName,
    ifsc,
    accountNumber,
  });

  const payoutAccount = {
    holderName,
    ifsc,
    last4: accountNumber.slice(-4),
    razorpayContactId: contactId,
    razorpayFundAccountId: fundAccountId,
    addedAt: new Date(),
  };
  await Doctor.updateOne({ _id: req.user.id }, { payoutAccount });

  res.status(200).json({
    success: true,
    message: 'Bank account saved',
    data: { bankAccount: { holderName, ifsc, last4: payoutAccount.last4, addedAt: payoutAccount.addedAt } },
  });
};

/* POST /api/v1/doctor/wallet/withdrawals  { amount } (rupees) */
export const createWithdrawal = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { amount } = req.body as z.infer<typeof withdrawSchema>;
  const w = await requestWithdrawal(req.user.id, toPaise(amount));
  res.status(201).json({
    success: true,
    message: w?.status === 'FAILED' ? 'Withdrawal failed — amount returned to your wallet' : 'Withdrawal started',
    data: { withdrawal: w ? serializeWithdrawal(w) : null },
  });
};

/* GET /api/v1/doctor/wallet/withdrawals */
export const listWithdrawals = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
  const filter = { doctorId: new Types.ObjectId(req.user.id) };
  const [rows, total] = await Promise.all([
    Withdrawal.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Withdrawal.countDocuments(filter),
  ]);
  res.status(200).json({ success: true, data: { withdrawals: rows.map(serializeWithdrawal), total, page, limit } });
};
