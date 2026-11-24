import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 14;

const COMMON = new Set([
  'passwordpassword',
  'password123456',
  '12345678901234',
  'qwertyuiopasdf',
  'aurioncreative1',
  'aurioncreative2026',
  'iloveyouiloveyou',
]);

/** Rules for SETTING a password (seed script and Settings). Sign-in does not reveal these. */
export function passwordSchema(email?: string) {
  return z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters. A short sentence works well.`)
    .max(128, 'Use 128 characters or fewer.')
    .refine((p) => !COMMON.has(p.toLowerCase()), 'That password is too common.')
    .refine((p) => new Set(p).size >= 6, 'Use more varied characters.')
    .refine((p) => !email || !p.toLowerCase().includes(email.split('@')[0]!.toLowerCase()), 'Do not include your email name.');
}
