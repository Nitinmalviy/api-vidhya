import type { Request } from 'express';
import { rateLimit, ipKeyGenerator, type Options, type Store, type IncrementResponse } from 'express-rate-limit';
import { RateLimitHit } from '../models/RateLimitHit';
import { RateLimitError } from '../utils/RateLimitError';
import { logger } from '../utils/logger';
import type { AuthRequest } from '../types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Fixed-window counter in MongoDB, shared by every server instance. */
class MongoStore implements Store {
  windowMs = 15 * MINUTE;
  constructor(public prefix: string) {}

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const id = `${this.prefix}:${key}`;
    const now = new Date();
    const fresh = new Date(now.getTime() + this.windowMs);
    const live = { $gt: ['$resetAt', now] };
    const run = () =>
      RateLimitHit.findOneAndUpdate(
        { _id: id },
        // Pipeline update: keep counting inside the window, start over once it has passed.
        [
          {
            $set: {
              hits: { $cond: [live, { $add: ['$hits', 1] }, 1] },
              resetAt: { $cond: [live, '$resetAt', fresh] },
            },
          },
        ],
        { upsert: true, new: true, lean: true }
      );
    let doc;
    try {
      doc = await run();
    } catch (err) {
      // Two first-hits racing on the same upsert: one wins, the other retries as an update.
      if ((err as { code?: number }).code !== 11000) throw err;
      doc = await run();
    }
    return { totalHits: doc!.hits, resetTime: doc!.resetAt };
  }

  async decrement(key: string) {
    await RateLimitHit.updateOne({ _id: `${this.prefix}:${key}`, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key: string) {
    await RateLimitHit.deleteOne({ _id: `${this.prefix}:${key}` });
  }
}

type LimitBy = 'ip' | 'user' | { body: string };

function keyFor(by: LimitBy, req: Request): string | null {
  if (by === 'ip') return ipKeyGenerator(req.ip ?? 'unknown');
  if (by === 'user') return (req as AuthRequest).user?.id ?? null;
  const raw = (req.body ?? {})[by.body];
  if (raw === undefined || raw === null || raw === '') return null;
  // Normalise so "A@x.com " and "a@x.com" or "+91 98…" and "98…" share a bucket.
  const value = String(raw).trim().toLowerCase();
  const digits = value.replace(/\D/g, '');
  return by.body === 'phone' || by.body === 'mobile' ? digits.slice(-10) : value;
}

function limiter(
  name: string,
  opts: { by: LimitBy; max: number; windowMs: number; failuresOnly?: boolean; message: string }
) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new MongoStore(`rl:${name}`),
    // If MongoDB is briefly unreachable, let the request through rather than lock everyone out.
    passOnStoreError: true,
    skipSuccessfulRequests: !!opts.failuresOnly,
    // No identifier in the body: nothing to key on; the IP limiter still applies.
    skip: (req) => keyFor(opts.by, req) === null,
    keyGenerator: (req) => keyFor(opts.by, req) ?? 'none',
    handler: (_req, res, next) => {
      logger.warn({ limiter: name }, 'Rate limit hit');
      res.setHeader('Retry-After', Math.ceil(opts.windowMs / 1000));
      next(new RateLimitError(opts.message));
    },
  });
}

const TRY_LATER = 'Too many attempts. Please wait a few minutes and try again.';
const CODE_LATER = 'Too many codes requested. Please wait a while before asking for another.';

/** Sign-in: per IP for spraying, per account (failed tries only) for guessing one password. */
export const loginLimits = [
  limiter('login-ip', { by: 'ip', max: 30, windowMs: 15 * MINUTE, message: TRY_LATER }),
  limiter('login-acct', { by: { body: 'email' }, max: 8, windowMs: 15 * MINUTE, failuresOnly: true, message: TRY_LATER }),
];

/** Anything that emails a code (signup, resend, forgot password). Stops inbox flooding. */
export const emailCodeLimits = [
  limiter('email-code-ip', { by: 'ip', max: 15, windowMs: HOUR, message: CODE_LATER }),
  limiter('email-code-target', { by: { body: 'email' }, max: 4, windowMs: 15 * MINUTE, message: CODE_LATER }),
];

/** Anything that texts a code. SMS costs money, so the caps are tighter. */
export const smsCodeLimits = [
  limiter('sms-code-ip', { by: 'ip', max: 10, windowMs: HOUR, message: CODE_LATER }),
  limiter('sms-code-target', { by: { body: 'phone' }, max: 3, windowMs: 15 * MINUTE, message: CODE_LATER }),
  limiter('sms-code-day', { by: { body: 'phone' }, max: 10, windowMs: 24 * HOUR, message: CODE_LATER }),
];

/**
 * Checking a 6-digit code: a million possibilities, so a handful of wrong
 * guesses per address is the real protection. Successful checks don't count.
 */
export const codeCheckLimits = (field: 'email' | 'phone') => [
  limiter('code-check-ip', { by: 'ip', max: 40, windowMs: 15 * MINUTE, failuresOnly: true, message: TRY_LATER }),
  limiter(`code-check-${field}`, { by: { body: field }, max: 6, windowMs: 15 * MINUTE, failuresOnly: true, message: TRY_LATER }),
];

/** Password reset with a token, account sign-up, email-exists checks, token refresh. */
export const resetLimit = limiter('reset-ip', { by: 'ip', max: 10, windowMs: 15 * MINUTE, message: TRY_LATER });
export const signupLimit = limiter('signup-ip', { by: 'ip', max: 10, windowMs: HOUR, message: TRY_LATER });
export const lookupLimit = limiter('lookup-ip', { by: 'ip', max: 30, windowMs: 15 * MINUTE, message: TRY_LATER });
export const refreshLimit = limiter('refresh-ip', { by: 'ip', max: 120, windowMs: 15 * MINUTE, message: TRY_LATER });

/** Signed-in actions that check the current password or a code (run after `authenticate`). */
export const signedInSecretLimit = limiter('signed-in-secret', {
  by: 'user',
  max: 6,
  windowMs: 15 * MINUTE,
  failuresOnly: true,
  message: TRY_LATER,
});

/** Signed-in requests that text a code to a new number. */
export const signedInSmsLimits = [
  limiter('signed-in-sms', { by: 'user', max: 5, windowMs: HOUR, message: CODE_LATER }),
  limiter('sms-code-day', { by: { body: 'phone' }, max: 10, windowMs: 24 * HOUR, message: CODE_LATER }),
];
