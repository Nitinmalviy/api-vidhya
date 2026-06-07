import { Router } from 'express';
import authRouter from './auth';
import dashboardRouter from './dashboard';
import profileRouter from './profile';
import verifyDoctorRouter from './verify-doctor';
import doctorsRouter from './doctors';
import { authenticate, authorize } from '../../middleware/auth';
import { getPatients } from '../../controllers/admin/patients.controller';
import { getGrowthStats, getKycStats } from '../../controllers/admin/stats.controller';
import { getTopDoctors } from '../../controllers/admin/top-doctors.controller';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, scope: 'admin', status: 'ok' });
});

router.use('/auth', authRouter);
router.use('/dashboard', dashboardRouter);
router.use('/profile', profileRouter);
router.use('/verify-doctor', verifyDoctorRouter);
router.use('/doctors', doctorsRouter);

router.get('/patients', authenticate, authorize('admin'), getPatients);
router.get('/stats/growth', authenticate, authorize('admin'), getGrowthStats);
router.get('/stats/kyc', authenticate, authorize('admin'), getKycStats);
router.get('/top-doctors', authenticate, authorize('admin'), getTopDoctors);

export default router;
