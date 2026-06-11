import { Router } from 'express';
import {
  addRecord,
  changePassword,
  deleteAccount,
  deleteRecord,
  getProfile,
  listRecords,
  updateProfile,
} from '../../../controllers/patient/profile.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', getProfile);
router.put('/', updateProfile);
router.delete('/', deleteAccount);
router.put('/password', changePassword);

router.get('/records', listRecords);
router.post('/records', addRecord);
router.delete('/records/:id', deleteRecord);

export default router;
