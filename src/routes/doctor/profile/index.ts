import { Router } from 'express';
import { getProfile, updateProfile, updateKyc, uploadProfilePhoto } from '../../../controllers/doctor/profile.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('doctor'), getProfile);
router.patch('/', authenticate, authorize('doctor'), updateProfile);
router.patch('/kyc', authenticate, authorize('doctor'), updateKyc);
router.post('/photo', authenticate, authorize('doctor'), uploadProfilePhoto);

export default router;
