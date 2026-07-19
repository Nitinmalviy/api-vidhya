import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import {
  createPrescription,
  getPrescriptions,
  searchPatients,
} from '../../../controllers/doctor/prescriptions.controller';

const router = Router();

router.use(authenticate, authorize('doctor'));

router.post('/', createPrescription);
router.get('/', getPrescriptions);
router.get('/patients/search', searchPatients);

export default router;
