import type { IngestedLead, IngestSource } from '@/integrations/types';
import { sha256Hex } from '@/lib/crypto';

/**
 * The shared ingest pipeline, independent of Next and Supabase so it can be tested directly:
 *   size limit -> authenticate (origin or signature) -> replay check -> rate limit ->
 *   parse + validate -> store -> schedule alerts.
 */
export interface IngestDeps {
  /** true if allowed */
  rateLimit(bucket: string, windowSeconds: number, max: number): Promise<boolean>;
  /** true the first time a signature hash is seen (chatbot replay protection) */
  claimNonce(signatureHash: string): Promise<boolean>;
  isSuppressed(email: string | null, phone: string | null): Promise<boolean>;
  store(lead: IngestedLead, suppressed: boolean): Promise<{ inboxItemId: string; duplicate: boolean; suppressed: boolean }>;
  /** Runs after the response is sent (alerts). */
  afterStore(lead: IngestedLead, stored: { inboxItemId: string; duplicate: boolean; suppressed: boolean }): void;
  ipKey(request: Request): string;
  extraHeaders?: Record<string, string>;
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

async function readLimited(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export const RATE_LIMITS = {
  form: [
    { windowSeconds: 60, max: 5 },
    { windowSeconds: 86_400, max: 40 },
  ],
  chatbot: [{ windowSeconds: 60, max: 120 }],
} as const;

export async function handleIngest(request: Request, source: IngestSource, deps: IngestDeps): Promise<Response> {
  const h = deps.extraHeaders ?? {};
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, { ...h, Allow: 'POST, OPTIONS' });

  const raw = await readLimited(request, source.maxBytes);
  if (raw === null) return json(413, { error: 'payload too large' }, h);

  const auth = await source.authenticate(request, raw);
  if (!auth.ok) return json(auth.status, { error: auth.error }, h);

  if (source.key === 'chatbot') {
    const sig = request.headers.get('x-aurion-signature') ?? '';
    if (!(await deps.claimNonce(sha256Hex(sig)))) return json(409, { error: 'replayed request' }, h);
  }

  const ip = deps.ipKey(request);
  for (const rule of RATE_LIMITS[source.key]) {
    if (!(await deps.rateLimit(`ingest-${source.key}:${ip}:${rule.windowSeconds}`, rule.windowSeconds, rule.max))) {
      return json(429, { error: 'too many requests' }, { ...h, 'Retry-After': String(rule.windowSeconds) });
    }
  }

  const parsed = source.parse(raw, (request.headers.get('content-type') ?? '').toLowerCase());
  if (!parsed.ok) return json(422, { error: parsed.error }, h);
  // Honeypot: look successful, store nothing.
  if (parsed.lead === null) return json(202, { ok: true }, h);

  const lead = parsed.lead;
  const suppressed = await deps.isSuppressed(lead.email, lead.phone);
  const stored = await deps.store(lead, suppressed);
  if (!stored.duplicate) deps.afterStore(lead, stored);
  return json(stored.duplicate ? 200 : 202, { ok: true, id: stored.inboxItemId, duplicate: stored.duplicate }, h);
}
