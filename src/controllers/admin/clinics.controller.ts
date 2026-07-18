import type { Request, Response } from 'express';
import { Clinic } from '../../models/Clinic';
import { signFieldsArray } from '../../services/presignedUrl';

/**
 * GET /api/v1/admin/clinics
 * Fetch all clinics
 */
export const getClinics = async (req: Request, res: Response): Promise<void> => {
  try {
    const clinics = await Clinic.find()
      .sort({ createdAt: -1 })
      .lean();

    await signFieldsArray(clinics, ['photoUrl']);

    res.status(200).json({ success: true, data: { clinics } });
  } catch (error) {
    req.log.error(error, 'Error fetching clinics');
    res.status(500).json({ success: false, message: 'Failed to fetch clinics' });
  }
};
