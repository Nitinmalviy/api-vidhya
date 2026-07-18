import { Router } from 'express';
import { createOrder, getPaymentHistory, verifyPayment } from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// These routes should be protected by authentication
router.post('/create-order', authenticate, createOrder);
router.post('/verify', authenticate, verifyPayment);
router.get('/history', authenticate, getPaymentHistory);

export default router;
