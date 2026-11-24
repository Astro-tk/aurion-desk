import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '@/lib/env';
import type { AIProvider, LeadSummary, LeadSummaryInput } from '../types';

/**
 * AIProvider backed by the Claude API. Phase 1 uses it for one thing only: a two-line lead
 * summary and a suggested next action when an inbox item is accepted. Both are saved as
 * "AI draft" and stay editable. The model comes from AI_MODEL (default claude-haiku-5-5).
 */
const SummarySchema = z.object({
  summary: z.string().describe('Two short lines: who they are and what they want.'),
  next_action: z.string().describe('One concrete next step for Thato, under 15 words.'),
});

const SYSTEM = `You help Thato at Aurion Creative, an engineering-led software studio in South Africa, triage new enquiries.
Offers: Workflow Audit (paid first step, R 3 500), custom builds, the Command Centre (for engineering and construction offices), BeeLevel (records and evidence for enterprise and supplier development teams; it never calculates B-BBEE points or levels), and the Enquiry Desk.
Write in South African English. Plain sentences. No emojis and no em dashes.
The summary is two short lines. The next action is one concrete step, usually inviting them to book a Workflow Audit or answering their question.
Never invent facts that are not in the enquiry. Never quote a custom price or promise a delivery date.`;

function describe(input: LeadSummaryInput): string {
  const lines = [
    `Arrived via: ${input.source === 'form' ? 'website form' : 'website chatbot'}`,
    input.name ? `Name: ${input.name}` : null,
    input.company ? `Company: ${input.company}` : null,
    input.need ? `Need: ${input.need}` : null,
    input.offer ? `Offer the chatbot matched: ${input.offer}` : null,
    input.score !== null ? `Chatbot score: ${input.score} of 5` : null,
    input.scoreReason ? `Score reason: ${input.scoreReason}` : null,
    input.message ? `Their message:\n${input.message}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

// No em or en dashes in Desk copy (house style). Built from char codes so the source has none.
const DASHES = new RegExp(String.fromCharCode(0x2014) + '|' + String.fromCharCode(0x2013), 'g');
const tidy = (s: string) => s.replace(DASHES, ',').replace(/\s+\n/g, '\n').trim();

export class AnthropicProvider implements AIProvider {
  key = 'anthropic';
  private client: Anthropic | null = null;

  isConfigured(): boolean {
    return Boolean(env().ANTHROPIC_API_KEY);
  }

  private sdk(): Anthropic {
    if (!this.client) {
      // A slow model must never hold up an accept: 20 s, one retry.
      this.client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 1 });
    }
    return this.client;
  }

  async summariseLead(input: LeadSummaryInput): Promise<LeadSummary | null> {
    const model = env().AI_MODEL;
    const response = await this.sdk().messages.parse({
      model,
      max_tokens: 1024,
      output_config: { effort: 'low', format: zodOutputFormat(SummarySchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Summarise this enquiry.\n\n${describe(input)}` }],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
    const parsed = response.parsed_output;
    if (!parsed) return null;
    return {
      summary: tidy(parsed.summary).slice(0, 1000),
      nextAction: tidy(parsed.next_action).slice(0, 500),
      model: response.model,
    };
  }
}

export const anthropicProvider = new AnthropicProvider();
