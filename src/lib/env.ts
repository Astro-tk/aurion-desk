import 'server-only';
import { z } from 'zod';

/**
 * Server environment, validated once. Every variable is documented in .env.example.
 * Nothing here is ever sent to the browser: Desk has no NEXT_PUBLIC_ variables at all.
 */
const csv = (fallback = '') =>
  z
    .string()
    .default(fallback)
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    );

const schema = z.object({
  APP_URL: z.url().default('https://desk.aurioncreative.com'),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  OWNER_EMAILS: csv().transform((list) => list.map((e) => e.toLowerCase())),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  HASH_PEPPER: z.string().min(32, 'HASH_PEPPER must be at least 32 characters'),
  INGEST_SIGNING_SECRET: z.string().min(32, 'INGEST_SIGNING_SECRET must be at least 32 characters'),
  INGEST_ALLOWED_ORIGINS: csv('https://aurioncreative.com,https://www.aurioncreative.com'),
  CRON_SECRET: z.string().min(16),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Aurion Desk <desk@aurioncreative.com>'),
  ALERT_EMAIL_TO: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-haiku-5-5'),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ALERT_NUMBER: z.string().optional(),
  WHATSAPP_ALERT_TEMPLATE: z.string().default('new_lead_alert'),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('en'),
  WHATSAPP_GRAPH_VERSION: z.string().default('v23.0'),
  DEMO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Aurion Desk is missing or has invalid environment variables: ${problems}`);
  }
  if (parsed.data.OWNER_EMAILS.length === 0) {
    throw new Error('OWNER_EMAILS is empty, so nobody could sign in.');
  }
  cached = parsed.data;
  return cached;
}

/** For tests only. */
export function resetEnvCache(): void {
  cached = null;
}
