import { Router } from 'express';
import { getDashboard } from '../../../controllers/admin/dashboard.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('admin'), getDashboard);

export default router;

