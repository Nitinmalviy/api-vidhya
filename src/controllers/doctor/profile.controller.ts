import type { Response } from 'express';
import { Doctor } from '../../models/Doctor';
import { Clinic } from '../../models/Clinic';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { uploadBase64ToS3 } from '../../services/s3Upload';
import { sendEmail, infoEmailTemplate } from '../../services/email';
import { createNotification } from '../../services/notification';
import { logger } from '../../utils/logger';

/* ─────────────────────────────────────────────
   GET /api/v1/doctor/profile
   Returns full profile — KYC details + public profile + clinic
───────────────────────────────────────────── */
export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const doctor = await Doctor.findById(req.user.id)
    .populate('clinicId', 'name photoUrl isVerified')
    .lean()
    .exec();

  if (!doctor) throw new NotFoundError('Doctor not found');

  res.status(200).json({
    success: true,
    data: {
      id: doctor._id,
      // Public profile
      name: doctor.name,
      email: doctor.email,
      phone: doctor.phone,
      specializations: doctor.specializations ?? [],
      workType: doctor.workType,
      clinic: doctor.clinicId ?? null,
      // KYC details
      kycStatus: doctor.kycStatus,
      adminRemarks: doctor.adminRemarks ?? null,
      isEmailVerified: doctor.isEmailVerified,
      degreeDetails: doctor.degreeDetails ?? null,
      licenseDetails: doctor.licenseDetails ?? null,
      createdAt: (doctor as { createdAt?: Date }).createdAt ?? null,
    },
  });
};

/* ─────────────────────────────────────────────
   PATCH /api/v1/doctor/profile
   Update editable public-profile fields
───────────────────────────────────────────── */
export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const { name, phone, specializations, clinicName } = req.body ?? {};

  const doctor = await Doctor.findById(req.user.id).exec();
  if (!doctor) throw new NotFoundError('Doctor not found');

  if (name !== undefined) {
    if (!String(name).trim()) throw new BadRequestError('Name cannot be empty');
    doctor.name = String(name).trim();
  }
  if (phone !== undefined) {
    if (!String(phone).trim()) throw new BadRequestError('Phone cannot be empty');
    doctor.phone = String(phone).trim();
  }
  if (specializations !== undefined) {
    doctor.specializations = Array.isArray(specializations)
      ? specializations.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [];
  }

  await doctor.save();

  // Update clinic name for own-clinic doctors
  if (clinicName !== undefined && doctor.workType === 'OWN_CLINIC' && doctor.clinicId) {
    await Clinic.findByIdAndUpdate(doctor.clinicId, { name: String(clinicName).trim() }).exec();
  }

  const updated = await Doctor.findById(doctor._id)
    .populate('clinicId', 'name photoUrl isVerified')
    .lean()
    .exec();

  res.status(200).json({
    success: true,
    message: 'Profile updated',
    data: {
      id: updated!._id,
      name: updated!.name,
      email: updated!.email,
      phone: updated!.phone,
      specializations: updated!.specializations ?? [],
      workType: updated!.workType,
      clinic: updated!.clinicId ?? null,
      kycStatus: updated!.kycStatus,
      adminRemarks: updated!.adminRemarks ?? null,
      isEmailVerified: updated!.isEmailVerified,
      degreeDetails: updated!.degreeDetails ?? null,
      licenseDetails: updated!.licenseDetails ?? null,
    },
  });
};

/* ─────────────────────────────────────────────
   PATCH /api/v1/doctor/profile/kyc
   Update KYC documents/details → resets KYC to
   PENDING so admin re-verifies the doctor.
───────────────────────────────────────────── */
export const updateKyc = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const {
    degreeName,
    university,
    passingYear,
    degreeFile, // base64 (optional — keep old doc if absent)
    licenseNumber,
    expiryDate,
    licenseFile, // base64 (optional)
  } = req.body ?? {};

  const doctor = await Doctor.findById(req.user.id).exec();
  if (!doctor) throw new NotFoundError('Doctor not found');

  // ── Degree ──
  if (degreeName || university || passingYear || degreeFile) {
    const existingDoc = doctor.degreeDetails;
    const degreeUrl = degreeFile
      ? await uploadBase64ToS3(degreeFile, 'doctor-kyc')
      : existingDoc?.documentUrl;

    if (!degreeUrl) {
      throw new BadRequestError('Degree document is required');
    }

    doctor.degreeDetails = {
      degreeName: String(degreeName ?? existingDoc?.degreeName ?? '').trim(),
      university: String(university ?? existingDoc?.university ?? '').trim(),
      passingYear: Number(passingYear ?? existingDoc?.passingYear),
      documentUrl: degreeUrl,
    };
  }

  // ── License ──
  if (licenseNumber || expiryDate || licenseFile) {
    const existingLic = doctor.licenseDetails;
    const licenseUrl = licenseFile
      ? await uploadBase64ToS3(licenseFile, 'doctor-kyc')
      : existingLic?.documentUrl;

    if (!licenseUrl) {
      throw new BadRequestError('License document is required');
    }

    doctor.licenseDetails = {
      licenseNumber: String(licenseNumber ?? existingLic?.licenseNumber ?? '').trim(),
      expiryDate: expiryDate ? new Date(expiryDate) : (existingLic?.expiryDate as Date),
      documentUrl: licenseUrl,
    };
  }

  // Re-submit for verification
  doctor.kycStatus = 'PENDING';
  doctor.adminRemarks = undefined;
  await doctor.save();

  // ── Acknowledge submission: in-app notification + email ──
  await createNotification({
    userId: doctor._id,
    role: 'doctor',
    type: 'KYC_SUBMITTED',
    title: 'KYC Details Received',
    message: 'We have received your KYC details. Our admin team will review them shortly and notify you once approved.',
  });

  const tpl = infoEmailTemplate({
    heading: 'We received your KYC details',
    body: `Hi ${doctor.name}, thanks for submitting your KYC documents. Our admin team will review them and you'll be notified once your profile is approved.`,
    accent: 'amber',
    note: 'You can track your verification status anytime from your doctor dashboard.',
  });

  try {
    await sendEmail({ to: doctor.email, subject: 'We received your VidhyaCare KYC details', text: tpl.text, html: tpl.html });
  } catch (err) {
    logger.error({ err, email: doctor.email }, 'Failed to send KYC submission email');
  }

  const updated = await Doctor.findById(doctor._id)
    .populate('clinicId', 'name photoUrl isVerified')
    .lean()
    .exec();

  res.status(200).json({
    success: true,
    message: 'KYC details updated. Your profile has been re-submitted for verification.',
    data: {
      id: updated!._id,
      name: updated!.name,
      email: updated!.email,
      phone: updated!.phone,
      specializations: updated!.specializations ?? [],
      workType: updated!.workType,
      clinic: updated!.clinicId ?? null,
      kycStatus: updated!.kycStatus,
      adminRemarks: updated!.adminRemarks ?? null,
      isEmailVerified: updated!.isEmailVerified,
      degreeDetails: updated!.degreeDetails ?? null,
      licenseDetails: updated!.licenseDetails ?? null,
    },
  });
};
