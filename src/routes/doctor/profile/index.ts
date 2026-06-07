import { Router } from 'express';
import { getProfile, updateProfile, updateKyc } from '../../../controllers/doctor/profile.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('doctor'), getProfile);
router.patch('/', authenticate, authorize('doctor'), updateProfile);
router.patch('/kyc', authenticate, authorize('doctor'), updateKyc);

export default router;
