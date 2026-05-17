import { Router } from 'express';
import { login, register, resendVerification, verifyEmail } from '../../../controllers/admin/auth.controller';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);

export default router;

