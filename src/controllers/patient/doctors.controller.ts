import type { Response } from 'express';
import { Types } from 'mongoose';
import { Doctor } from '../../models/Doctor';
import { Review } from '../../models/Review';
import { Appointment } from '../../models/Appointment';
import { Patient } from '../../models/Patient';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { getPresignedUrl, signFieldsArray } from '../../services/presignedUrl';

type RatingSummary = { average: number; count: number };

async function ratingsFor(doctorIds: Types.ObjectId[]): Promise<Map<string, RatingSummary>> {
  if (doctorIds.length === 0) return new Map();
  const rows = await Review.aggregate<{ _id: Types.ObjectId; average: number; count: number }>([
    { $match: { doctorId: { $in: doctorIds } } },
    { $group: { _id: '$doctorId', average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  return new Map(
    rows.map((r) => [String(r._id), { average: Math.round(r.average * 10) / 10, count: r.count }])
  );
}

async function signClinic(doc: any): Promise<void> {
  const clinic = doc?.clinicId;
  if (clinic && typeof clinic === 'object' && clinic.photoUrl) {
    const signed = await getPresignedUrl(clinic.photoUrl);
    if (signed) clinic.photoUrl = signed;
  }
}

export const getDoctors = async (req: AuthRequest, res: Response): Promise<void> => {
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
      .select('name specializations workType clinicId consultationFee photoUrl yearsExperience createdAt')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    Doctor.countDocuments(filter),
  ]);

  await signFieldsArray(doctors, ['photoUrl']);
  await Promise.all(doctors.map(signClinic));

  const ratings = await ratingsFor(doctors.map((d) => d._id));
  const withRatings = doctors.map((d) => ({
    ...d,
    rating: ratings.get(String(d._id)) ?? { average: 0, count: 0 },
  }));

  res.status(200).json({
    success: true,
    data: { doctors: withRatings, total, page: pageNum, limit: limitNum },
  });
};

export const getDoctorById = async (req: AuthRequest, res: Response): Promise<void> => {
  const doctor = await Doctor.findOne({ _id: req.params.id, kycStatus: 'APPROVED' })
    .populate('clinicId', 'name photoUrl isVerified')
    .select(
      'name specializations workType clinicId consultationFee photoUrl yearsExperience bio degreeDetails createdAt'
    )
    .lean();

  if (!doctor) throw new NotFoundError('Doctor not found');

  const signed = await getPresignedUrl((doctor as any).photoUrl);
  if (signed) (doctor as any).photoUrl = signed;
  await signClinic(doctor);

  const rows = await Review.aggregate<{ _id: number; count: number }>([
    { $match: { doctorId: doctor._id } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ]);
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    distribution[r._id] = r.count;
    sum += r._id * r.count;
    count += r.count;
  }

  const degreeName = doctor.degreeDetails?.degreeName ?? null;
  const { degreeDetails: _dd, ...publicDoctor } = doctor;

  res.status(200).json({
    success: true,
    data: {
      ...publicDoctor,
      degreeName,
      rating: {
        average: count ? Math.round((sum / count) * 10) / 10 : 0,
        count,
        distribution,
      },
    },
  });
};

export const getDoctorReviews = async (req: AuthRequest, res: Response): Promise<void> => {
  const reviews = await Review.find({ doctorId: req.params.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .select('patientName rating text createdAt')
    .lean();

  res.status(200).json({ success: true, data: { reviews } });
};

export const addDoctorReview = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { rating, text } = req.body ?? {};

  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    throw new BadRequestError('rating must be an integer from 1 to 5');
  }

  const doctor = await Doctor.findOne({ _id: req.params.id, kycStatus: 'APPROVED' })
    .select('_id')
    .lean();
  if (!doctor) throw new NotFoundError('Doctor not found');

  const attended = await Appointment.exists({
    doctorId: doctor._id,
    patientId: req.user.id,
    status: 'COMPLETED',
  });
  if (!attended) {
    throw new BadRequestError('You can review a doctor after completing an appointment with them');
  }

  const patient = await Patient.findById(req.user.id).select('name').lean();

  const review = await Review.findOneAndUpdate(
    { doctorId: doctor._id, patientId: req.user.id },
    {
      doctorId: doctor._id,
      patientId: req.user.id,
      patientName: patient?.name ?? 'Patient',
      rating: ratingNum,
      text: text ? String(text).trim().slice(0, 1000) : undefined,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  res.status(201).json({ success: true, message: 'Review saved', data: { review } });
};
