import { Router } from 'express';
import { getMyReviews } from '../../../controllers/doctor/reviews.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, authorize('doctor'), getMyReviews);

export default router;
