import type { Response } from 'express';
import { z } from 'zod';
import { Doctor } from '../../models/Doctor';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { OPEN_HOURS, cleanWeekly, effectiveAvailability, nowInIndia } from '../../utils/availability';

export const availabilitySchema = z.object({
  accepting: z.boolean(),
  weekly: z.array(z.array(z.string())).length(7),
  blockedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(120),
});

/* GET /api/v1/doctor/availability */
export const getAvailability = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const doctor = await Doctor.findById(req.user.id).select('availability').lean();
  if (!doctor) throw new NotFoundError('Doctor');
  res.status(200).json({
    success: true,
    data: {
      availability: effectiveAvailability(doctor.availability),
      isDefault: !doctor.availability?.weekly?.length,
      hours: OPEN_HOURS,
    },
  });
};

/* PUT /api/v1/doctor/availability  { accepting, weekly[7][], blockedDates[] } */
export const saveAvailability = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const body = req.body as z.infer<typeof availabilitySchema>;

  let weekly: string[][];
  try {
    weekly = cleanWeekly(body.weekly);
  } catch (e) {
    throw new BadRequestError((e as Error).message);
  }
  // Past blocked dates are noise — keep today onwards.
  const today = nowInIndia().date;
  const blockedDates = [...new Set(body.blockedDates)].filter((d) => d >= today).sort();

  const availability = { accepting: body.accepting, weekly, blockedDates, updatedAt: new Date() };
  await Doctor.updateOne({ _id: req.user.id }, { availability });
  res.status(200).json({ success: true, message: 'Availability saved', data: { availability } });
};
