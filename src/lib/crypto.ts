import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacHex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

/** Constant-time comparison of two hex or base64 strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Keyed hash of an email or phone. Used for the suppression list, login throttling and
 * rate limiting, so those tables never hold the address itself.
 */
export function identifierHash(pepper: string, kind: 'email' | 'phone' | 'ip', value: string): string {
  const v = kind === 'email' ? normaliseEmail(value) : value.trim();
  return hmacHex(pepper, `${kind}:${v}`);
}
