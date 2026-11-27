import { dailyVisitorCode } from '@/integrations/website-events';
import { identifierHash } from '@/lib/crypto';
import { serviceDb } from '@/lib/db/service';
import { env } from '@/lib/env';
import { todaySast } from '@/lib/format';
import { clientIp } from '@/lib/request';
import { eventCors, handleEventIngest } from '../event-handler';

export function eventOptions(request: Request): Response {
  const headers = eventCors(request.headers.get('origin'), env().INGEST_ALLOWED_ORIGINS);
  return new Response(null, { status: headers['Access-Control-Allow-Origin'] ? 204 : 403, headers });
}

export async function eventPost(request: Request): Promise<Response> {
  const e = env();
  const db = serviceDb('ingest', 'system');
  try {
    return await handleEventIngest(request, {
      allowedOrigins: e.INGEST_ALLOWED_ORIGINS,
      ipKey: (req) => identifierHash(e.HASH_PEPPER, 'ip', clientIp(req.headers)).slice(0, 32),
      anonId: (req) => dailyVisitorCode(e.HASH_PEPPER, todaySast(), clientIp(req.headers), req.headers.get('user-agent') ?? ''),
      async rateLimit(bucket, windowSeconds, max) {
        const { data, error } = await db.rpc('rate_limit_take', { p_bucket: bucket, p_window_seconds: windowSeconds, p_max: max });
        return error ? true : data === true;
      },
      async store(ev) {
        const { error } = await db.from('events').insert({ source: 'website', ...ev });
        if (error) console.error('website event insert failed', error.message);
      },
    });
  } catch (err) {
    console.error('event ingest error', err);
    // Analytics must never break the page: report success, log the problem.
    return new Response(null, { status: 204, headers: eventCors(request.headers.get('origin'), e.INGEST_ALLOWED_ORIGINS) });
  }
}
