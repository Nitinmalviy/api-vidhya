import { Router } from 'express';
import {
  getDoctorWallet,
  saveBankAccount,
  createWithdrawal,
  listWithdrawals,
  bankAccountSchema,
  withdrawSchema,
} from '../../../controllers/doctor/wallet.controller';
import { authenticate, authorize } from '../../../middleware/auth';
import { isApprovedDoctor } from '../../../middleware/isApprovedDoctor';
import { validate } from '../../../middleware/validate';

const router = Router();

router.use(authenticate, authorize('doctor'));

router.get('/', getDoctorWallet);
router.get('/withdrawals', listWithdrawals);
// Moving money out needs a KYC-approved doctor.
router.put('/bank-account', isApprovedDoctor, validate(bankAccountSchema), saveBankAccount);
router.post('/withdrawals', isApprovedDoctor, validate(withdrawSchema), createWithdrawal);

export default router;
