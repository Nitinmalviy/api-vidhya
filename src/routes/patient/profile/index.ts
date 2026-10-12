import { Router } from 'express';
import {
  addRecord,
  cancelAccountDeletion,
  changePassword,
  deleteAccount,
  deleteRecord,
  getProfile,
  listRecords,
  subscribe,
  updateProfile,
  sendPhoneVerifyOtp,
  verifyPhone,
} from '../../../controllers/patient/profile.controller';
import { signedInSecretLimit, signedInSmsLimits } from '../../../middleware/rateLimit';
import {
  listAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from '../../../controllers/patient/addresses.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', getProfile);
router.put('/', updateProfile);
router.delete('/', signedInSecretLimit, deleteAccount);
router.post('/cancel-deletion', cancelAccountDeletion);
router.put('/password', signedInSecretLimit, changePassword);
router.post('/phone/send-otp', ...signedInSmsLimits, sendPhoneVerifyOtp);
router.post('/phone/verify', signedInSecretLimit, verifyPhone);
router.post('/subscribe', subscribe);

router.get('/records', listRecords);
router.post('/records', addRecord);
router.delete('/records/:id', deleteRecord);

router.get('/addresses', listAddresses);
router.post('/addresses', addAddress);
router.put('/addresses/:id', updateAddress);
router.delete('/addresses/:id', deleteAddress);
router.patch('/addresses/:id/default', setDefaultAddress);

export default router;
