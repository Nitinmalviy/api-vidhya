import type { Request, Response } from 'express';
import { Patient } from '../../models/Patient';

export const getPatients = async (req: Request, res: Response): Promise<void> => {
  const { search, page = '1', limit = '20', plan } = req.query;

  const filter: Record<string, unknown> = {};
  if (plan && ['FREE', 'PREMIUM'].includes(String(plan))) {
    filter.plan = plan as string;
  }
  if (search) {
    const q = String(search);
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));

  const [patients, total] = await Promise.all([
    Patient.find(filter)
      .select('name email phone plan bloodGroup isEmailVerified createdAt')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    Patient.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { patients, total, page: pageNum, limit: limitNum },
  });
};
