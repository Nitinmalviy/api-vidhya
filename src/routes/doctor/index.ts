import { Router } from 'express';
import authRouter from './auth';
import dashboardRouter from './dashboard';
import profileRouter from './profile';
import notificationsRouter from './notifications';
import appointmentsRouter from './appointments';
import patientsRouter from './patients';
import reviewsRouter from './reviews';

import opdRouter from './opd';
import prescriptionsRouter from './prescriptions';

const router = Router();
router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, scope: 'doctor', status: 'ok' });
});

router.use('/auth', authRouter);
router.use('/dashboard', dashboardRouter);
router.use('/profile', profileRouter);
router.use('/notifications', notificationsRouter);
router.use('/appointments', appointmentsRouter);
router.use('/patients', patientsRouter);
router.use('/reviews', reviewsRouter);
router.use('/opd', opdRouter);
router.use('/prescriptions', prescriptionsRouter);

export default router;

