import { Router } from 'express';
import { getDashboard } from '../../../controllers/doctor/dashboard.controller';
import { authenticate, authorize } from '../../../middleware/auth';
import { isApprovedDoctor } from '../../../middleware/isApprovedDoctor';

const router = Router();

router.get('/', authenticate, authorize('doctor'), getDashboard);
router.get('/consultations', authenticate, isApprovedDoctor, (_req, res) => {
  res.status(200).json({ success: true, message: 'Consultation dashboard (dummy)' });
});

export default router;

