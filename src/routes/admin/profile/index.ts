import { Router } from 'express';
import { getProfile, updateProfile } from '../../../controllers/admin/profile.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('admin'), getProfile);
router.patch('/', authenticate, authorize('admin'), updateProfile);

export default router;
