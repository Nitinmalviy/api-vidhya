import { Router } from 'express';
import {
  clinicPaymentSchema,
  createClinicBooking,
  createClinicBookingSchema,
  getClinicDay,
  getClinicSlots,
  lookupClinicPatient,
  recordClinicPayment,
  undoClinicPayment,
  updateVisit,
  visitActionSchema,
} from '../../../controllers/doctor/clinic.controller';
import { authenticate, authorize } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';

const router = Router();

router.use(authenticate, authorize('doctor'));

router.get('/day', getClinicDay);
router.get('/slots', getClinicSlots);
router.get('/lookup', lookupClinicPatient);
router.post('/bookings', validate(createClinicBookingSchema), createClinicBooking);
router.patch('/bookings/:id/visit', validate(visitActionSchema), updateVisit);
router.post('/bookings/:id/payment', validate(clinicPaymentSchema), recordClinicPayment);
router.delete('/bookings/:id/payment', undoClinicPayment);

export default router;
