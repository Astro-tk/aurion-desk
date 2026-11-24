// Public: website forms. Protected by origin allowlist, honeypot, rate limit, size limit and Zod.
export { formOptions as OPTIONS, formPost as POST } from '@/modules/inbox/routes/ingest';
export const dynamic = 'force-dynamic';
