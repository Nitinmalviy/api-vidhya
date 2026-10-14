import { Router } from 'express';
import {
  clinicPaymentSchema,
  createClinicBooking,
  createClinicBookingSchema,
  getClinicDay,
  getPaymentAudit,
  getClinicSlots,
  lookupClinicPatient,
  recordClinicPayment,
  undoClinicPayment,
  updateVisit,
  visitActionSchema,
  rescheduleSchema,
  rescheduleVisit,
  editVisitSchema,
  editClinicVisit,
} from '../../../controllers/doctor/clinic.controller';
import { authenticate, authorize } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';

const router = Router();

router.use(authenticate, authorize('doctor'));

router.get('/day', getClinicDay);
router.get('/slots', getClinicSlots);
router.get('/lookup', lookupClinicPatient);
router.get('/audit', getPaymentAudit);
router.post('/bookings', validate(createClinicBookingSchema), createClinicBooking);
router.patch('/bookings/:id/visit', validate(visitActionSchema), updateVisit);
router.patch('/bookings/:id/reschedule', validate(rescheduleSchema), rescheduleVisit);
router.patch('/bookings/:id', validate(editVisitSchema), editClinicVisit);
router.post('/bookings/:id/payment', validate(clinicPaymentSchema), recordClinicPayment);
router.delete('/bookings/:id/payment', undoClinicPayment);

export default router;
