import { Router } from 'express';
import { getClinics } from '../../controllers/admin/clinics.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', getClinics);

export default router;
