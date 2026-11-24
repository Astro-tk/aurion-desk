import 'server-only';
import { z } from 'zod';
import { ForbiddenError } from '@/lib/auth/session';

export type ActionResult<T = unknown> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const IDLE: ActionResult = { ok: true };

interface DbErrorLike {
  code?: string;
  message?: string;
}

/** Plain-language messages for database refusals. */
export function dbErrorMessage(error: DbErrorLike): string {
  switch (error.code) {
    case 'DK001':
      return 'This contact said no. Desk will not log or draft an outbound message to them.';
    case 'DK100':
      return 'That record is permanent and cannot be changed.';
    case 'DK010':
      return error.message ?? 'Run the dry run again before importing.';
    case '23505':
      return 'That already exists in Desk (same email, phone or name).';
    case '23514':
      return 'One of the values is not allowed. Check the fields and try again.';
    case '42501':
      return 'You do not have permission to do that.';
    default:
      return 'Desk could not save that. Try again; if it keeps happening, check the job log in Settings.';
  }
}

export class DbError extends Error {
  constructor(public readonly original: DbErrorLike) {
    super(dbErrorMessage(original));
  }
}

/** Throw on a Supabase error so run() turns it into a friendly message. */
export function check<T>(result: { data: T; error: DbErrorLike | null }): T {
  if (result.error) throw new DbError(result.error);
  return result.data;
}

export function zodFailure(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, error: 'Check the highlighted fields.', fieldErrors };
}

/** Wraps a server action body: permission errors, database errors and surprises become messages. */
export async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    if (err instanceof DbError) {
      if (!['DK001', '23505', '42501'].includes(err.original.code ?? '')) console.error('db error', err.original);
      return { ok: false, error: err.message };
    }
    if (err instanceof z.ZodError) return zodFailure(err);
    // Next.js redirect() and notFound() work by throwing; let them through.
    if (err && typeof err === 'object' && 'digest' in err) throw err;
    console.error('action failed', err);
    return { ok: false, error: 'Something went wrong. Nothing was saved.' };
  }
}

/** FormData to a plain object; empty strings become undefined so optional fields stay optional. */
export function formObject(fd: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    out[k] = t === '' ? undefined : t;
  }
  return out;
}

/** Shared field rules. */
export const fields = {
  optionalText: (max: number) => z.string().max(max, `Keep it under ${max} characters.`).optional(),
  requiredText: (max: number, label: string) => z.string({ error: `${label} is required.` }).min(1, `${label} is required.`).max(max),
  isoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01.'),
  uuid: z.uuid(),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
};
