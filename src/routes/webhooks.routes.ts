import { Router } from 'express';
import { handleRazorpayWebhook } from '../controllers/webhooks/razorpay.controller';

const router = Router();

/**
 * Unauthenticated by design — Razorpay can't send a JWT. Trust comes from the
 * HMAC signature over the raw body, verified inside the handler. The raw body
 * parser is mounted for this path in app.ts, before express.json().
 */
router.post('/razorpay', handleRazorpayWebhook);

export default router;
