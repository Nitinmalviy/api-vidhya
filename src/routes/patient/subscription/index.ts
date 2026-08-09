import { Router } from 'express';
import {
  cancelAutoPay,
  getSubscription,
  startAutoPay,
  verifyAutoPay,
} from '../../../controllers/patient/subscription.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', getSubscription);
router.post('/autopay', startAutoPay);
router.post('/autopay/verify', verifyAutoPay);
router.post('/autopay/cancel', cancelAutoPay);

export default router;
