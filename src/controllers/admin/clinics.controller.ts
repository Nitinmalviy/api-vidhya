import type { Request, Response } from 'express';
import { Clinic } from '../../models/Clinic';

/**
 * GET /api/v1/admin/clinics
 * Fetch all clinics
 */
export const getClinics = async (req: Request, res: Response): Promise<void> => {
  try {
    // In a full implementation, you would aggregate doctors and patients per clinic here.
    // For now, we fetch the clinics directly.
    const clinics = await Clinic.find()
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: { clinics } });
  } catch (error) {
    req.log.error(error, 'Error fetching clinics');
    res.status(500).json({ success: false, message: 'Failed to fetch clinics' });
  }
};
