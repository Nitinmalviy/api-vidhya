import { Router } from 'express';
import { login, register, resendVerification, verifyEmail } from '../../../controllers/admin/auth.controller';
import { codeCheckLimits, emailCodeLimits, loginLimits, signupLimit } from '../../../middleware/rateLimit';

const router = Router();

router.post('/register', signupLimit, register);
router.post('/login', ...loginLimits, login);
router.post('/verify-email', ...codeCheckLimits('email'), verifyEmail);
router.post('/resend-verification', ...emailCodeLimits, resendVerification);

export default router;
