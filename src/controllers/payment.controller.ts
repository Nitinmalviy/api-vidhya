import type { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import {
  razorpay,
  RAZORPAY_KEY_ID,
  PLAN_PRICES,
  PLAN_NAMES,
  verifyOrderSignature,
} from '../config/razorpay';
import { Doctor } from '../models/Doctor';
import { LabBooking } from '../models/LabBooking';
import { inTransaction, notifyAppointmentPaid, postOnce, settleAppointmentPayment, toPaise } from '../services/wallet';
import { completeTopup } from './patient/wallet.controller';
import { Transaction, type ITransaction } from '../models/Transaction';
import { Patient } from '../models/Patient';
import { Appointment } from '../models/Appointment';
import { Types } from 'mongoose';
import { createNotification } from '../services/notification';
import { sendEmail, subscriptionReceiptEmailTemplate } from '../services/email';

/** One subscription cycle = 30 days. */
const PLAN_DURATION_DAYS = 30;

/** Stable, human-readable receipt/invoice number derived from a transaction id. */
const receiptNo = (id: string): string => `VC-${id.slice(-8).toUpperCase()}`;

const fmtDate = (d: Date): string =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Builds a professional subscription receipt PDF and resolves to a Buffer. */
function buildSubscriptionReceiptPdf(t: ITransaction & { _id: unknown; createdAt?: Date }, patientName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const id = String(t._id);
    const start = (t.createdAt ?? new Date()) as Date;
    const expires = new Date(start.getTime() + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const planName = t.metadata?.planName ?? 'Premium';
    const price = t.amount;
    const gstAmount = (price - price / 1.18).toFixed(2);
    const basePrice = (price / 1.18).toFixed(2);

    // Header
    doc.fontSize(24).fillColor('#2563EB').text('VidhyaCare', { align: 'right' });
    doc.fontSize(10).fillColor('#666666').text('VidhyaCare Health Services Pvt Ltd', { align: 'right' });
    doc.text('GSTIN: 22AAAAA0000A1Z5', { align: 'right' });
    doc.moveDown(2);

    doc.fontSize(20).fillColor('#000000').text('SUBSCRIPTION RECEIPT', { underline: true });
    doc.moveDown();

    doc.fontSize(12);
    doc.text(`Receipt Number: ${receiptNo(id)}`);
    doc.text(`Date: ${fmtDate(start)}`);
    doc.moveDown();

    doc.text(`Billed To: ${patientName}`);
    doc.text(`Plan: ${planName} (1 month)`);
    doc.text(`Valid: ${fmtDate(start)} — ${fmtDate(expires)}`);
    if (t.razorpayPaymentId) doc.text(`Payment Ref: ${t.razorpayPaymentId}`);
    doc.moveDown(2);

    const tableTop = doc.y;
    doc.font('Helvetica-Bold');
    doc.text('Description', 50, tableTop);
    doc.text('Amount (INR)', 400, tableTop, { width: 100, align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(500, tableTop + 15).stroke();

    doc.font('Helvetica');
    const row1 = tableTop + 25;
    doc.text(`${planName} plan — 1 month`, 50, row1);
    doc.text(`Rs. ${basePrice}`, 400, row1, { width: 100, align: 'right' });

    const row2 = row1 + 20;
    doc.text('GST (18%)', 50, row2);
    doc.text(`Rs. ${gstAmount}`, 400, row2, { width: 100, align: 'right' });

    doc.moveTo(50, row2 + 20).lineTo(500, row2 + 20).stroke();

    const totalRow = row2 + 30;
    doc.font('Helvetica-Bold');
    doc.text('Total Paid', 50, totalRow);
    doc.text(`Rs. ${price.toFixed(2)}`, 400, totalRow, { width: 100, align: 'right' });

    doc.moveDown(6);
    doc.font('Helvetica');
    doc.text('For VidhyaCare Health Services Pvt Ltd', { align: 'right' });
    doc.moveDown(2);
    doc.text('Authorized Signatory', { align: 'right' });

    doc.end();
  });
}

/**
 * POST /api/v1/payments/create-order
 * Creates a Razorpay order and returns it to the client
 */
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, metadata } = req.body ?? {};
    const patientId = (req as any).user?.id;

    if (!patientId || !type) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
      return;
    }

    // The price is always decided here. Never trust an `amount` from the client —
    // it previously allowed buying a plan for ₹1.
    let amount: number;
    let orderMeta: Record<string, unknown>;
    if (type === 'SUBSCRIPTION') {
      const planId = metadata?.planId;
      if (planId !== 'single' && planId !== 'family') {
        res.status(400).json({ success: false, message: "planId must be 'single' or 'family'" });
        return;
      }
      amount = PLAN_PRICES[planId as 'single' | 'family'];
      orderMeta = { planId, planName: PLAN_NAMES[planId as 'single' | 'family'] };
    } else if (type === 'APPOINTMENT') {
      const appointmentId = String(metadata?.appointmentId ?? '');
      const appt = Types.ObjectId.isValid(appointmentId)
        ? await Appointment.findOne({ _id: appointmentId, patientId }).lean()
        : null;
      if (!appt) {
        res.status(404).json({ success: false, message: 'Appointment not found' });
        return;
      }
      if (appt.status !== 'BOOKED' || appt.paymentStatus === 'PAID') {
        res.status(400).json({ success: false, message: 'This appointment is already paid or no longer payable' });
        return;
      }
      const doctor = await Doctor.findById(appt.doctorId).select('consultationFee').lean();
      const fee = appt.price ?? doctor?.consultationFee;
      if (!fee || fee <= 0) {
        res.status(400).json({ success: false, message: 'This appointment has no fee to pay' });
        return;
      }
      amount = fee;
      orderMeta = { appointmentId };
    } else if (type === 'LAB_BOOKING') {
      const labBookingId = String(metadata?.labBookingId ?? '');
      const booking = Types.ObjectId.isValid(labBookingId)
        ? await LabBooking.findOne({ _id: labBookingId, patientId }).lean()
        : null;
      if (!booking) {
        res.status(404).json({ success: false, message: 'Lab booking not found' });
        return;
      }
      if (booking.status !== 'BOOKED' || booking.paymentStatus !== 'UNPAID') {
        res.status(400).json({ success: false, message: 'This lab booking is already paid or no longer payable' });
        return;
      }
      amount = booking.total;
      orderMeta = { labBookingId };
    } else {
      res.status(400).json({ success: false, message: 'Unsupported payment type' });
      return;
    }

    const options = { amount: toPaise(amount), currency: 'INR', receipt: `rcpt_${Date.now()}` };
    const order = await razorpay.orders.create(options);

    const transaction = await Transaction.create({
      patientId: new Types.ObjectId(patientId),
      amount,
      currency: 'INR',
      type,
      status: 'PENDING',
      razorpayOrderId: order.id,
      metadata: orderMeta,
    });

    res.status(200).json({
      success: true,
      data: {
        orderId: order.id,
        amount: options.amount,
        currency: options.currency,
        key: RAZORPAY_KEY_ID || 'rzp_test_mock_key',
        transactionId: transaction._id,
      },
    });
  } catch (error) {
    req.log.error(error, 'Error creating order');
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
};

