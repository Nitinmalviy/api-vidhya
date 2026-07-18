import { Router } from 'express';
import { getPendingKYC, approveKYC, rejectKYC } from '../../controllers/admin/kyc.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/pending', getPendingKYC);
router.post('/:id/approve', approveKYC);
router.post('/:id/reject', rejectKYC);

export default router;
