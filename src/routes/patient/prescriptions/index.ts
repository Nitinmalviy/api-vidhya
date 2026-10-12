import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import { downloadPrescriptionPdf, listMyPrescriptions } from '../../../controllers/patient/prescriptions.controller';

const router = Router();

router.use(authenticate, authorize('user'));
router.get('/', listMyPrescriptions);
router.get('/:id/pdf', downloadPrescriptionPdf);

export default router;
