import { Router } from 'express';
import {
  getDoctors,
  getDoctorById,
  getDoctorReviews,
  addDoctorReview,
} from '../../../controllers/patient/doctors.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('user'), getDoctors);
router.get('/:id', authenticate, authorize('user'), getDoctorById);
router.get('/:id/reviews', authenticate, authorize('user'), getDoctorReviews);
router.post('/:id/reviews', authenticate, authorize('user'), addDoctorReview);

export default router;
