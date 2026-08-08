import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import { listOpdSessions, joinOpdSession, leaveOpdSession } from '../../../controllers/patient/opd.controller';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', listOpdSessions);
router.post('/:sessionId/join', joinOpdSession);
router.delete('/:sessionId/leave', leaveOpdSession);

export default router;
