import { Router } from 'express';
import { getDoctorPatients } from '../../../controllers/doctor/patients.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('doctor'), getDoctorPatients);

export default router;
