import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import {
  getMyConsultation,
  joinConsultationCall,
  joinOpdSession,
  leaveQueue,
  listOpdSessions,
  requestConsultation,
} from '../../../controllers/patient/opd.controller';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', listOpdSessions);

// Walk-in flow: one button, routed to whichever doctor is free.
router.post('/consult', requestConsultation);
router.get('/my-consultation', getMyConsultation);
router.post('/consultations/:id/join', joinConsultationCall);
router.delete('/consultations/:id', leaveQueue);

// Legacy: join one named session. Kept for older app builds.
router.post('/:sessionId/join', joinOpdSession);

export default router;
