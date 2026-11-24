import { requireCronSecret } from '@/lib/cron';
import { housekeepingGet } from '@/modules/digest/routes/cron';

// Vercel Cron, 01:30 UTC = 03:30 SAST (vercel.json). Needs "Authorization: Bearer <CRON_SECRET>".
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = requireCronSecret(request, process.env.CRON_SECRET);
  if (denied) return denied;
  return housekeepingGet(request);
}
