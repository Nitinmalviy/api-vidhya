import type { Response } from 'express';
import { Types } from 'mongoose';
import { Lab } from '../../models/Lab';
import { Patient } from '../../models/Patient';
import type { AuthRequest } from '../../types';
import { NotFoundError, UnauthorizedError } from '../../utils/AppError';

/** Default search radius when the caller doesn't pass one. */
const DEFAULT_RADIUS_KM = 25;
const MAX_RADIUS_KM = 100;

function parseCoord(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (Number.isNaN(n) || n < min || n > max) return null;
  return n;
}

/**
 * GET /api/v1/patient/labs?lat=&lng=&radiusKm=&search=
 *
 * Labs nearest first. When lat/lng are omitted we fall back to the patient's
 * default saved address, so the page works without asking for browser
 * geolocation. If we still have no coordinates, labs come back unsorted with
 * `distanceKm: null` rather than an empty list.
 */
export const listLabs = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const { search, radiusKm } = req.query;

  const filter: Record<string, unknown> = { isActive: true };
  if (search) {
    const q = String(search);
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { 'address.city': { $regex: q, $options: 'i' } },
      { 'tests.name': { $regex: q, $options: 'i' } },
    ];
  }

  let lat = parseCoord(req.query.lat, -90, 90);
  let lng = parseCoord(req.query.lng, -180, 180);
  let usedFallbackAddress = false;

  // No coords supplied → use the patient's default (or first) saved address.
  if (lat === null || lng === null) {
    const patient = await Patient.findById(req.user.id).select('addresses').lean();
    const addresses = patient?.addresses ?? [];
    const preferred = addresses.find((a) => a.isDefault && a.lat != null && a.lng != null)
      ?? addresses.find((a) => a.lat != null && a.lng != null);
    if (preferred?.lat != null && preferred?.lng != null) {
      lat = preferred.lat;
      lng = preferred.lng;
      usedFallbackAddress = true;
    }
  }

  // Unlocated fallback — still return labs so the page isn't empty.
  if (lat === null || lng === null) {
    const labs = await Lab.find(filter).sort({ rating: -1 }).limit(30).lean();
    res.status(200).json({
      success: true,
      data: {
        labs: labs.map((l) => ({ ...l, distanceKm: null })),
        origin: null,
        usedFallbackAddress: false,
      },
    });
    return;
  }

  const radius = Math.min(MAX_RADIUS_KM, Math.max(1, Number(radiusKm) || DEFAULT_RADIUS_KM));

  const labs = await Lab.aggregate<{ _id: Types.ObjectId; distanceM: number }>([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distanceM',
        spherical: true,
        maxDistance: radius * 1000,
        query: filter,
      },
    },
    { $limit: 30 },
  ]);

  res.status(200).json({
    success: true,
    data: {
      labs: labs.map((l) => {
        const { distanceM, ...rest } = l as any;
        return { ...rest, distanceKm: Math.round((distanceM / 1000) * 10) / 10 };
      }),
      origin: { lat, lng },
      usedFallbackAddress,
      radiusKm: radius,
    },
  });
};

/* GET /api/v1/patient/labs/:id */
export const getLab = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const lab = await Lab.findOne({ _id: req.params.id, isActive: true }).lean();
  if (!lab) throw new NotFoundError('Lab');
  res.status(200).json({ success: true, data: { lab } });
};
