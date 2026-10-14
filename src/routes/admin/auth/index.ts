import { Router } from 'express';
import { login, register, resendVerification, verifyEmail } from '../../../controllers/admin/auth.controller';
import { authenticate, authorize } from '../../../middleware/auth';
import { codeCheckLimits, emailCodeLimits, loginLimits } from '../../../middleware/rateLimit';

const router = Router();

// Only a signed-in super admin can create admins. The first one comes from `npm run seed:admin`.
router.post('/register', authenticate, authorize('admin'), register);
router.post('/login', ...loginLimits, login);
router.post('/verify-email', ...codeCheckLimits('email'), verifyEmail);
router.post('/resend-verification', ...emailCodeLimits, resendVerification);

export default router;
