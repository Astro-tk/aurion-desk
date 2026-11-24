// Server to server: aurion-assistant. HMAC-SHA256 signature + timestamp + replay check.
export { chatbotPost as POST } from '@/modules/inbox/routes/ingest';
export const dynamic = 'force-dynamic';
