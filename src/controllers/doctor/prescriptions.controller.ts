import type { Response } from 'express';
import { Prescription } from '../../models/Prescription';
import { Patient } from '../../models/Patient';
import type { AuthRequest } from '../../types';
import { BadRequestError, UnauthorizedError } from '../../utils/AppError';
import { uploadBase64ToS3 } from '../../services/s3Upload';

export const createPrescription = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { patientId, opdSessionId, medicines, notes, attachments } = req.body;

  if (!patientId || !medicines) {
    throw new BadRequestError('patientId and medicines are required');
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
    medicines,
    notes,
    attachments: attachmentUrls,
  });

  res.status(201).json({ success: true, data: { prescription } });
};

export const getPrescriptions = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const prescriptions = await Prescription.find({ doctorId: req.user.id })
    .populate('patientId', 'name phone photoUrl')
    .populate('opdSessionId', 'date startTime endTime')
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

  // Search by name or phone
  const regex = new RegExp(q, 'i');
  const patients = await Patient.find({
    $or: [{ name: regex }, { phone: regex }],
  })
    .select('name phone photoUrl')
    .limit(10)
    .lean();

  res.status(200).json({ success: true, data: { patients } });
};
