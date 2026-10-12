import { Router } from 'express';
import {
  register,
  verifyEmail,
  login,
  refresh,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  authMethods,
  requestPhoneLoginOtp,
  verifyPhoneLoginOtp,
} from '../../../controllers/patient/auth.controller';
import {
  codeCheckLimits,
  emailCodeLimits,
  loginLimits,
  refreshLimit,
  resetLimit,
  signupLimit,
  smsCodeLimits,
} from '../../../middleware/rateLimit';

const router = Router();

router.get('/methods', authMethods);
router.post('/register', signupLimit, ...emailCodeLimits, register);
router.post('/verify-email', ...codeCheckLimits('email'), verifyEmail);
router.post('/login', ...loginLimits, login);
router.post('/refresh', refreshLimit, refresh);
router.post('/forgot-password', ...emailCodeLimits, forgotPassword);
router.post('/verify-reset-otp', ...codeCheckLimits('email'), verifyResetOtp);
router.post('/reset-password', resetLimit, resetPassword);
router.post('/phone/request-otp', ...smsCodeLimits, requestPhoneLoginOtp);
router.post('/phone/verify-otp', ...codeCheckLimits('phone'), verifyPhoneLoginOtp);

export default router;
