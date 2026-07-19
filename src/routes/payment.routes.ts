import { Router } from 'express';
import {
  createOrder,
  getPaymentHistory,
  verifyPayment,
  downloadSubscriptionReceipt,
  emailSubscriptionReceipt,
} from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// These routes should be protected by authentication
router.post('/create-order', authenticate, createOrder);
router.post('/verify', authenticate, verifyPayment);
router.get('/history', authenticate, getPaymentHistory);
router.get('/transactions/:id/receipt', authenticate, downloadSubscriptionReceipt);
router.post('/transactions/:id/receipt/email', authenticate, emailSubscriptionReceipt);

export default router;
