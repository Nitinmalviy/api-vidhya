import { Router } from 'express';
import { getDoctors, getDoctorById } from '../../../controllers/patient/doctors.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('user'), getDoctors);
router.get('/:id', authenticate, authorize('user'), getDoctorById);

export default router;
