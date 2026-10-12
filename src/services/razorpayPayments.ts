import { razorpay } from '../config/razorpay';
import { logger } from '../utils/logger';

export type CaptureResult = 'captured' | 'pending' | 'failed';

/**
 * Asks Razorpay (server to server) whether money really arrived for this
 * order, and captures it if it is only authorised.
 *
 * A valid Checkout signature only proves the payment was *authorised*. With
 * auto-capture off, an authorised payment is refunded to the customer after a
 * few days — so crediting on the signature alone would hand out free balance.
 */
export async function ensureCaptured(orderId: string, paymentId: string, expectedPaise: number): Promise<CaptureResult> {
  const p = await razorpay.payments.fetch(paymentId);

  if (p.order_id !== orderId || Number(p.amount) !== expectedPaise || p.currency !== 'INR') {
    logger.error(
      { orderId, paymentId, gotOrder: p.order_id, gotAmount: p.amount, expectedPaise, currency: p.currency },
      'RAZORPAY: payment does not match its order — not fulfilling'
    );
    return 'failed';
  }
  if (p.status === 'captured') return 'captured';
  if (p.status === 'failed' || p.status === 'refunded') return 'failed';
  if (p.status !== 'authorized') return 'pending'; // still "created": the customer hasn't finished paying

  try {
    const captured = await razorpay.payments.capture(paymentId, expectedPaise, 'INR');
    return captured.status === 'captured' ? 'captured' : 'pending';
  } catch (err) {
    // Two paths (verify + webhook) can race to capture; the loser sees "already captured".
    const again = await razorpay.payments.fetch(paymentId);
    if (again.status === 'captured') return 'captured';
    throw err;
  }
}

/** The best payment on an order: captured first, then authorised. */
export async function findPaidPayment(orderId: string): Promise<string | null> {
  const { items } = await razorpay.orders.fetchPayments(orderId);
  const pick = items.find((p) => p.status === 'captured') ?? items.find((p) => p.status === 'authorized');
  return pick ? String(pick.id) : null;
}
