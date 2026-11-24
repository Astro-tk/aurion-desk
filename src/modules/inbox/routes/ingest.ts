import { after } from 'next/server';
import { createChatbotSource } from '@/integrations/chatbot';
import { resendNotifier } from '@/integrations/resend';
import type { IngestSource } from '@/integrations/types';
import { createFormSource, corsHeaders } from '@/integrations/website-form';
import { whatsappNotifier } from '@/integrations/whatsapp';
import { isSuppressed } from '@/lib/consent';
import { identifierHash } from '@/lib/crypto';
import { serviceDb } from '@/lib/db/service';
import { env } from '@/lib/env';
import { recordEvent } from '@/lib/events';
import { serviceNotificationStore } from '@/lib/notification-store';
import { clientIp } from '@/lib/request';
import { DEFAULT_ALERT_THRESHOLD, sendLeadAlerts } from '../alerts';
import { handleIngest, type IngestDeps } from '../ingest-handler';

function deps(source: IngestSource, extraHeaders: Record<string, string> = {}): IngestDeps {
  const db = serviceDb('ingest', source.key);
  const e = env();
  return {
    extraHeaders,
    ipKey: (req) => identifierHash(e.HASH_PEPPER, 'ip', clientIp(req.headers)).slice(0, 32),
    async rateLimit(bucket, windowSeconds, max) {
      const { data, error } = await db.rpc('rate_limit_take', { p_bucket: bucket, p_window_seconds: windowSeconds, p_max: max });
      if (error) {
        console.error('rate_limit_take failed', error.message);
        return true; // never lose a lead because the limiter hiccupped
      }
      return data === true;
    },
    async claimNonce(signatureHash) {
      const { error } = await db.from('ingest_nonces').insert({ signature_hash: signatureHash });
      return !error; // unique violation = seen before
    },
    isSuppressed,
    async store(lead, suppressed) {
      const { data, error } = await db.rpc('ingest_lead', {
        p: {
          source: lead.source,
          dedupe_key: lead.dedupeKey,
          name: lead.name,
          company: lead.company,
          email: lead.email,
          phone: lead.phone,
          message: lead.message,
          form_id: lead.formId,
          page_url: lead.pageUrl,
          need: lead.need,
          offer: lead.offer,
          score: lead.score,
          score_reason: lead.scoreReason,
          transcript_id: lead.transcriptId,
          consent_ticked: lead.consentTicked,
          consent_wording: lead.consentWording,
          suppressed,
          payload: lead.payload,
        },
      });
      if (error) throw new Error(`ingest_lead failed: ${error.message}`);
      const r = data as { inbox_item_id: string; duplicate: boolean; suppressed?: boolean };
      return { inboxItemId: r.inbox_item_id, duplicate: r.duplicate, suppressed: Boolean(r.suppressed) };
    },
    afterStore(lead, stored) {
      after(async () => {
        try {
          const { data } = await db.from('app_settings').select('value').eq('key', 'alert_score_threshold').maybeSingle();
          const threshold = Number(data?.value ?? DEFAULT_ALERT_THRESHOLD);
          const results = await sendLeadAlerts({
            lead,
            inboxItemId: stored.inboxItemId,
            threshold,
            notifiers: [resendNotifier, whatsappNotifier],
            store: serviceNotificationStore(),
            appUrl: e.APP_URL,
          });
          if (Object.values(results).includes('sent')) {
            await recordEvent(db, { type: 'alert_sent', source: 'system', subjectType: 'inbox_item', subjectId: stored.inboxItemId, payload: results });
          }
        } catch (err) {
          console.error('lead alert failed', err);
        }
      });
    },
  };
}

function errorResponse(err: unknown, headers: Record<string, string> = {}) {
  console.error('ingest error', err);
  return new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '30', ...headers },
  });
}

// ---------------------------------------------------------------- /api/ingest/form

export function formOptions(request: Request): Response {
  const headers = corsHeaders(request.headers.get('origin'), env().INGEST_ALLOWED_ORIGINS);
  if (!headers['Access-Control-Allow-Origin']) return new Response(null, { status: 403, headers });
  return new Response(null, { status: 204, headers });
}

export async function formPost(request: Request): Promise<Response> {
  const cors = corsHeaders(request.headers.get('origin'), env().INGEST_ALLOWED_ORIGINS);
  try {
    const source = createFormSource({ allowedOrigins: env().INGEST_ALLOWED_ORIGINS });
    return await handleIngest(request, source, deps(source, cors));
  } catch (err) {
    return errorResponse(err, cors);
  }
}

// ---------------------------------------------------------------- /api/ingest/chatbot

export async function chatbotPost(request: Request): Promise<Response> {
  try {
    const source = createChatbotSource({ secret: env().INGEST_SIGNING_SECRET });
    return await handleIngest(request, source, deps(source));
  } catch (err) {
    return errorResponse(err);
  }
}
