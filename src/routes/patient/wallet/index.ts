import { Router } from 'express';
import {
  getWallet,
  createTopupOrder,
  verifyTopup,
  payAppointmentFromWallet,
  topupOrderSchema,
  verifySchema,
  payAppointmentSchema,
  syncWalletPayments,
} from '../../../controllers/patient/wallet.controller';
import { authenticate, authorize } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { paymentSyncLimit } from '../../../middleware/rateLimit';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', getWallet);
router.post('/topup/order', validate(topupOrderSchema), createTopupOrder);
router.post('/topup/verify', validate(verifySchema), verifyTopup);
router.post('/sync', paymentSyncLimit, syncWalletPayments);
router.post('/pay-appointment', validate(payAppointmentSchema), payAppointmentFromWallet);

export default router;
