import { Router } from 'express';
import {
  createAppointment,
  getMyAppointments,
  getBookedSlots,
} from '../../../controllers/patient/appointments.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.post('/', authenticate, authorize('user'), createAppointment);
router.get('/', authenticate, authorize('user'), getMyAppointments);
router.get('/booked-slots', authenticate, authorize('user'), getBookedSlots);

export default router;
