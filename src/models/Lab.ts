import mongoose, { Schema } from 'mongoose';

/** A single test a lab offers, with its price and turnaround. */
export interface ILabTest {
  name: string;
  price: number;
  /** e.g. "Same day", "24 hrs" */
  reportTime?: string;
}

export interface ILab {
  name: string;
  address: {
    line1?: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
  };
  /** GeoJSON Point — [lng, lat]. Required so labs are always findable by distance. */
  location: { type: 'Point'; coordinates: [number, number] };
  phone?: string;
  /** NABL / ISO accreditation shown as a trust signal. */
  accreditation?: string;
  rating?: number;
  /** Does the lab collect samples at the patient's home? */
  homeCollection: boolean;
  openHours?: string;
  tests: ILabTest[];
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const labTestSchema = new Schema<ILabTest>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    price: { type: Number, required: true, min: 0 },
    reportTime: { type: String, trim: true, maxlength: 40 },
  },
  { _id: false }
);

const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false }
);

const labSchema = new Schema<ILab>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    address: {
      line1: { type: String, trim: true, maxlength: 200 },
      city: { type: String, trim: true, maxlength: 100 },
      state: { type: String, trim: true, maxlength: 100 },
      country: { type: String, trim: true, maxlength: 100, default: 'India' },
      zip: { type: String, trim: true, maxlength: 20 },
    },
    location: { type: pointSchema, required: true },
    phone: { type: String, trim: true, maxlength: 20 },
    accreditation: { type: String, trim: true, maxlength: 60 },
    rating: { type: Number, min: 0, max: 5 },
    homeCollection: { type: Boolean, default: false },
    openHours: { type: String, trim: true, maxlength: 60 },
    tests: { type: [labTestSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Geospatial index for the nearby-lab ($geoNear) search.
labSchema.index({ location: '2dsphere' });
labSchema.index({ isActive: 1 });

export const Lab = mongoose.model<ILab>('Lab', labSchema);
