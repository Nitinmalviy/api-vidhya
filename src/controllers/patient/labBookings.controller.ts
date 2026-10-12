import type { Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Lab } from '../../models/Lab';
import { LabBooking } from '../../models/LabBooking';
import { createNotification } from '../../services/notification';
import { inTransaction, post, postOnce, toPaise, toRupees, walletSummary } from '../../services/wallet';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';

/** Collection windows offered to patients. */
export const LAB_SLOTS = ['07:00 – 08:00 AM', '08:00 – 09:00 AM', '09:00 – 10:00 AM', '10:00 – 11:00 AM', '04:00 – 05:00 PM', '05:00 – 06:00 PM'];

export const createLabBookingSchema = z.object({
  labId: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid lab'),
  tests: z.array(z.string().trim().min(1).max(120)).min(1, 'Pick at least one test').max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  slot: z.enum(LAB_SLOTS as [string, ...string[]]),
  address: z.object({
    line1: z.string().trim().min(5, 'Enter the full address').max(250),
    city: z.string().trim().max(100).optional(),
    zip: z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits').optional().or(z.literal('')),
    phone: z.string().trim().regex(/^\+?[0-9][0-9\s-]{8,}$/, 'Enter a valid phone number'),
  }),
  payWith: z.enum(['wallet', 'online', 'collection']),
});

function serialize(b: any) {
  return {
    id: String(b._id),
    labId: String(b.labId),
    labName: b.labName,
    tests: b.tests,
    total: b.total,
    date: b.date,
    slot: b.slot,
    address: b.address,
    status: b.status,
    paymentStatus: b.paymentStatus,
    paymentMethod: b.paymentMethod,
    amountPaid: b.amountPaid != null ? toRupees(b.amountPaid) : null,
    createdAt: b.createdAt,
  };
}

/* GET /api/v1/patient/labs/bookings/slots */
export const getLabSlots = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.status(200).json({ success: true, data: { slots: LAB_SLOTS } });
};

/* POST /api/v1/patient/labs/bookings
   Prices come from the lab document, never the client. With payWith=wallet
   the booking and the wallet debit commit together or not at all. With
   payWith=online the booking is created UNPAID and the client pays it through
   /payments/create-order (type LAB_BOOKING). */
export const createLabBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const patientId = req.user.id;
  const body = req.body as z.infer<typeof createLabBookingSchema>;

  const today = new Date();
  const minDate = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const maxDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (body.date < minDate || body.date > maxDate) throw new BadRequestError('Pick a date within the next 30 days');

  const lab = await Lab.findOne({ _id: body.labId, isActive: true }).lean();
  if (!lab) throw new NotFoundError('Lab');
  if (!lab.homeCollection) throw new BadRequestError('This lab does not offer home collection');

  const wanted = [...new Set(body.tests)];
  const tests = wanted.map((name) => {
    const t = lab.tests.find((x) => x.name === name);
    if (!t) throw new BadRequestError(`${name} is not offered by ${lab.name}`);
    return { name: t.name, price: t.price, reportTime: t.reportTime };
  });
  const total = tests.reduce((s, t) => s + t.price, 0);

  const base = {
    patientId,
    labId: lab._id,
    labName: lab.name,
    tests,
    total,
    date: body.date,
    slot: body.slot,
    address: { line1: body.address.line1, city: body.address.city, zip: body.address.zip || undefined, phone: body.address.phone },
  };

  let booking;
  if (body.payWith === 'wallet') {
    booking = await inTransaction(async (session) => {
      const [b] = await LabBooking.create(
        [{ ...base, paymentMethod: 'WALLET', paymentStatus: 'PAID', amountPaid: toPaise(total) }],
        { session }
      );
      await post(
        `lab-pay:${b._id}`,
        [
          {
            ownerType: 'patient',
            ownerId: patientId,
            bucket: 'balance',
            direction: 'DEBIT',
            amount: toPaise(total),
            kind: 'LAB_PAYMENT',
            description: `Lab tests · ${lab.name}`,
            refType: 'LabBooking',
            refId: b._id,
          },
        ],
        session
      );
      return b;
    });
  } else {
    booking = await LabBooking.create({
      ...base,
      paymentMethod: body.payWith === 'online' ? 'RAZORPAY' : 'AT_COLLECTION',
      paymentStatus: 'UNPAID',
    });
  }

  await createNotification({
    userId: patientId,
    role: 'patient',
    type: 'GENERAL',
    title: 'Lab tests booked',
    message: `${lab.name} will collect your sample on ${body.date}, ${body.slot}.`,
  });

  res.status(201).json({ success: true, message: 'Lab tests booked', data: { booking: serialize(booking.toObject()) } });
};

/* GET /api/v1/patient/labs/bookings */
export const listLabBookings = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const rows = await LabBooking.find({ patientId: req.user.id }).sort({ createdAt: -1 }).limit(50).lean();
  res.status(200).json({ success: true, data: { bookings: rows.map(serialize) } });
};

/* PATCH /api/v1/patient/labs/bookings/:id/cancel
   Only before collection. A paid booking is refunded to the wallet at once. */
export const cancelLabBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Booking');

  const b = await LabBooking.findOneAndUpdate(
    { _id: req.params.id, patientId: req.user.id, status: 'BOOKED' },
    { status: 'CANCELLED', cancelledAt: new Date() },
    { new: true }
  );
  if (!b) throw new BadRequestError('Only bookings awaiting collection can be cancelled');

  let refunded = 0;
  if (b.paymentStatus === 'PAID' && b.amountPaid) {
    const done = await postOnce(`lab-refund:${b._id}`, [
      {
        ownerType: 'patient',
        ownerId: req.user.id,
        bucket: 'balance',
        direction: 'CREDIT',
        amount: b.amountPaid,
        kind: 'LAB_REFUND',
        description: `Refund · cancelled lab tests at ${b.labName}`,
        refType: 'LabBooking',
        refId: b._id,
      },
    ]);
    if (done) {
      refunded = b.amountPaid;
      await LabBooking.updateOne({ _id: b._id }, { paymentStatus: 'REFUNDED' });
    }
  }

  const wallet = await walletSummary('patient', req.user.id, 1);
  res.status(200).json({
    success: true,
    message: refunded ? `₹${toRupees(refunded).toLocaleString('en-IN')} refunded to your wallet` : 'Booking cancelled',
    data: { refunded: toRupees(refunded), walletBalance: wallet.balance },
  });
};
