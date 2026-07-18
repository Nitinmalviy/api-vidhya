import { Router } from 'express';
import { getRevenue } from '../../controllers/admin/revenue.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', getRevenue);

export default router;
