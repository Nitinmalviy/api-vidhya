import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import {
  createOpdSession,
  getOpdSessions,
  updateOpdSessionStatus,
} from '../../../controllers/doctor/opd.controller';

const router = Router();

router.use(authenticate, authorize('doctor'));

router.post('/', createOpdSession);
router.get('/', getOpdSessions);
router.patch('/:id/status', updateOpdSessionStatus);

export default router;
