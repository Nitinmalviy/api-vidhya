import { Router } from 'express';
import {
  forgotPassword,
  login,
  refresh,
  register,
  resetPassword,
  verifyEmail,
  resendVerification,
} from '../../../controllers/doctor/auth.controller';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;

