import { env } from '../config/env';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from '../config/razorpay';
import { ServiceUnavailableError, BadRequestError } from '../utils/AppError';
import { logger } from '../utils/logger';

/**
 * Minimal RazorpayX client for doctor withdrawals. The `razorpay` npm SDK does
 * not cover Payouts, so this talks to the REST API directly.
 *
 * Needs RAZORPAYX_ACCOUNT_NUMBER (the RazorpayX business account money is paid
 * out from) plus the normal Razorpay key id/secret.
 * Docs: https://razorpay.com/docs/api/x/payouts/
 */

const BASE = 'https://api.razorpay.com/v1';

export const isPayoutsConfigured = (): boolean =>
  !!env.RAZORPAYX_ACCOUNT_NUMBER && !!RAZORPAY_KEY_ID && !!RAZORPAY_KEY_SECRET;

function assertConfigured(): void {
  if (!isPayoutsConfigured()) {
    throw new ServiceUnavailableError('Bank withdrawals are not enabled yet. Please contact support.');
  }
}

export class RazorpayXError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly description?: string
  ) {
    super(message);
  }
}

async function call<T>(path: string, body: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['X-Payout-Idempotency'] = idempotencyKey;

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
  if (!res.ok) {
    const description = json?.error?.description;
    logger.warn({ path, status: res.status, description }, 'RazorpayX request failed');
    throw new RazorpayXError(`RazorpayX ${path} failed (${res.status})`, res.status, description);
  }
  return json;
}

/** Creates the contact + bank fund account RazorpayX pays into. */
export async function createBankFundAccount(params: {
  doctorId: string;
  name: string;
  email: string;
  phone: string;
  holderName: string;
  ifsc: string;
  accountNumber: string;
}): Promise<{ contactId: string; fundAccountId: string }> {
  assertConfigured();
  const contact = await call<{ id: string }>('/contacts', {
    name: params.name,
    email: params.email,
    contact: params.phone,
    type: 'vendor',
    reference_id: `doctor_${params.doctorId}`,
  });
  try {
    const fa = await call<{ id: string }>('/fund_accounts', {
      contact_id: contact.id,
      account_type: 'bank_account',
      bank_account: { name: params.holderName, ifsc: params.ifsc, account_number: params.accountNumber },
    });
    return { contactId: contact.id, fundAccountId: fa.id };
  } catch (err) {
    if (err instanceof RazorpayXError && err.status === 400) {
      throw new BadRequestError(err.description ?? 'Bank details were rejected. Please check them.');
    }
    throw err;
  }
}

export interface RazorpayXPayout {
  id: string;
  status: string; // queued | pending | processing | processed | reversed | cancelled | rejected | failed
  utr?: string | null;
  failure_reason?: string | null;
}

/** Starts a payout. `withdrawalId` doubles as the idempotency key, so a retry never pays twice. */
export function createPayout(params: {
  withdrawalId: string;
  fundAccountId: string;
  amount: number; // paise
  mode: 'IMPS' | 'NEFT';
}): Promise<RazorpayXPayout> {
  assertConfigured();
  return call<RazorpayXPayout>(
    '/payouts',
    {
      account_number: env.RAZORPAYX_ACCOUNT_NUMBER,
      fund_account_id: params.fundAccountId,
      amount: params.amount,
      currency: 'INR',
      mode: params.mode,
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: params.withdrawalId,
      narration: 'VidhyaCare earnings',
    },
    params.withdrawalId
  );
}
