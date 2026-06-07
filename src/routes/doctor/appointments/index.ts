import { Router } from 'express';
import {
  getDoctorAppointments,
  updateAppointmentStatus,
} from '../../../controllers/doctor/appointments.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('doctor'), getDoctorAppointments);
router.patch('/:id/status', authenticate, authorize('doctor'), updateAppointmentStatus);

export default router;
