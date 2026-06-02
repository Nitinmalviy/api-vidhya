import { Router } from 'express';
import {
  register,
  verifyEmail,
  login,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
} from '../../../controllers/patient/auth.controller';

const router = Router();

router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/verify-reset-otp', verifyResetOtp);
router.post('/reset-password', resetPassword);

export default router;
