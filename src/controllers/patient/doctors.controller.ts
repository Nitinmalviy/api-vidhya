import type { Request, Response } from 'express';
import { Doctor } from '../../models/Doctor';
import { NotFoundError } from '../../utils/AppError';

/* ─────────────────────────────────────────────
   GET /api/v1/patient/doctors
   Browse approved doctors (for booking).
   Query: search, specialization, page, limit
───────────────────────────────────────────── */
export const getDoctors = async (req: Request, res: Response): Promise<void> => {
  const { search, specialization, page = '1', limit = '20' } = req.query;

  const filter: Record<string, unknown> = { kycStatus: 'APPROVED' };
  if (specialization) filter.specializations = { $in: [String(specialization)] };
  if (search) {
    const q = String(search);
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { specializations: { $regex: q, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(50, Math.max(1, Number(limit)));

  const [doctors, total] = await Promise.all([
    Doctor.find(filter)
      .populate('clinicId', 'name photoUrl isVerified')
      .select('name specializations workType clinicId createdAt')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    Doctor.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { doctors, total, page: pageNum, limit: limitNum },
  });
};

/* GET /api/v1/patient/doctors/:id */
export const getDoctorById = async (req: Request, res: Response): Promise<void> => {
  const doctor = await Doctor.findOne({ _id: req.params.id, kycStatus: 'APPROVED' })
    .populate('clinicId', 'name photoUrl isVerified')
    .select('name specializations workType clinicId degreeDetails createdAt')
    .lean();

  if (!doctor) throw new NotFoundError('Doctor not found');

  res.status(200).json({ success: true, data: doctor });
};
