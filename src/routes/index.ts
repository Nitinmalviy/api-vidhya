import { Router } from 'express';
import adminRouter from './admin';
import doctorRouter from './doctor';
import patientRouter from './patient';

const router = Router();

router.get('/', (_req, res) => {
  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  res.render('index', {
    env: process.env.NODE_ENV ?? 'development',
    version: process.env.npm_package_version ?? '1.0.0',
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    timestamp: new Date().toUTCString(),
  });
});

router.get('/api/v1/health', (_req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

import paymentRouter from './payment.routes';

router.use('/api/v1/admin', adminRouter);
router.use('/api/v1/doctor', doctorRouter);
router.use('/api/v1/patient', patientRouter);
router.use('/api/v1/payments', paymentRouter);

export default router;
