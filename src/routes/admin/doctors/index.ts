import { Router } from 'express';
import { getDoctors } from '../../../controllers/admin/doctors.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('admin'), getDoctors);

export default router;
