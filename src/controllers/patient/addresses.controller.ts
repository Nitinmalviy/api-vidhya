import type { Response } from 'express';
import { Patient, type IAddress, type AddressLabel } from '../../models/Patient';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';

const LABELS: AddressLabel[] = ['HOME', 'WORK', 'OTHER'];

/** Validate + normalize an address payload from the request body. */
function parseAddress(body: any): Omit<IAddress, 'isDefault'> {
  const line1 = String(body?.line1 ?? '').trim();
  const city = String(body?.city ?? '').trim();
  const state = String(body?.state ?? '').trim();
  const country = String(body?.country ?? '').trim();
  const zip = String(body?.zip ?? '').trim();

  if (!line1) throw new BadRequestError('Address line is required');
  if (!city) throw new BadRequestError('City is required');
  if (!state) throw new BadRequestError('State is required');
  if (!country) throw new BadRequestError('Country is required');
  if (!zip) throw new BadRequestError('ZIP / postal code is required');

  const label: AddressLabel = LABELS.includes(body?.label) ? body.label : 'HOME';

  const lat = body?.lat != null ? Number(body.lat) : undefined;
  const lng = body?.lng != null ? Number(body.lng) : undefined;
  if (lat !== undefined && (Number.isNaN(lat) || lat < -90 || lat > 90)) throw new BadRequestError('Invalid latitude');
  if (lng !== undefined && (Number.isNaN(lng) || lng < -180 || lng > 180)) throw new BadRequestError('Invalid longitude');

  return {
    label,
    line1: line1.slice(0, 200),
    line2: body?.line2 ? String(body.line2).trim().slice(0, 200) : undefined,
    city: city.slice(0, 100),
    state: state.slice(0, 100),
    country: country.slice(0, 100),
    zip: zip.slice(0, 20),
    lat,
    lng,
  };
}

/* GET /api/v1/patient/profile/addresses */
export const listAddresses = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const patient = await Patient.findById(req.user.id).select('addresses').lean();
  if (!patient) throw new NotFoundError('Patient');
  res.status(200).json({ success: true, data: { addresses: patient.addresses ?? [] } });
};

/* POST /api/v1/patient/profile/addresses */
export const addAddress = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const parsed = parseAddress(req.body);

  const patient = await Patient.findById(req.user.id).select('addresses');
  if (!patient) throw new NotFoundError('Patient');

  // First address is always the default; caller may also force it.
  const makeDefault = patient.addresses.length === 0 || Boolean(req.body?.isDefault);
  if (makeDefault) patient.addresses.forEach((a) => (a.isDefault = false));
  patient.addresses.push({ ...parsed, isDefault: makeDefault } as IAddress);
  await patient.save();

  res.status(201).json({ success: true, message: 'Address added', data: { addresses: patient.addresses } });
};

/* PUT /api/v1/patient/profile/addresses/:id */
export const updateAddress = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const parsed = parseAddress(req.body);

  const patient = await Patient.findById(req.user.id).select('addresses');
  if (!patient) throw new NotFoundError('Patient');

  const addr: any = (patient.addresses as any).id(req.params.id);
  if (!addr) throw new NotFoundError('Address');

  Object.assign(addr, parsed);
  if (req.body?.isDefault) {
    patient.addresses.forEach((a) => (a.isDefault = false));
    addr.isDefault = true;
  }
  await patient.save();

  res.status(200).json({ success: true, message: 'Address updated', data: { addresses: patient.addresses } });
};

/* DELETE /api/v1/patient/profile/addresses/:id */
export const deleteAddress = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const patient = await Patient.findById(req.user.id).select('addresses');
  if (!patient) throw new NotFoundError('Patient');

  const addr: any = (patient.addresses as any).id(req.params.id);
  if (!addr) throw new NotFoundError('Address');

  const wasDefault = addr.isDefault;
  addr.deleteOne();
  // Promote the first remaining address to default if we removed the default.
  if (wasDefault && patient.addresses.length > 0) patient.addresses[0].isDefault = true;
  await patient.save();

  res.status(200).json({ success: true, message: 'Address deleted', data: { addresses: patient.addresses } });
};

/* PATCH /api/v1/patient/profile/addresses/:id/default */
export const setDefaultAddress = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const patient = await Patient.findById(req.user.id).select('addresses');
  if (!patient) throw new NotFoundError('Patient');

  const addr: any = (patient.addresses as any).id(req.params.id);
  if (!addr) throw new NotFoundError('Address');

  patient.addresses.forEach((a) => (a.isDefault = false));
  addr.isDefault = true;
  await patient.save();

  res.status(200).json({ success: true, message: 'Default address updated', data: { addresses: patient.addresses } });
};
