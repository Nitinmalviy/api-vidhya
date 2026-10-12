import type { Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { razorpay, RAZORPAY_KEY_ID, isRazorpayConfigured, verifyOrderSignature } from '../../config/razorpay';
import { Appointment } from '../../models/Appointment';
import { Doctor } from '../../models/Doctor';
import { Transaction } from '../../models/Transaction';
import { createNotification } from '../../services/notification';
import {
  creditTopup,
  getOrCreateWallet,
  inTransaction,
  notifyAppointmentPaid,
  settleAppointmentPayment,
  toPaise,
  toRupees,
  walletSummary,
} from '../../services/wallet';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, ServiceUnavailableError, UnauthorizedError } from '../../utils/AppError';
import { logger } from '../../utils/logger';

/**
 * The patient wallet is closed-loop: money can be added and spent on
 * VidhyaCare, and refunds land back in it, but it cannot be cashed out.
 */
export const MIN_TOPUP = 10; // ₹
export const MAX_TOPUP = 50_000; // ₹ per top-up
export const MAX_BALANCE = 1_00_000; // ₹

export const topupOrderSchema = z.object({
  amount: z.coerce.number().int('Whole rupees only').min(MIN_TOPUP).max(MAX_TOPUP),
});

export const verifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export const payAppointmentSchema = z.object({
  appointmentId: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid appointment id'),
});

/* GET /api/v1/patient/wallet */
export const getWallet = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const limit = Number(req.query.limit ?? 50) || 50;
  const data = await walletSummary('patient', req.user.id, limit);
  res.status(200).json({ success: true, data: { ...data, limits: { minTopup: MIN_TOPUP, maxTopup: MAX_TOPUP, maxBalance: MAX_BALANCE } } });
};

/* POST /api/v1/patient/wallet/topup/order  { amount } (rupees) */
export const createTopupOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (!isRazorpayConfigured()) throw new ServiceUnavailableError('Payments are not configured');
  const { amount } = req.body as z.infer<typeof topupOrderSchema>;

  const wallet = await getOrCreateWallet('patient', req.user.id);
  if (toRupees(wallet.balance) + amount > MAX_BALANCE) {
    throw new BadRequestError(`Wallet balance cannot exceed ₹${MAX_BALANCE.toLocaleString('en-IN')}`);
  }

  const order = await razorpay.orders.create({
    amount: toPaise(amount),
    currency: 'INR',
    receipt: `wallet_${Date.now()}`,
    // Lets the payment.captured webhook credit the wallet even if the app
    // closes before /verify is called.
    notes: { kind: 'WALLET_TOPUP', patientId: req.user.id },
  });

  const tx = await Transaction.create({
    patientId: req.user.id,
    amount,
    currency: 'INR',
    type: 'WALLET_TOPUP',
    status: 'PENDING',
    razorpayOrderId: order.id,
  });

  res.status(200).json({
    success: true,
    data: { orderId: order.id, amount: toPaise(amount), currency: 'INR', key: RAZORPAY_KEY_ID, transactionId: tx._id },
  });
};

/**
 * Credits a verified top-up exactly once. Shared by /verify and the webhook,
 * whichever arrives first; the other becomes a no-op.
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

/* POST /api/v1/patient/wallet/topup/verify */
export const verifyTopup = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body as z.infer<typeof verifySchema>;

  if (!verifyOrderSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    throw new BadRequestError('Payment could not be verified');
  }
  // The order must belong to the caller — a valid signature alone only proves Razorpay saw a payment.
  const owned = await Transaction.exists({ razorpayOrderId: razorpay_order_id, patientId: req.user.id, type: 'WALLET_TOPUP' });
  if (!owned) throw new NotFoundError('Top-up');

  await completeTopup(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  const data = await walletSummary('patient', req.user.id, 20);
  res.status(200).json({ success: true, message: 'Money added to your wallet', data });
};

/* POST /api/v1/patient/wallet/pay-appointment  { appointmentId } */
export const payAppointmentFromWallet = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const patientId = req.user.id;
  const { appointmentId } = req.body as z.infer<typeof payAppointmentSchema>;

  const appt = await Appointment.findOne({ _id: appointmentId, patientId }).lean();
  if (!appt) throw new NotFoundError('Appointment');
  if (appt.paymentStatus === 'PAID') throw new BadRequestError('This appointment is already paid');
  if (appt.status !== 'BOOKED') throw new BadRequestError('Only upcoming appointments can be paid');
  if (appt.source === 'OFFLINE') throw new BadRequestError('This visit was booked at the clinic — please pay at the clinic.');

  // Price comes from the server, never the client.
  const doctor = await Doctor.findById(appt.doctorId).select('consultationFee').lean();
  const rupees = appt.price ?? doctor?.consultationFee;
  if (!rupees || rupees <= 0) throw new BadRequestError('This appointment has no fee to pay');
  const amount = toPaise(rupees);

  await inTransaction((session) =>
    settleAppointmentPayment({ appointmentId, patientId, amount, method: 'WALLET', session })
  );
  await notifyAppointmentPaid(appointmentId);

  const data = await walletSummary('patient', patientId, 20);
  res.status(200).json({ success: true, message: 'Paid from wallet', data });
};
