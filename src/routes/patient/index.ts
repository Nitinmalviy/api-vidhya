import { Router } from 'express';
import authRouter from './auth';
import dashboardRouter from './dashboard';
import profileRouter from './profile';
import doctorsRouter from './doctors';
import appointmentsRouter from './appointments';
import notificationsRouter from './notifications';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, scope: 'patient', status: 'ok' });
});

router.use('/auth', authRouter);
router.use('/dashboard', dashboardRouter);
router.use('/profile', profileRouter);
router.use('/doctors', doctorsRouter);
router.use('/appointments', appointmentsRouter);
router.use('/notifications', notificationsRouter);

export default router;

