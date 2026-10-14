import type { Request, Response } from 'express';
import { Clinic } from '../../models/Clinic';
import { signFieldsArray } from '../../services/presignedUrl';

/**
 * GET /api/v1/admin/clinics
 * Fetch all clinics
 */
export const getClinics = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await Clinic.find()
      .sort({ createdAt: -1 })
      .populate('doctorId', 'name')
      .lean();
    // Keep doctorId a plain id; add the owner's name so unnamed clinics can still be told apart.
    const clinics = rows.map((c) => {
      const owner = c.doctorId as unknown as { _id?: unknown; name?: string } | null;
      return { ...c, doctorId: String(owner?._id ?? c.doctorId), doctorName: owner?.name ?? null };
    });

    await signFieldsArray(clinics, ['photoUrl']);

    res.status(200).json({ success: true, data: { clinics } });
  } catch (error) {
    req.log.error(error, 'Error fetching clinics');
    res.status(500).json({ success: false, message: 'Failed to fetch clinics' });
  }
};