/**
 * GET /api/v1/payments/history?type=SUBSCRIPTION|APPOINTMENT
 * The signed-in patient's transactions, newest first. The optional `type`
 * filter keeps the two invoice surfaces separate: Billing & Invoices shows
 * only APPOINTMENT payments, while the Subscription page shows only
 * SUBSCRIPTION receipts. Omitting `type` returns everything.
 */
export const getPaymentHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const patientId = (req as any).user?.id;
    if (!patientId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const filter: Record<string, unknown> = { patientId };
    const type = String(req.query.type ?? '').toUpperCase();
    if (type === 'SUBSCRIPTION' || type === 'APPOINTMENT') filter.type = type;

    const transactions = await Transaction.find(filter)
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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
    const patientId = (req as any).user?.id;

    // Constant-time check (a plain !== leaks timing).
    if (!verifyOrderSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      res.status(400).json({ success: false, message: 'Invalid signature' });
      return;
    }

    const existing = await Transaction.findOne({ razorpayOrderId: razorpay_order_id, patientId }).lean();
    if (!existing) {
      res.status(404).json({ success: false, message: 'Transaction not found' });
      return;
    }

    if (existing.type === 'WALLET_TOPUP') {
      await completeTopup(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      res.status(200).json({ success: true, message: 'Payment verified successfully' });
      return;
    }

    // Only the PENDING → SUCCESS transition fulfils, so replaying /verify can't
    // re-extend a plan or re-send receipts.
    const transaction = await Transaction.findOneAndUpdate(
      { _id: existing._id, status: 'PENDING' },
      {
        status: 'SUCCESS',
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      },
      { new: true }
    );

    if (!transaction) {
      res.status(200).json({ success: true, message: 'Payment already verified' });
      return;
    }

    // Fulfill business logic based on type
    if (transaction.type === 'SUBSCRIPTION') {
      const now = new Date();
      const planExpiresAt = new Date(now.getTime() + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000);
      const patient = await Patient.findByIdAndUpdate(
        transaction.patientId,
        {
          plan: 'PREMIUM',
          planId: transaction.metadata?.planId ?? undefined,
          planExpiresAt,
        },
        { new: true }
      ).lean();

      // Receipt email + in-app notification (non-fatal)
      try {
        const planName = transaction.metadata?.planName ?? 'Premium';
        await createNotification({
          userId: transaction.patientId.toString(),
          role: 'patient',
          type: 'GENERAL',
          title: 'Subscription Active',
          message: `Your ${planName} plan is active until ${fmtDate(planExpiresAt)}.`,
        });
        if (patient?.email) {
          const tpl = subscriptionReceiptEmailTemplate({
            patientName: patient.name,
            planName,
            amount: transaction.amount,
            invoiceNo: receiptNo(String(transaction._id)),
            startsOn: fmtDate(now),
            expiresOn: fmtDate(planExpiresAt),
          });
          const pdf = await buildSubscriptionReceiptPdf(
            transaction.toObject() as ITransaction & { _id: unknown; createdAt?: Date },
            patient.name
          );
          await sendEmail({
            to: patient.email,
            subject: tpl.subject,
            text: tpl.text,
            html: tpl.html,
            attachments: [{ filename: `receipt-${receiptNo(String(transaction._id))}.pdf`, content: pdf, contentType: 'application/pdf' }],
          });
        }
      } catch (err) {
        req.log.error(err, 'Subscription receipt email/notification failed');
      }
    } else if (transaction.type === 'LAB_BOOKING') {
      const labBookingId = transaction.metadata?.labBookingId;
      const paid = await LabBooking.findOneAndUpdate(
        { _id: labBookingId, patientId: transaction.patientId, status: 'BOOKED', paymentStatus: 'UNPAID' },
        { paymentStatus: 'PAID', paymentMethod: 'RAZORPAY', amountPaid: toPaise(transaction.amount) }
      );
      if (!paid) {
        // Cancelled (or paid another way) while the sheet was open: refund to wallet.
        await postOnce(`lab-pay-orphan:${transaction.razorpayOrderId}`, [
          {
            ownerType: 'patient',
            ownerId: String(transaction.patientId),
            bucket: 'balance',
            direction: 'CREDIT',
            amount: toPaise(transaction.amount),
            kind: 'LAB_REFUND',
            description: 'Refund · payment for a lab booking that was no longer payable',
            refType: 'Transaction',
            refId: transaction._id,
          },
        ]);
      }
    } else if (transaction.type === 'APPOINTMENT') {
      // Previously this set a `paymentStatus` field the schema didn't have, so
      // Mongoose silently dropped it and payments were never recorded.
      const appointmentId = transaction.metadata?.appointmentId;
      if (appointmentId) {
        try {
          await inTransaction((session) =>
            settleAppointmentPayment({
              appointmentId: String(appointmentId),
              patientId: String(transaction.patientId),
              amount: toPaise(transaction.amount),
              method: 'RAZORPAY',
              session,
            })
          );
          await notifyAppointmentPaid(String(appointmentId));
        } catch (err) {
          // Paid, but the appointment was cancelled or paid another way meanwhile.
          // The money must not vanish: park it in the patient's wallet.
          req.log.warn({ err, appointmentId }, 'Paid appointment not payable — crediting wallet');
          await postOnce(`appt-pay-orphan:${transaction.razorpayOrderId}`, [
            {
              ownerType: 'patient',
              ownerId: String(transaction.patientId),
              bucket: 'balance',
              direction: 'CREDIT',
              amount: toPaise(transaction.amount),
              kind: 'APPOINTMENT_REFUND',
              description: 'Refund · payment for an appointment that was no longer payable',
              refType: 'Transaction',
              refId: transaction._id,
            },
          ]);
        }
      }
    }

    res.status(200).json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    req.log.error(error, 'Error verifying payment');
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
};

/** Loads a SUCCESS subscription transaction owned by the caller, or null. */
async function findOwnSubscriptionTx(patientId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  const t = await Transaction.findOne({ _id: id, patientId, type: 'SUBSCRIPTION', status: 'SUCCESS' });
  return t;
}

/**
 * GET /api/v1/payments/transactions/:id/receipt
 * Streams the professional PDF receipt for one of the caller's subscription payments.
 */
export const downloadSubscriptionReceipt = async (req: Request, res: Response): Promise<void> => {
  try {
    const patientId = (req as any).user?.id;
    if (!patientId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    const t = await findOwnSubscriptionTx(patientId, req.params.id);
    if (!t) {
      res.status(404).json({ success: false, message: 'Receipt not found' });
      return;
    }
    const patient = await Patient.findById(patientId).select('name').lean();
    const pdf = await buildSubscriptionReceiptPdf(
      t.toObject() as ITransaction & { _id: unknown; createdAt?: Date },
      patient?.name ?? 'Patient'
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${receiptNo(String(t._id))}.pdf`);
    res.send(pdf);
  } catch (error) {
    req.log.error(error, 'Error generating subscription receipt');
    res.status(500).json({ success: false, message: 'Failed to generate receipt' });
  }
};

/**
 * POST /api/v1/payments/transactions/:id/receipt/email
 * Emails the subscription receipt PDF to the caller's registered address.
 */
export const emailSubscriptionReceipt = async (req: Request, res: Response): Promise<void> => {
  try {
    const patientId = (req as any).user?.id;
    if (!patientId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    const t = await findOwnSubscriptionTx(patientId, req.params.id);
    if (!t) {
      res.status(404).json({ success: false, message: 'Receipt not found' });
      return;
    }
    const patient = await Patient.findById(patientId).select('name email').lean();
    if (!patient?.email) {
      res.status(400).json({ success: false, message: 'No email on file' });
      return;
    }
    const start = ((t as any).createdAt ?? new Date()) as Date;
    const expires = new Date(start.getTime() + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const planName = t.metadata?.planName ?? 'Premium';
    const tpl = subscriptionReceiptEmailTemplate({
      patientName: patient.name,
      planName,
      amount: t.amount,
      invoiceNo: receiptNo(String(t._id)),
      startsOn: fmtDate(start),
      expiresOn: fmtDate(expires),
    });
    const pdf = await buildSubscriptionReceiptPdf(
      t.toObject() as ITransaction & { _id: unknown; createdAt?: Date },
      patient.name
    );
    await sendEmail({
      to: patient.email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      attachments: [{ filename: `receipt-${receiptNo(String(t._id))}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    res.status(200).json({ success: true, message: 'Receipt emailed to your registered address' });
  } catch (error) {
    req.log.error(error, 'Error emailing subscription receipt');
    res.status(500).json({ success: false, message: 'Failed to email receipt' });
  }
};
