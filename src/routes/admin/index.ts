import { Router } from 'express';
import authRouter from './auth';
import dashboardRouter from './dashboard';
import profileRouter from './profile';
import verifyDoctorRouter from './verify-doctor';
import doctorsRouter from './doctors';
import { authenticate, authorize } from '../../middleware/auth';
import { adminAccess } from '../../middleware/adminAccess';
import { getPatients } from '../../controllers/admin/patients.controller';
import { getGrowthStats, getKycStats, getPatientInsights } from '../../controllers/admin/stats.controller';
import { getTopDoctors } from '../../controllers/admin/top-doctors.controller';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, scope: 'admin', status: 'ok' });
});

// Looks up the signed-in admin on every request and keeps front-desk staff to the walk-in desk.
router.use(adminAccess);

router.use('/auth', authRouter);
router.use('/dashboard', dashboardRouter);
router.use('/profile', profileRouter);
router.use('/verify-doctor', verifyDoctorRouter);
router.use('/doctors', doctorsRouter);

import kycRouter from './kyc.routes';
import clinicsRouter from './clinics.routes';
import revenueRouter from './revenue.routes';
import ticketsRouter from './tickets.routes';
import opdRouter from './opd.routes';
import walkinsRouter from './walkins.routes';
import teamRouter from './team.routes';

router.use('/opd', opdRouter);
router.use('/kyc', kycRouter);
router.use('/clinics', clinicsRouter);
router.use('/revenue', revenueRouter);
router.use('/tickets', ticketsRouter);
router.use('/walkins', walkinsRouter);
router.use('/team', teamRouter);

router.get('/patients', authenticate, authorize('admin'), getPatients);
router.get('/stats/growth', authenticate, authorize('admin'), getGrowthStats);
router.get('/stats/kyc', authenticate, authorize('admin'), getKycStats);
router.get('/stats/patient-insights', authenticate, authorize('admin'), getPatientInsights);
router.get('/top-doctors', authenticate, authorize('admin'), getTopDoctors);

export default router;
