/**
 * The integration seams. Phase 1 implements IngestSource (website form, chatbot), Notifier
 * (Resend email, WhatsApp template) and AIProvider (Anthropic). AnalyticsSource is defined now
 * so Phase 2 (uptime) and Phase 3 (YouTube, Instagram, LinkedIn CSV) plug in without changes here.
 */

/** A lead that arrived by itself, already validated and normalised. */
export interface IngestedLead {
  source: 'form' | 'chatbot';
  dedupeKey: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null; // E.164
  message: string | null;
  formId: string | null;
  pageUrl: string | null;
  need: string | null;
  offer: string | null;
  score: number | null; // 1 to 5 from the chatbot
  scoreReason: string | null;
  transcriptId: string | null;
  consentTicked: boolean;
  consentWording: string | null;
  /** The validated body, kept for the record (redacted if the person is forgotten). */
  payload: Record<string, unknown>;
}

export type IngestCheck = { ok: true } | { ok: false; status: number; error: string };

export interface IngestSource {
  key: 'form' | 'chatbot';
  /** Largest body accepted, in bytes. */
  maxBytes: number;
  /** Origin, signature, timestamp: anything that must hold before the body is even parsed. */
  authenticate(request: Request, rawBody: string): Promise<IngestCheck> | IngestCheck;
  /** Zod validation. Returns null for a honeypot hit (accepted silently, never stored). */
  parse(rawBody: string, contentType: string): { ok: true; lead: IngestedLead | null } | { ok: false; error: string };
}

export interface OutboundMessage {
  subject: string;
  text: string;
  html?: string;
  /** Short values for template channels (WhatsApp): who, need, score. */
  templateParams?: string[];
}

export interface Notifier {
  key: 'email' | 'whatsapp' | 'telegram';
  /** False when its environment variables are not set: the caller skips it cleanly. */
  isConfigured(): boolean;
  send(message: OutboundMessage): Promise<{ providerId?: string }>;
}

export interface LeadSummaryInput {
  source: 'form' | 'chatbot';
  name: string | null;
  company: string | null;
  message: string | null;
  need: string | null;
  offer: string | null;
  score: number | null;
  scoreReason: string | null;
}

export interface LeadSummary {
  summary: string; // two short lines
  nextAction: string;
  model: string;
}

export interface AIProvider {
  key: string;
  isConfigured(): boolean;
  /** Returns null when the model declines or the output is unusable. Throws on API errors. */
  summariseLead(input: LeadSummaryInput): Promise<LeadSummary | null>;
}

/** Phase 2 and 3: pulls numbers from outside services into desk.events. */
export interface MetricPoint {
  occurredAt: string; // ISO timestamp
  subjectType: string; // e.g. "youtube_video", "instagram_post", "monitor"
  subjectId: string;
  metric: string; // e.g. "views", "likes", "uptime_ratio"
  value: number;
}
export interface AnalyticsSource {
  key: string; // "youtube", "instagram", "linkedin_csv", "uptimerobot"
  isConfigured(): boolean;
  fetchMetrics(range: { from: string; to: string }): Promise<MetricPoint[]>;
}
