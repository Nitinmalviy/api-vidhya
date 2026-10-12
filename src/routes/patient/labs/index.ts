import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { listLabs, getLab } from '../../../controllers/patient/labs.controller';
import {
  cancelLabBooking,
  createLabBooking,
  createLabBookingSchema,
  getLabSlots,
  listLabBookings,
} from '../../../controllers/patient/labBookings.controller';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', listLabs);

// Bookings — declared before '/:id' so "bookings" isn't read as a lab id.
router.get('/bookings', listLabBookings);
router.get('/bookings/slots', getLabSlots);
router.post('/bookings', validate(createLabBookingSchema), createLabBooking);
router.patch('/bookings/:id/cancel', cancelLabBooking);

router.get('/:id', getLab);

export default router;
