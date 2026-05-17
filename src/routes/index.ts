import { Router } from 'express';
import adminRouter from './admin';
import doctorRouter from './doctor';
import patientRouter from './patient';

const router = Router();

router.get('/api/v1/health', (_req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

router.use('/api/v1/admin', adminRouter);
router.use('/api/v1/doctor', doctorRouter);
router.use('/api/v1/patient', patientRouter);

export default router;
