import { Types } from 'mongoose';
import { Appointment } from '../models/Appointment';
import { OpdConsultation } from '../models/OpdConsultation';

/**
 * Patients a doctor has actually seen or is about to see: a non-cancelled
 * appointment, or a Live-OPD call that connected. Prescribing and patient
 * search are limited to these, so a doctor can't browse or write to every
 * patient on the platform.
 */
export async function doctorPatientIds(doctorId: string): Promise<Types.ObjectId[]> {
  const [fromAppts, fromOpd] = await Promise.all([
    Appointment.distinct('patientId', { doctorId, status: { $ne: 'CANCELLED' }, patientId: { $ne: null } }),
    OpdConsultation.distinct('patientId', { doctorId, status: { $in: ['IN_CALL', 'COMPLETED'] } }),
  ]);
  const seen = new Map<string, Types.ObjectId>();
  for (const id of [...fromAppts, ...fromOpd] as Types.ObjectId[]) seen.set(String(id), id);
  return [...seen.values()];
}

export async function isDoctorsPatient(doctorId: string, patientId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(patientId)) return false;
  const [appt, opd] = await Promise.all([
    Appointment.exists({ doctorId, patientId, status: { $ne: 'CANCELLED' } }),
    OpdConsultation.exists({ doctorId, patientId, status: { $in: ['IN_CALL', 'COMPLETED'] } }),
  ]);
  return !!(appt || opd);
}
