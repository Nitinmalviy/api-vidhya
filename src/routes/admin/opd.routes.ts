import { Router } from 'express';
import {
  getLiveOpdOverview,
  listOpdRequests,
  reviewOpdRequest,
} from '../../controllers/admin/opd.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/requests', listOpdRequests);
router.patch('/requests/:doctorId', reviewOpdRequest);
router.get('/live', getLiveOpdOverview);

export default router;
