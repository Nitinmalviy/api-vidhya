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

type Bucket = { key: string; count: number };

/* ─────────────────────────────────────────────
   GET /api/v1/admin/stats/patient-insights
   Aggregate-only view of who the patients are (no individual records), built
   from the optional "about you" answers at signup and profile edits.
───────────────────────────────────────────── */
export const getPatientInsights = async (_req: Request, res: Response): Promise<void> => {
  const active = { deletionScheduledAt: null };
  const now = new Date();
  const yearsAgo = (y: number) => new Date(now.getFullYear() - y, now.getMonth(), now.getDate());

  const [facets] = await Patient.aggregate<{
    total: { n: number }[];
    withAge: { n: number }[];
    withGender: { n: number }[];
    withCity: { n: number }[];
    gender: Bucket[];
    age: Bucket[];
    cities: Bucket[];
    sources: Bucket[];
    conditions: Bucket[];
  }>([
    { $match: active },
    {
      $facet: {
        total: [{ $count: 'n' }],
        withAge: [{ $match: { dateOfBirth: { $ne: null } } }, { $count: 'n' }],
        withGender: [{ $match: { gender: { $ne: null } } }, { $count: 'n' }],
        withCity: [{ $match: { city: { $nin: [null, ''] } } }, { $count: 'n' }],
        gender: [{ $group: { _id: { $ifNull: ['$gender', 'UNKNOWN'] }, count: { $sum: 1 } } }, { $project: { _id: 0, key: '$_id', count: 1 } }],
        age: [
          {
            $group: {
              _id: {
                $switch: {
                  branches: [
                    { case: { $not: ['$dateOfBirth'] }, then: 'Unknown' },
                    { case: { $gt: ['$dateOfBirth', yearsAgo(18)] }, then: '0-17' },
                    { case: { $gt: ['$dateOfBirth', yearsAgo(30)] }, then: '18-29' },
                    { case: { $gt: ['$dateOfBirth', yearsAgo(45)] }, then: '30-44' },
                    { case: { $gt: ['$dateOfBirth', yearsAgo(60)] }, then: '45-59' },
                  ],
                  default: '60+',
                },
              },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, key: '$_id', count: 1 } },
        ],
        cities: [
          { $match: { city: { $nin: [null, ''] } } },
          { $group: { _id: '$city', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 8 },
          { $project: { _id: 0, key: '$_id', count: 1 } },
        ],
        sources: [{ $group: { _id: { $ifNull: ['$referralSource', 'UNKNOWN'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $project: { _id: 0, key: '$_id', count: 1 } }],
        conditions: [
          { $unwind: '$conditions' },
          { $group: { _id: { $toLower: '$conditions' }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 8 },
          { $project: { _id: 0, key: '$_id', count: 1 } },
        ],
      },
    },
  ]);

  const AGE_ORDER = ['0-17', '18-29', '30-44', '45-59', '60+', 'Unknown'];
  const n = (x: { n: number }[]) => x[0]?.n ?? 0;
  res.status(200).json({
    success: true,
    data: {
      total: n(facets.total),
      profileCompletion: { withAge: n(facets.withAge), withGender: n(facets.withGender), withCity: n(facets.withCity) },
      gender: facets.gender.sort((a, b) => b.count - a.count),
      ageBands: AGE_ORDER.map((key) => ({ key, count: facets.age.find((b) => b.key === key)?.count ?? 0 })),
      cities: facets.cities,
      sources: facets.sources,
      conditions: facets.conditions,
    },
  });
};
