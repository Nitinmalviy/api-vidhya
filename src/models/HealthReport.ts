import mongoose, { Schema, type Types } from 'mongoose';

export interface IHealthReport {
  patientId: Types.ObjectId;
  snapshot: {
    name: string;
    age: number | null;
    gender: string | null;
    bloodGroup: string | null;
    heightCm: number | null;
    weightKg: number | null;
    bmi: number | null;
    bmiCategory: string | null;
    conditions: string[];
    allergies: string[];
  };
  concerns: {
    general?: string;
    hair?: string;
    skin?: string;
    lifestyle?: string;
  };
  analysis: string;
  aiGenerated: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const healthReportSchema = new Schema<IHealthReport>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    snapshot: {
      type: {
        name: { type: String, required: true },
        age: { type: Number, default: null },
        gender: { type: String, default: null },
        bloodGroup: { type: String, default: null },
        heightCm: { type: Number, default: null },
        weightKg: { type: Number, default: null },
        bmi: { type: Number, default: null },
        bmiCategory: { type: String, default: null },
        conditions: { type: [String], default: [] },
        allergies: { type: [String], default: [] },
      },
      _id: false,
      required: true,
    },
    concerns: {
      type: {
        general: { type: String, maxlength: 1000 },
        hair: { type: String, maxlength: 500 },
        skin: { type: String, maxlength: 500 },
        lifestyle: { type: String, maxlength: 500 },
      },
      _id: false,
      default: {},
    },
    analysis: { type: String, required: true },
    aiGenerated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const HealthReport = mongoose.model<IHealthReport>('HealthReport', healthReportSchema);
