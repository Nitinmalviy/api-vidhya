import { Router } from 'express';
import {
  forgotPassword,
  login,
  register,
  resetPassword,
  verifyEmail,
} from '../../../controllers/doctor/auth.controller';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;

