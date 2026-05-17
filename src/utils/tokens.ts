import crypto from 'crypto';

export function generateRandomToken(bytes = 32): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(bytes).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

