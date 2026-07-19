import { Router } from 'express';
import {
  createAppointment,
  getMyAppointments,
  getBookedSlots,
  getAppointmentDetails,
  cancelAppointment,
  downloadInvoice,
  emailInvoice,
} from '../../../controllers/patient/appointments.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.post('/', authenticate, authorize('user'), createAppointment);
router.get('/', authenticate, authorize('user'), getMyAppointments);
router.get('/booked-slots', authenticate, authorize('user'), getBookedSlots);

router.get('/:id', authenticate, authorize('user'), getAppointmentDetails);
// Support both PATCH (web) and POST (mobile) for cancellation.
router.patch('/:id/cancel', authenticate, authorize('user'), cancelAppointment);
router.post('/:id/cancel', authenticate, authorize('user'), cancelAppointment);
router.get('/:id/invoice', authenticate, authorize('user'), downloadInvoice);
router.post('/:id/invoice/email', authenticate, authorize('user'), emailInvoice);

export default router;
