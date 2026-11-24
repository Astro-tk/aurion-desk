import { requireCronSecret } from '@/lib/cron';
import { digestGet } from '@/modules/digest/routes/cron';

// Vercel Cron, 16:00 UTC = 18:00 SAST (vercel.json). Needs "Authorization: Bearer <CRON_SECRET>".
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = requireCronSecret(request, process.env.CRON_SECRET);
  if (denied) return denied;
  return digestGet(request);
}
