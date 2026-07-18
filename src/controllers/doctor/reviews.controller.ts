import type { Response } from 'express';
import { Types } from 'mongoose';
import { Review } from '../../models/Review';
import type { AuthRequest } from '../../types';
import { UnauthorizedError } from '../../utils/AppError';

/* ─────────────────────────────────────────────
   GET /api/v1/doctor/reviews
   The signed-in doctor's own reviews + rating summary.
───────────────────────────────────────────── */
export const getMyReviews = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const doctorId = new Types.ObjectId(req.user.id);

  const [reviews, rows] = await Promise.all([
    Review.find({ doctorId })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('patientName rating text createdAt')
      .lean(),
    Review.aggregate<{ _id: number; count: number }>([
      { $match: { doctorId } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
  ]);

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    distribution[r._id] = r.count;
    sum += r._id * r.count;
    count += r.count;
  }

  res.status(200).json({
    success: true,
    data: {
      reviews,
      rating: {
        average: count ? Math.round((sum / count) * 10) / 10 : 0,
        count,
        distribution,
      },
    },
  });
};
