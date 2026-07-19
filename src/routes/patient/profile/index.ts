import { Router } from 'express';
import {
  addRecord,
  changePassword,
  deleteAccount,
  deleteRecord,
  getProfile,
  listRecords,
  subscribe,
  updateProfile,
} from '../../../controllers/patient/profile.controller';
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
router.delete('/', deleteAccount);
router.put('/password', changePassword);
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
