import mongoose, { Schema, type Types } from 'mongoose';

/**
 * One patient's emergency-style connect request, and the 1:1 video call that
 * comes out of it.
 *
 *  RINGING   — routed to a doctor; ringing their desk until `ringExpiresAt`
 *  IN_CALL   — the doctor accepted; both sides can be in the LiveKit room
 *  COMPLETED — call finished normally
 *  EXPIRED   — the doctor didn't accept within the ring window, or declined;
 *              the patient is told to try again shortly
 *  MISSED    — accepted, but the patient never actually joined
 *  CANCELLED — patient backed out, or the desk closed under them
 *  WAITING   — legacy queue state, kept so old rows still read correctly
 */
export type OpdConsultationStatus =
  | 'WAITING'
  | 'RINGING'
  | 'IN_CALL'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'MISSED'
  | 'CANCELLED';

/** States where the request is still in play for both sides. */
export const OPEN_CONSULTATION_STATES: OpdConsultationStatus[] = ['WAITING', 'RINGING', 'IN_CALL'];

/** Outcomes the patient screen explains as "nobody could take your call". */
export const NO_ANSWER_STATES: OpdConsultationStatus[] = ['EXPIRED', 'MISSED'];

export interface IOpdConsultation {
  sessionId: Types.ObjectId;
  doctorId: Types.ObjectId;
  patientId: Types.ObjectId;
  status: OpdConsultationStatus;
  /** LiveKit room — unique per consultation, so no two calls can ever collide. */
  roomName: string;
  /** Queue ordering is by this, so it never shifts around. */
  queuedAt: Date;
  /** When the request started ringing the doctor. */
  calledAt?: Date | null;
  /** Hard deadline for the doctor to accept. Past this the request expires. */
  ringExpiresAt?: Date | null;
  /** First moment both participants were connected. */
  startedAt?: Date | null;
  endedAt?: Date | null;
  durationSec?: number;
  /** Appointment row written when the call completes, for history and prescriptions. */
  appointmentId?: Types.ObjectId;
  /** Why the patient wanted a consult — shown to the doctor before they answer. */
  reason?: string;
  doctorNotes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const opdConsultationSchema = new Schema<IOpdConsultation>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'OpdSession', required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    status: {
      type: String,
      enum: ['WAITING', 'RINGING', 'IN_CALL', 'COMPLETED', 'EXPIRED', 'MISSED', 'CANCELLED'],
      default: 'WAITING',
      index: true,
    },
    roomName: { type: String, required: true, unique: true },
    queuedAt: { type: Date, default: Date.now },
    calledAt: { type: Date, default: null },
    ringExpiresAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSec: { type: Number },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    reason: { type: String, trim: true, maxlength: 500 },
    doctorNotes: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

// "How long is each live doctor's queue" — the routing hot path.
opdConsultationSchema.index({ sessionId: 1, status: 1, queuedAt: 1 });
// "Does this patient already have something open" — checked on every consult request.
opdConsultationSchema.index({ patientId: 1, status: 1 });
// Lazy expiry sweeps on this.
opdConsultationSchema.index({ status: 1, ringExpiresAt: 1 });

export const OpdConsultation = mongoose.model<IOpdConsultation>(
  'OpdConsultation',
  opdConsultationSchema
);
