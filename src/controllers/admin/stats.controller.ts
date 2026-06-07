import type { Request, Response } from 'express';
import { Doctor } from '../../models/Doctor';
import { Patient } from '../../models/Patient';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const getGrowthStats = async (req: Request, res: Response): Promise<void> => {
  const { timeFrame = 'monthly' } = req.query;
  const isYearly = timeFrame === 'yearly';

  if (isYearly) {
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 4;

    const [doctorsByYear, patientsByYear] = await Promise.all([
      Doctor.aggregate([
        { $match: { createdAt: { $gte: new Date(`${startYear}-01-01`) } } },
        { $group: { _id: { $year: '$createdAt' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Patient.aggregate([
        { $match: { createdAt: { $gte: new Date(`${startYear}-01-01`) } } },
        { $group: { _id: { $year: '$createdAt' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const years = Array.from({ length: 5 }, (_, i) => startYear + i);

    const toMap = (arr: { _id: number; count: number }[]) =>
      Object.fromEntries(arr.map((e) => [e._id, e.count]));

    const doctorMap = toMap(doctorsByYear);
    const patientMap = toMap(patientsByYear);

    res.status(200).json({
      success: true,
      data: {
        newDoctors: years.map((y) => ({ x: y, y: doctorMap[y] ?? 0 })),
        newPatients: years.map((y) => ({ x: y, y: patientMap[y] ?? 0 })),
      },
    });
    return;
  }

  // Monthly — current year
  const year = new Date().getFullYear();
  const startOfYear = new Date(`${year}-01-01`);

  const [doctorsByMonth, patientsByMonth] = await Promise.all([
    Doctor.aggregate([
      { $match: { createdAt: { $gte: startOfYear } } },
      { $group: { _id: { $month: '$createdAt' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Patient.aggregate([
      { $match: { createdAt: { $gte: startOfYear } } },
      { $group: { _id: { $month: '$createdAt' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const toMonthMap = (arr: { _id: number; count: number }[]) =>
    Object.fromEntries(arr.map((e) => [e._id, e.count]));

  const doctorMap = toMonthMap(doctorsByMonth);
  const patientMap = toMonthMap(patientsByMonth);

  res.status(200).json({
    success: true,
    data: {
      newDoctors: MONTHS.map((m, i) => ({ x: m, y: doctorMap[i + 1] ?? 0 })),
      newPatients: MONTHS.map((m, i) => ({ x: m, y: patientMap[i + 1] ?? 0 })),
    },
  });
};

export const getKycStats = async (_req: Request, res: Response): Promise<void> => {
  const [pending, approved, rejected] = await Promise.all([
    Doctor.countDocuments({ kycStatus: 'PENDING' }),
    Doctor.countDocuments({ kycStatus: 'APPROVED' }),
    Doctor.countDocuments({ kycStatus: 'REJECTED' }),
  ]);

  res.status(200).json({
    success: true,
    data: { PENDING: pending, APPROVED: approved, REJECTED: rejected },
  });
};
