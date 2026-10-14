import { Router } from 'express';
import { verifyDoctor } from '../../../controllers/admin/verification.controller';
import { authenticate, authorize } from '../../../middleware/auth';

const router = Router();

// Approving or rejecting a doctor is an admin action — this route used to be open to anyone.
router.patch('/:id', authenticate, authorize('admin'), verifyDoctor);

export default router;

