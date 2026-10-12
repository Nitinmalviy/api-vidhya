import { Types } from 'mongoose';
import { OpdConsultation, type OpdConsultationStatus } from '../models/OpdConsultation';
import { Prescription } from '../models/Prescription';

/** Calls that are over, one way or another. Open calls live on the OPD screen itself. */
export const HISTORY_STATES: OpdConsultationStatus[] = ['COMPLETED', 'MISSED', 'EXPIRED', 'CANCELLED'];

export type HistoryViewer = 'patient' | 'doctor';

/**
 * Past Live-OPD calls for one patient or one doctor, newest first, with the
 * other party's name and whether a prescription came out of it.
 *
 * Doctor notes are the doctor's own working notes, so they are only returned
 * to the doctor; the patient gets the prescription instead.
 */
export async function listOpdHistory(params: {
  viewer: HistoryViewer;
  userId: string;
  page: number;
  limit: number;
  status?: string;
}) {
  const { viewer, userId } = params;
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(50, Math.max(1, params.limit || 20));

  const owner = viewer === 'patient' ? { patientId: new Types.ObjectId(userId) } : { doctorId: new Types.ObjectId(userId) };
  const statuses = HISTORY_STATES.includes(params.status as OpdConsultationStatus)
    ? [params.status as OpdConsultationStatus]
    : HISTORY_STATES;
  const filter = { ...owner, status: { $in: statuses } };

  const [rows, total, stats] = await Promise.all([
    OpdConsultation.find(filter)
      .sort({ queuedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(viewer === 'patient' ? { path: 'doctorId', select: 'name specializations photoUrl' } : { path: 'patientId', select: 'name gender dateOfBirth' })
      .lean(),
    OpdConsultation.countDocuments(filter),
    OpdConsultation.aggregate<{ calls: number; completed: number; seconds: number }>([
      { $match: { ...owner, status: { $in: HISTORY_STATES } } },
      {
        $group: {
          _id: null,
          calls: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
          seconds: { $sum: { $ifNull: ['$durationSec', 0] } },
        },
      },
    ]),
  ]);

  // One query for every prescription that belongs to these calls.
  const apptIds = rows.map((r) => r.appointmentId).filter(Boolean) as Types.ObjectId[];
  const prescriptions = apptIds.length
    ? await Prescription.find({ appointmentId: { $in: apptIds } }).select('_id appointmentId').lean()
    : [];
  const rxByAppt = new Map(prescriptions.map((p) => [String(p.appointmentId), String(p._id)]));

  const calls = rows.map((r) => {
    const other = (viewer === 'patient' ? r.doctorId : r.patientId) as unknown as
      | { _id: Types.ObjectId; name?: string; specializations?: string[]; photoUrl?: string }
      | null;
    return {
      id: String(r._id),
      status: r.status,
      reason: r.reason ?? null,
      requestedAt: r.queuedAt ?? r.createdAt ?? null,
      startedAt: r.startedAt ?? null,
      endedAt: r.endedAt ?? null,
      durationSec: r.durationSec ?? null,
      counterpart: other
        ? {
            id: String(other._id),
            name: other.name ?? (viewer === 'patient' ? 'Doctor' : 'Patient'),
            specialization: other.specializations?.[0] ?? null,
            photoUrl: other.photoUrl ?? null,
          }
        : null,
      appointmentId: r.appointmentId ? String(r.appointmentId) : null,
      prescriptionId: r.appointmentId ? rxByAppt.get(String(r.appointmentId)) ?? null : null,
      ...(viewer === 'doctor' ? { doctorNotes: r.doctorNotes ?? null } : {}),
    };
  });

  const s = stats[0];
  return {
    calls,
    total,
    page,
    limit,
    summary: {
      calls: s?.calls ?? 0,
      completed: s?.completed ?? 0,
      minutes: Math.round((s?.seconds ?? 0) / 60),
    },
  };
}
