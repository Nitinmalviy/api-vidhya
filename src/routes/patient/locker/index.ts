import { Router } from 'express';
import {
  addLockerMember,
  addLockerRecord,
  deleteLockerMember,
  deleteLockerRecord,
  getLockerOverview,
  listLockerRecords,
  updateLockerMember,
} from '../../../controllers/patient/locker.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('user'));

router.get('/', getLockerOverview);

router.post('/members', addLockerMember);
router.put('/members/:id', updateLockerMember);
router.delete('/members/:id', deleteLockerMember);

router.get('/records', listLockerRecords);
router.post('/records', addLockerRecord);
router.delete('/records/:id', deleteLockerRecord);

export default router;
