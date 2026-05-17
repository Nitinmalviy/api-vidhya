import { Router } from 'express';
import authRouter from './auth';
import dashboardRouter from './dashboard';
import profileRouter from './profile';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, scope: 'patient', status: 'ok' });
});

router.use('/auth', authRouter);
router.use('/dashboard', dashboardRouter);
router.use('/profile', profileRouter);

export default router;

