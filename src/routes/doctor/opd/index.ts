import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import {
  callPatient,
  createOpdSession,
  endConsultation,
  getOpdAccess,
  getOpdQueue,
  getOpdSessions,
  requestOpdAccess,
  skipConsultation,
  updateOpdSessionStatus,
} from '../../../controllers/doctor/opd.controller';

const router = Router();

router.use(authenticate, authorize('doctor'));

// Admin-granted access to run Live-OPD at all.
router.get('/access', getOpdAccess);
router.post('/access/request', requestOpdAccess);

// Sessions (the doctor's desk).
router.post('/', createOpdSession);
router.get('/', getOpdSessions);
router.patch('/:id/status', updateOpdSessionStatus);
router.get('/:id/queue', getOpdQueue);

// The 1:1 calls themselves.
router.post('/consultations/:id/call', callPatient);
router.post('/consultations/:id/end', endConsultation);
router.post('/consultations/:id/skip', skipConsultation);

export default router;
