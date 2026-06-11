import type { Response } from 'express';
import { HealthReport } from '../../models/HealthReport';
import { Patient } from '../../models/Patient';
import { generateHealthAnalysis, type HealthReportInput } from '../../services/ai';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function calcAge(dob?: Date | null): number | null {
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  const age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
  return age >= 0 && age < 130 ? age : null;
}

function calcBmi(heightCm?: number | null, weightKg?: number | null) {
  if (!heightCm || !weightKg) return { bmi: null, bmiCategory: null };
  const bmi = Math.round((weightKg / Math.pow(heightCm / 100, 2)) * 10) / 10;
  const bmiCategory =
    bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
  return { bmi, bmiCategory };
}

/** Plain report used when every AI provider is down — never block the feature. */
function baselineAnalysis(input: HealthReportInput): string {
  const parts: string[] = [];
  parts.push(
    'Overview:\nOur AI analyst is temporarily unavailable, so this is a basic summary generated from your data. Generate a new report later for a personalised analysis.'
  );
  if (input.bmi !== null) {
    const advice =
      input.bmiCategory === 'Underweight'
        ? 'Your BMI is below the healthy range. Focus on nutrient-dense meals and consult a doctor if you are losing weight unintentionally.'
        : input.bmiCategory === 'Normal'
          ? 'Your BMI is in the healthy range. Keep up balanced meals and regular activity.'
          : 'Your BMI is above the healthy range. Gradual changes — daily walks, smaller portions, less fried food — make a real difference.';
    parts.push(`Body Assessment:\nYour BMI is ${input.bmi} (${input.bmiCategory}). ${advice}`);
  }
  parts.push(
    'Lifestyle Recommendations:\nAim for 7–8 hours of sleep, 30 minutes of activity daily, and 2–3 litres of water.'
  );
  if (input.concerns.hair) {
    parts.push('Hair Care:\nFor your hair concerns, a dermatologist can identify the exact cause — common factors are nutrition, stress and scalp health.');
  }
  if (input.concerns.skin) {
    parts.push('Skin Care:\nFor your skin concerns, keep the area clean and moisturised and avoid harsh products until a dermatologist reviews it.');
  }
  parts.push(
    'When to See a Doctor:\nIf any concern is persistent, painful or worsening, book a consultation with a verified doctor in the app.'
  );
  return parts.join('\n\n');
}

/* POST /api/v1/patient/health-reports
 * { concerns?: { general?, hair?, skin?, lifestyle? },
 *   vitals?: { heightCm?, weightKg?, bloodGroup? } }   ← also saved to profile */
export const createReport = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { concerns = {}, vitals = {} } = req.body ?? {};

  const patient = await Patient.findById(req.user.id);
  if (!patient) throw new NotFoundError('Patient');

  // Fresh vitals from the form are saved back to the profile so every
  // report improves the data we can analyse over time.
  if (vitals.heightCm !== undefined && vitals.heightCm !== null) {
    const h = Number(vitals.heightCm);
    if (Number.isNaN(h) || h < 30 || h > 272) throw new BadRequestError('Invalid height');
    patient.heightCm = h;
  }
  if (vitals.weightKg !== undefined && vitals.weightKg !== null) {
    const w = Number(vitals.weightKg);
    if (Number.isNaN(w) || w < 1 || w > 500) throw new BadRequestError('Invalid weight');
    patient.weightKg = w;
  }
  if (vitals.bloodGroup) {
    if (!BLOOD_GROUPS.includes(vitals.bloodGroup)) throw new BadRequestError('Invalid blood group');
    patient.bloodGroup = vitals.bloodGroup;
  }
  if (patient.isModified()) await patient.save();

  const clean = (v: unknown, max: number) =>
    v ? String(v).trim().slice(0, max) : undefined;
  const cleanConcerns = {
    general: clean(concerns.general, 1000),
    hair: clean(concerns.hair, 500),
    skin: clean(concerns.skin, 500),
    lifestyle: clean(concerns.lifestyle, 500),
  };

  const { bmi, bmiCategory } = calcBmi(patient.heightCm, patient.weightKg);
  const input: HealthReportInput = {
    name: patient.name,
    age: calcAge(patient.dateOfBirth),
    gender: patient.gender ?? null,
    bloodGroup: patient.bloodGroup ?? null,
    heightCm: patient.heightCm ?? null,
    weightKg: patient.weightKg ?? null,
    bmi,
    bmiCategory,
    conditions: patient.conditions ?? [],
    allergies: patient.allergies ?? [],
    concerns: cleanConcerns,
  };

  const aiAnalysis = await generateHealthAnalysis(input);

  const report = await HealthReport.create({
    patientId: patient._id,
    snapshot: {
      name: input.name,
      age: input.age,
      gender: input.gender,
      bloodGroup: input.bloodGroup,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      bmi: input.bmi,
      bmiCategory: input.bmiCategory,
      conditions: input.conditions,
      allergies: input.allergies,
    },
    concerns: cleanConcerns,
    analysis: aiAnalysis ?? baselineAnalysis(input),
    aiGenerated: Boolean(aiAnalysis),
  });

  res.status(201).json({ success: true, message: 'Health report generated', data: { report } });
};

/* GET /api/v1/patient/health-reports */
export const listReports = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const reports = await HealthReport.find({ patientId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.status(200).json({ success: true, data: { reports } });
};

/* GET /api/v1/patient/health-reports/:id */
export const getReport = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const report = await HealthReport.findOne({ _id: req.params.id, patientId: req.user.id }).lean();
  if (!report) throw new NotFoundError('Report');
  res.status(200).json({ success: true, data: { report } });
};

/* DELETE /api/v1/patient/health-reports/:id */
export const deleteReport = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const deleted = await HealthReport.findOneAndDelete({
    _id: req.params.id,
    patientId: req.user.id,
  });
  if (!deleted) throw new NotFoundError('Report');
  res.status(200).json({ success: true, message: 'Report deleted' });
};
