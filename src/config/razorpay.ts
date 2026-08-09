import Razorpay from 'razorpay';
import { env } from './env';

/**
 * Single Razorpay client for the whole API. Keys come from either the newer
 * RAZORPAY_* names or the older Test_Key_* ones already in .env.
 */
export const RAZORPAY_KEY_ID = env.RAZORPAY_KEY_ID ?? env.Test_Key_ID ?? '';
export const RAZORPAY_KEY_SECRET = env.RAZORPAY_KEY_SECRET ?? env.Test_Key_Secret ?? '';

export const isRazorpayConfigured = (): boolean => !!RAZORPAY_KEY_ID && !!RAZORPAY_KEY_SECRET;

export const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID || 'rzp_test_mock_key',
  key_secret: RAZORPAY_KEY_SECRET || 'rzp_test_mock_secret',
});

/** One subscription cycle. Kept in sync with the plan definitions. */
export const PLAN_DURATION_DAYS = 30;

export const AUTOPAY_PLAN_IDS: Record<'single' | 'family', string | undefined> = {
  single: env.RAZORPAY_PLAN_SINGLE,
  family: env.RAZORPAY_PLAN_FAMILY,
};

/**
 * Monthly price per plan, in rupees. Only used to describe the mandate and to
 * record transactions — the amount Razorpay actually debits comes from the
 * Razorpay plan itself.
 */
export const PLAN_PRICES: Record<'single' | 'family', number> = { single: 149, family: 349 };

export const PLAN_NAMES: Record<'single' | 'family', string> = { single: 'Single', family: 'Family' };

/**
 * How many cycles a mandate is authorised for. UPI Autopay mandates need a
 * finite count; ~10 years of monthly debits, after which the user re-authorises.
 */
export const AUTOPAY_TOTAL_CYCLES = 120;
