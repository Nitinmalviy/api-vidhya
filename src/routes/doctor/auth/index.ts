import { Router } from 'express';
import {
  checkEmail,
  forgotPassword,
  login,
  refresh,
  register,
  resetPassword,
  verifyEmail,
  resendVerification,
} from '../../../controllers/doctor/auth.controller';
import {
  codeCheckLimits,
  emailCodeLimits,
  loginLimits,
  lookupLimit,
  refreshLimit,
  signupLimit,
} from '../../../middleware/rateLimit';

const router = Router();

router.post('/check-email', lookupLimit, checkEmail);
router.post('/register', signupLimit, ...emailCodeLimits, register);
router.post('/login', ...loginLimits, login);
router.post('/refresh', refreshLimit, refresh);
router.post('/verify-email', ...codeCheckLimits('email'), verifyEmail);
router.post('/resend-verification', ...emailCodeLimits, resendVerification);
router.post('/forgot-password', ...emailCodeLimits, forgotPassword);
// Checks the emailed code and sets the password in one step.
router.post('/reset-password', ...codeCheckLimits('email'), resetPassword);

export default router;
