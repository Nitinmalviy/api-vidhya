import type { Request, Response } from 'express';
import { Doctor } from '../../models/Doctor';
import { Clinic } from '../../models/Clinic';
import { BadRequestError, NotFoundError } from '../../utils/AppError';
import { sendEmail, infoEmailTemplate } from '../../services/email';
import { createNotification } from '../../services/notification';
import { logger } from '../../utils/logger';

export const verifyDoctor = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status, adminRemarks } = req.body ?? {};

  if (status !== 'APPROVED' && status !== 'REJECTED') {
    throw new BadRequestError("status must be 'APPROVED' or 'REJECTED'");
  }
  if (status === 'REJECTED' && !adminRemarks?.trim()) {
    throw new BadRequestError('adminRemarks are required when rejecting');
  }

  const doctor = await Doctor.findById(id).exec();
  if (!doctor) throw new NotFoundError('Doctor');

  doctor.kycStatus = status;
  doctor.adminRemarks = adminRemarks ?? undefined;
  await doctor.save();

  if (status === 'APPROVED' && doctor.clinicId) {
    await Clinic.findByIdAndUpdate(doctor.clinicId, { isVerified: true }).exec();
  }

  // ── In-app notification + email ──
  if (status === 'APPROVED') {
    await createNotification({
      userId: doctor._id,
      role: 'doctor',
      type: 'KYC_APPROVED',
      title: 'KYC Approved 🎉',
      message: 'Congratulations! Your KYC has been approved. You can now create OPD sessions and receive patient appointments.',
    });

    const tpl = infoEmailTemplate({
      heading: 'Your KYC is Approved 🎉',
      body: `Hi ${doctor.name}, great news — your KYC verification has been approved. You can now start creating OPD sessions and accepting patient appointments on Vidhya.care.`,
      accent: 'green',
      note: 'Log in to your doctor dashboard to get started.',
    });

    try {
      await sendEmail({ to: doctor.email, subject: 'Your Vidhya.care KYC is Approved', text: tpl.text, html: tpl.html });
    } catch (err) {
      logger.error({ err, email: doctor.email }, 'Failed to send KYC approval email');
    }
  } else {
    await createNotification({
      userId: doctor._id,
      role: 'doctor',
      type: 'KYC_REJECTED',
      title: 'KYC Rejected',
      message: `Your KYC was rejected. Reason: ${adminRemarks}. Please update your details and re-submit for verification.`,
    });

    const tpl = infoEmailTemplate({
      heading: 'Your KYC Needs Attention',
      body: `Hi ${doctor.name}, unfortunately your KYC verification was not approved.`,
      accent: 'red',
      note: `Reason: ${adminRemarks}<br/><br/>Please log in, update your KYC details in your profile, and re-submit for review.`,
    });

    try {
      await sendEmail({ to: doctor.email, subject: 'Action Required — Your Vidhya.care KYC', text: tpl.text, html: tpl.html });
    } catch (err) {
      logger.error({ err, email: doctor.email }, 'Failed to send KYC rejection email');
    }
  }

  res.status(200).json({
    success: true,
    message: status === 'APPROVED' ? 'Doctor approved' : 'Doctor rejected',
    data: { id: doctor._id, kycStatus: doctor.kycStatus },
  });
};
