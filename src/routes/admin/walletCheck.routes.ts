import { Router } from 'express';
import { getWalletCheck, reverseDuplicateTopup } from '../../controllers/admin/walletCheck.controller';
import { requireSuperAdmin } from '../../middleware/adminAccess';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', getWalletCheck);
router.post('/:transactionId/reverse', requireSuperAdmin, reverseDuplicateTopup);

export default router;
