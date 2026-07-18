import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { Appointment } from '../../models/Appointment';
import { Doctor } from '../../models/Doctor';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { createNotification } from '../../services/notification';

/* POST /api/v1/patient/appointments */
export const createAppointment = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const { doctorId, type, planName, price, date, timeSlot, notes } = req.body ?? {};

  if (!doctorId || !date || !timeSlot) {
    throw new BadRequestError('doctorId, date, and timeSlot are required');
  }
  const apptType = type === 'CHECKUP' ? 'CHECKUP' : 'CONSULTATION';

  const doctor = await Doctor.findOne({ _id: doctorId, kycStatus: 'APPROVED' }).lean();
  if (!doctor) throw new NotFoundError('Doctor not available');

  // Prevent double-booking the same doctor slot
  const clash = await Appointment.findOne({
    doctorId,
    date,
    timeSlot,
    status: 'BOOKED',
  }).lean();
  if (clash) throw new BadRequestError('This time slot is already booked. Please pick another.');

  const appointment = await Appointment.create({
    patientId: req.user.id,
    doctorId,
    type: apptType,
    planName: planName || undefined,
    price: price != null ? Number(price) : undefined,
    date,
    timeSlot,
    notes: notes || undefined,
    status: 'BOOKED',
  });

  // Notify the doctor in-app
  await createNotification({
    userId: doctorId,
    role: 'doctor',
    type: 'GENERAL',
    title: 'New Appointment Booked',
    message: `${apptType === 'CHECKUP' ? planName ?? 'Health checkup' : 'Consultation'} booked for ${date} at ${timeSlot}.`,
  });

  res.status(201).json({
    success: true,
    message: 'Appointment booked successfully',
    data: { id: appointment._id, date, timeSlot, status: appointment.status },
  });
};

/* GET /api/v1/patient/appointments */
export const getMyAppointments = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const appointments = await Appointment.find({ patientId: req.user.id })
    .populate('doctorId', 'name specializations')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ success: true, data: { appointments } });
};

/* GET /api/v1/patient/appointments/booked-slots?doctorId=&date= */
export const getBookedSlots = async (req: AuthRequest, res: Response): Promise<void> => {
  const { doctorId, date } = req.query;
  if (!doctorId || !date) throw new BadRequestError('doctorId and date are required');

  const booked = await Appointment.find({ doctorId, date, status: 'BOOKED' })
    .select('timeSlot')
    .lean();

  res.status(200).json({ success: true, data: { slots: booked.map((b) => b.timeSlot) } });
};

/* GET /api/v1/patient/appointments/:id */
export const getAppointmentDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { id } = req.params;

  const appointment = await Appointment.findOne({ _id: id, patientId: req.user.id })
    .populate('doctorId', 'name specializations about clinicAddress')
    .lean();
  if (!appointment) throw new NotFoundError('Appointment not found');

  res.status(200).json({ success: true, data: { appointment } });
};

/* PATCH /api/v1/patient/appointments/:id/cancel */
export const cancelAppointment = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { id } = req.params;

  const appointment = await Appointment.findOne({ _id: id, patientId: req.user.id });
  if (!appointment) throw new NotFoundError('Appointment not found');
  if (appointment.status !== 'BOOKED') throw new BadRequestError('Only upcoming appointments can be cancelled');

  appointment.status = 'CANCELLED';
  await appointment.save();

  // Notify doctor
  await createNotification({
    userId: appointment.doctorId.toString(),
    role: 'doctor',
    type: 'GENERAL',
    title: 'Appointment Cancelled',
    message: `Appointment for ${appointment.date} at ${appointment.timeSlot} was cancelled.`,
  });

  res.status(200).json({ success: true, message: 'Appointment cancelled successfully' });
};

/* GET /api/v1/patient/appointments/:id/invoice */
export const downloadInvoice = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { id } = req.params;

  const appointment = await Appointment.findOne({ _id: id, patientId: req.user.id })
    .populate('doctorId', 'name')
    .lean();
    
  if (!appointment) throw new NotFoundError('Appointment not found');
  if (appointment.status === 'CANCELLED') throw new BadRequestError('Cannot generate invoice for cancelled appointments');

  // Dummy data based on user feedback
  const gstNumber = '22AAAAA0000A1Z5';
  const companyName = 'VidhyaCare Health Services Pvt Ltd';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=invoice-${appointment._id}.pdf`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  // Header
  doc.fontSize(24).fillColor('#2563EB').text('VidhyaCare', { align: 'right' });
  doc.fontSize(10).fillColor('#666666').text(companyName, { align: 'right' });
  doc.text(`GSTIN: ${gstNumber}`, { align: 'right' });
  doc.moveDown(2);

  // Invoice Details
  doc.fontSize(20).fillColor('#000000').text('INVOICE', { underline: true });
  doc.moveDown();
  
  doc.fontSize(12);
  doc.text(`Invoice Number: INV-${appointment._id.toString().substring(0, 8).toUpperCase()}`);
  doc.text(`Date: ${new Date().toLocaleDateString()}`);
  doc.moveDown();

  // Patient & Booking Details
  doc.text(`Patient ID: ${req.user.id}`);
  const doctorName = (appointment.doctorId as any)?.name ?? 'Consultation';
  doc.text(`Doctor: ${doctorName}`);
  doc.text(`Booking Date: ${appointment.date} at ${appointment.timeSlot}`);
  doc.moveDown(2);

  // Table
  const tableTop = doc.y;
  doc.font('Helvetica-Bold');
  doc.text('Description', 50, tableTop);
  doc.text('Amount (INR)', 400, tableTop, { width: 100, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(500, tableTop + 15).stroke();
  
  doc.font('Helvetica');
  const row1 = tableTop + 25;
  const desc = appointment.type === 'CHECKUP' ? appointment.planName ?? 'Health checkup' : 'Consultation Fee';
  const price = appointment.price ?? 500;
  
  // Base price (assuming price is inclusive of 18% GST for display, or we just calculate it)
  const gstAmount = (price * 0.18).toFixed(2);
  const basePrice = (price - Number(gstAmount)).toFixed(2);

  doc.text(desc, 50, row1);
  doc.text(`Rs. ${basePrice}`, 400, row1, { width: 100, align: 'right' });
  
  const row2 = row1 + 20;
  doc.text('GST (18%)', 50, row2);
  doc.text(`Rs. ${gstAmount}`, 400, row2, { width: 100, align: 'right' });

  doc.moveTo(50, row2 + 20).lineTo(500, row2 + 20).stroke();
  
  const totalRow = row2 + 30;
  doc.font('Helvetica-Bold');
  doc.text('Total Amount', 50, totalRow);
  doc.text(`Rs. ${price.toFixed(2)}`, 400, totalRow, { width: 100, align: 'right' });

  // Signature
  doc.moveDown(6);
  doc.font('Helvetica');
  doc.text('For VidhyaCare Health Services Pvt Ltd', { align: 'right' });
  doc.moveDown(2);
  doc.text('Authorized Signatory', { align: 'right' });

  doc.end();
};
