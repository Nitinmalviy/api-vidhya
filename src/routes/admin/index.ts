import { Router } from 'express';
import authRouter from './auth';
import dashboardRouter from './dashboard';
import profileRouter from './profile';
import verifyDoctorRouter from './verify-doctor';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, scope: 'admin', status: 'ok' });
});

router.use('/auth', authRouter);
router.use('/dashboard', dashboardRouter);
router.use('/profile', profileRouter);
router.use('/verify-doctor', verifyDoctorRouter);

export default router;

