import { Router } from 'express';
import { getProfile, updateProfile } from '../../../controllers/doctor/profile.controller';

const router = Router();

router.get('/', getProfile);
router.patch('/', updateProfile);

export default router;

