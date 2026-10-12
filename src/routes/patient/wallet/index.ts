import { Router } from 'express';
import {
  getWallet,
  createTopupOrder,
  verifyTopup,
  payAppointmentFromWallet,
  topupOrderSchema,
  verifySchema,
  payAppointmentSchema,
} from '../../../controllers/patient/wallet.controller';
import { authenticate, authorize } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', getWallet);
router.post('/topup/order', validate(topupOrderSchema), createTopupOrder);
router.post('/topup/verify', validate(verifySchema), verifyTopup);
router.post('/pay-appointment', validate(payAppointmentSchema), payAppointmentFromWallet);

export default router;
