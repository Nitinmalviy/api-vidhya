import type { Request, Response } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { Transaction } from '../models/Transaction';
import { Patient } from '../models/Patient';
import { Appointment } from '../models/Appointment';
import { Types } from 'mongoose';

// Initialize Razorpay with environment variables or fallback test keys
const razorpay = new Razorpay({
  key_id: process.env.Test_Key_ID || process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_key',
  key_secret: process.env.Test_Key_Secret || process.env.RAZORPAY_KEY_SECRET || 'rzp_test_mock_secret',
});

/**
 * POST /api/v1/payments/create-order
 * Creates a Razorpay order and returns it to the client
 */
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount, type, metadata } = req.body;
    const patientId = (req as any).user?.id; // Assumes auth middleware populates req.user

    if (!patientId || !amount || !type) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
      return;
    }

    // Create order on Razorpay
    const options = {
      amount: amount * 100, // Razorpay works in paise
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    const orderId = order.id;

    // Create a pending transaction in DB
    const transaction = await Transaction.create({
      patientId: new Types.ObjectId(patientId),
      amount,
      currency: 'INR',
      type,
      status: 'PENDING',
      razorpayOrderId: orderId,
      metadata,
    });

    res.status(200).json({
      success: true,
      data: {
        orderId,
        amount: options.amount,
        currency: options.currency,
        key: process.env.Test_Key_ID || process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_key',
        transactionId: transaction._id,
      },
    });
  } catch (error) {
    req.log.error(error, 'Error creating order');
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
};

/**
 * GET /api/v1/payments/history
 * The signed-in patient's transactions, newest first — powers the
 * subscription/billing history and invoices in the apps.
 */
export const getPaymentHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const patientId = (req as any).user?.id;
    if (!patientId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const transactions = await Transaction.find({ patientId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        transactions: transactions.map((t) => ({
          id: String(t._id),
          // Stable human-readable invoice number derived from the record
          invoiceNo: `VC-${String(t._id).slice(-8).toUpperCase()}`,
          amount: t.amount,
          currency: t.currency,
          type: t.type,
          status: t.status,
          planId: t.metadata?.planId ?? null,
          planName: t.metadata?.planName ?? null,
          razorpayOrderId: t.razorpayOrderId,
          razorpayPaymentId: t.razorpayPaymentId ?? null,
          createdAt: (t as { createdAt?: Date }).createdAt ?? null,
        })),
      },
    });
  } catch (error) {
    req.log.error(error, 'Error fetching payment history');
    res.status(500).json({ success: false, message: 'Failed to load payment history' });
  }
};

/**
 * POST /api/v1/payments/verify
 * Verifies the Razorpay signature and updates transaction status
 */
export const verifyPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Validate Signature
    const secret = process.env.Test_Key_Secret || process.env.RAZORPAY_KEY_SECRET || 'rzp_test_mock_secret';
    
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      res.status(400).json({ success: false, message: 'Invalid signature' });
      return;
    }

    // Find and update transaction
    const transaction = await Transaction.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { 
        status: 'SUCCESS',
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature
      },
      { new: true }
    );

    if (!transaction) {
      res.status(404).json({ success: false, message: 'Transaction not found' });
      return;
    }

    // Fulfill business logic based on type
    if (transaction.type === 'SUBSCRIPTION') {
      await Patient.findByIdAndUpdate(transaction.patientId, { plan: 'PREMIUM' });
    } else if (transaction.type === 'APPOINTMENT') {
      if (transaction.metadata?.appointmentId) {
        await Appointment.findByIdAndUpdate(transaction.metadata.appointmentId, { paymentStatus: 'PAID' });
      }
    }

    res.status(200).json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    req.log.error(error, 'Error verifying payment');
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
};
