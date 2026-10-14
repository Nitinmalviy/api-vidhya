import { Router } from 'express';
import { getDoctors, removeDoctor } from '../../../controllers/admin/doctors.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('admin'), getDoctors);
router.post('/:id/remove', authenticate, authorize('admin'), removeDoctor);

export default router;
