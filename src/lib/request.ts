/** The caller's IP as Vercel reports it. Only ever stored as a keyed hash. */
export function clientIp(headers: Headers): string {
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return '0.0.0.0';
}
