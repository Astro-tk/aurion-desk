import {
  EVENT_MAX_BYTES,
  isBot,
  toStoredEvent,
  websiteEventSchema,
  type StoredWebsiteEvent,
} from '@/integrations/website-events';
import { originAllowed } from '@/integrations/website-form';

/**
 * POST /api/ingest/event: bio-page views and link clicks from aurioncreative.com.
 * Public, so: origin allowlist, 2 KB size limit, per-IP rate limit, Zod validation, bots dropped.
 * Accepts text/plain JSON because navigator.sendBeacon sends that without a CORS preflight.
 * Always answers 204 to a valid-looking request, stored or not, so bots learn nothing.
 */
export interface EventDeps {
  allowedOrigins: readonly string[];
  rateLimit(bucket: string, windowSeconds: number, max: number): Promise<boolean>;
  store(event: StoredWebsiteEvent): Promise<void>;
  ipKey(request: Request): string;
  anonId(request: Request): string;
}

export const EVENT_RATE = { windowSeconds: 60, max: 60 };

function reply(status: number, headers: Record<string, string>, body?: Record<string, unknown>): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'Cache-Control': 'no-store', ...headers },
  });
}

export function eventCors(origin: string | null, allowed: readonly string[]): Record<string, string> {
  if (!originAllowed(origin, allowed)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin!,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export async function handleEventIngest(request: Request, deps: EventDeps): Promise<Response> {
  const origin = request.headers.get('origin');
  const cors = eventCors(origin, deps.allowedOrigins);
  if (request.method !== 'POST') return reply(405, { ...cors, Allow: 'POST, OPTIONS' }, { error: 'method not allowed' });
  if (!originAllowed(origin, deps.allowedOrigins)) return reply(403, cors, { error: 'origin not allowed' });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > EVENT_MAX_BYTES) return reply(413, cors, { error: 'payload too large' });
  const raw = await request.text();
  if (raw.length > EVENT_MAX_BYTES) return reply(413, cors, { error: 'payload too large' });

  const ua = request.headers.get('user-agent');
  // Respect the browser's privacy signals even if a page forgot to.
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return reply(204, cors);
  if (isBot(ua)) return reply(204, cors);

  if (!(await deps.rateLimit(`ingest-event:${deps.ipKey(request)}`, EVENT_RATE.windowSeconds, EVENT_RATE.max))) {
    return reply(429, { ...cors, 'Retry-After': String(EVENT_RATE.windowSeconds) }, { error: 'too many requests' });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(422, cors, { error: 'Body is not JSON.' });
  }
  const parsed = websiteEventSchema.safeParse(body);
  if (!parsed.success) return reply(422, cors, { error: parsed.error.issues[0]?.message ?? 'Invalid event.' });

  await deps.store(toStoredEvent(parsed.data, { anonId: deps.anonId(request), userAgent: ua }));
  return reply(204, cors);
}
