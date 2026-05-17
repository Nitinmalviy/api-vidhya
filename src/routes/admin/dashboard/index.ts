import { Router } from 'express';
import { getDashboard } from '../../../controllers/admin/dashboard.controller';

const router = Router();

router.get('/', getDashboard);

export default router;

