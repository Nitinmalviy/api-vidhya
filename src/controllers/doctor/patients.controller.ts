import type { Response } from 'express';
import { Appointment } from '../../models/Appointment';
import type { AuthRequest } from '../../types';
import { UnauthorizedError } from '../../utils/AppError';

/* ─────────────────────────────────────────────
   GET /api/v1/doctor/patients?search=
   Distinct patients who have booked with this doctor,
   with visit counts and last-visit date.
───────────────────────────────────────────── */
export const getDoctorPatients = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const search = String(req.query.search ?? '').trim();

  const appointments = await Appointment.find({ doctorId: req.user.id })
    .populate('patientId', 'name email phone gender dateOfBirth')
    .sort({ date: -1, createdAt: -1 })
    .lean();

  type PatientCard = {
    id: string;
    name: string;
    email: string;
    phone: string;
    gender: string | null;
    dateOfBirth: string | null;
    visits: number;
    lastVisit: string | null;
    lastStatus: string | null;
  };

  const byPatient = new Map<string, PatientCard>();
  for (const appt of appointments) {
    const p = appt.patientId as unknown as {
      _id: unknown;
      name?: string;
      email?: string;
      phone?: string;
      gender?: string;
      dateOfBirth?: Date;
    } | null;
    if (!p?._id) continue;
    const id = String(p._id);
    const existing = byPatient.get(id);
    if (existing) {
      existing.visits += 1;
      continue;
    }
    byPatient.set(id, {
      id,
      name: p.name ?? 'Patient',
      email: p.email ?? '',
      phone: p.phone ?? '',
      gender: p.gender ?? null,
      dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth).toISOString() : null,
      visits: 1,
      // Appointments are sorted newest-first, so the first row per patient is
      // their most recent visit.
      lastVisit: appt.date ?? null,
      lastStatus: appt.status ?? null,
    });
  }

  let patients = [...byPatient.values()];
  if (search) {
    const q = search.toLowerCase();
    patients = patients.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || p.phone.includes(q)
    );
  }

  res.status(200).json({ success: true, data: { patients, total: patients.length } });
};
