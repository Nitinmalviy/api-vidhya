import type { Response } from 'express';
import { Types } from 'mongoose';
import { Prescription } from '../../models/Prescription';
import { Appointment } from '../../models/Appointment';
import { Patient } from '../../models/Patient';
import type { AuthRequest } from '../../types';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../utils/AppError';
import { doctorPatientIds, isDoctorsPatient } from '../../services/careRelationship';
import { escapeRegex } from '../../utils/specializations';
import { uploadBase64ToS3 } from '../../services/s3Upload';
import { createNotification } from '../../services/notification';
import { Doctor } from '../../models/Doctor';

export const createPrescription = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { patientId, opdSessionId, appointmentId, medicines, notes, attachments } = req.body;

  if (!patientId || !medicines) {
    throw new BadRequestError('patientId and medicines are required');
  }
  if (typeof medicines !== 'string' || medicines.trim().length < 2 || medicines.length > 5000) {
    throw new BadRequestError('medicines must be 2–5000 characters');
  }
  // Only for patients this doctor has a booking or a connected Live-OPD call with.
  if (!(await isDoctorsPatient(req.user.id, String(patientId)))) {
    throw new ForbiddenError('You can only prescribe for patients you have a consultation with');
  }

  // Optional link to the visit it came from — must be this doctor's, with this patient.
  let linkedAppointmentId: string | undefined;
  if (appointmentId) {
    const appt = Types.ObjectId.isValid(String(appointmentId))
      ? await Appointment.exists({ _id: appointmentId, doctorId: req.user.id, patientId })
      : null;
    if (!appt) throw new BadRequestError('That appointment does not belong to this patient');
    linkedAppointmentId = String(appointmentId);
  }

  // Handle attachments (base64)
  const attachmentUrls: string[] = [];
  if (Array.isArray(attachments)) {
    for (const file of attachments) {
      if (typeof file === 'string' && file.startsWith('data:')) {
        const url = await uploadBase64ToS3(file, 'prescriptions');
        if (url) attachmentUrls.push(url);
      }
    }
  }

  const prescription = await Prescription.create({
    doctorId: req.user.id,
    patientId,
    opdSessionId,
    appointmentId: linkedAppointmentId,
    medicines: medicines.trim(),
    notes,
    attachments: attachmentUrls,
  });

  // Tell the patient it's waiting in their app (createNotification never throws).
  const doctor = await Doctor.findById(req.user.id).select('name').lean();
  await createNotification({
    userId: String(patientId),
    role: 'patient',
    type: 'GENERAL',
    title: 'New prescription',
    message: `${doctor?.name ?? 'Your doctor'} sent you a prescription. Open Prescriptions to view or download it.`,
  });

  res.status(201).json({ success: true, data: { prescription } });
};

export const getPrescriptions = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const prescriptions = await Prescription.find({ doctorId: req.user.id })
    .populate('patientId', 'name phone photoUrl')
    .populate('opdSessionId', 'date startTime endTime')
    .populate('appointmentId', 'date timeSlot type')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ success: true, data: { prescriptions } });
};

export const searchPatients = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { q } = req.query;

  if (!q || typeof q !== 'string') {
    res.status(200).json({ success: true, data: { patients: [] } });
    return;
  }

  // Only this doctor's own patients — previously any doctor could search every
  // patient's name and phone on the platform. Input is escaped (ReDoS).
  const ids = await doctorPatientIds(req.user.id);
  const regex = new RegExp(escapeRegex(q.trim().slice(0, 60)), 'i');
  const patients = await Patient.find({
    _id: { $in: ids },
    $or: [{ name: regex }, { phone: regex }],
  })
    .select('name phone photoUrl')
    .limit(10)
    .lean();

  res.status(200).json({ success: true, data: { patients } });
};
