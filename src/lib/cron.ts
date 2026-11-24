import { safeEqual } from '@/lib/crypto';

/**
 * Every /api/cron/* route calls this first. Vercel Cron sends
 * "Authorization: Bearer <CRON_SECRET>" automatically when CRON_SECRET is set in the project.
 */
export function requireCronSecret(request: Request, secret: string | undefined): Response | null {
  const header = request.headers.get('authorization') ?? '';
  if (!secret || secret.length < 16 || !safeEqual(header, `Bearer ${secret}`)) {
    return new Response(JSON.stringify({ error: 'unauthorised' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
}
