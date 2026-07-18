import mongoose, { Schema, type Types } from 'mongoose';

export interface IReview {
  doctorId: Types.ObjectId;
  /** Absent on seeded reviews; set when a signed-in patient reviews. */
  patientId?: Types.ObjectId;
  patientName: string;
  rating: number;
  text?: string;
}

const reviewSchema = new Schema<IReview>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: false },
    patientName: { type: String, required: true, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, required: false, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

// One review per patient per doctor (seeded reviews have no patientId).
reviewSchema.index(
  { doctorId: 1, patientId: 1 },
  { unique: true, partialFilterExpression: { patientId: { $exists: true } } }
);

export const Review = mongoose.model<IReview>('Review', reviewSchema);
