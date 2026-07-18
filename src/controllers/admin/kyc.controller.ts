import type { Request, Response } from 'express';
import { Doctor } from '../../models/Doctor';

/**
 * GET /api/v1/admin/kyc/pending
 * Fetch all doctors with pending KYC
 */
export const getPendingKYC = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctors = await Doctor.find({ kycStatus: 'PENDING' })
      .select('-password')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: { doctors } });
  } catch (error) {
    req.log.error(error, 'Error fetching pending KYC');
    res.status(500).json({ success: false, message: 'Failed to fetch pending KYC' });
  }
};

/**
 * POST /api/v1/admin/kyc/:id/approve
 * Approve a doctor's KYC and set them as verified
 */
export const approveKYC = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const doctor = await Doctor.findByIdAndUpdate(
      id,
      { 
        kycStatus: 'APPROVED',
        isVerified: true
      },
      { new: true }
    ).select('-password');

    if (!doctor) {
      res.status(404).json({ success: false, message: 'Doctor not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'KYC Approved successfully', data: { doctor } });
  } catch (error) {
    req.log.error(error, 'Error approving KYC');
    res.status(500).json({ success: false, message: 'Failed to approve KYC' });
  }
};

/**
 * POST /api/v1/admin/kyc/:id/reject
 * Reject a doctor's KYC
 */
export const rejectKYC = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    // req.body.reason can be used here if needed

    const doctor = await Doctor.findByIdAndUpdate(
      id,
      { 
        kycStatus: 'REJECTED',
        isVerified: false 
      },
      { new: true }
    ).select('-password');

    if (!doctor) {
      res.status(404).json({ success: false, message: 'Doctor not found' });
      return;
    }

    // In a real app, you might want to send an email with the `reason` here.

    res.status(200).json({ success: true, message: 'KYC Rejected successfully', data: { doctor } });
  } catch (error) {
    req.log.error(error, 'Error rejecting KYC');
    res.status(500).json({ success: false, message: 'Failed to reject KYC' });
  }
};
