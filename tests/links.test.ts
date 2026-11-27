import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { dailyVisitorCode, sourceOf, type StoredWebsiteEvent } from '@/integrations/website-events';
import { handleEventIngest, type EventDeps } from '@/modules/links/event-handler';
import { asRole, createTestDb, ownerClaims, seedMembers, SERVICE, viewerClaims } from './helpers/db';

const SITE = 'https://aurioncreative.com';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0';

function deps(over: Partial<EventDeps> = {}) {
  const stored: StoredWebsiteEvent[] = [];
  const d: EventDeps = {
    allowedOrigins: [SITE, 'https://www.aurioncreative.com'],
    rateLimit: async () => true,
    store: async (e) => void stored.push(e),
    ipKey: () => 'ip',
    anonId: () => 'visitor-code-1',
    ...over,
  };
  return { d, stored };
}

const beacon = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://desk.aurioncreative.com/api/ingest/event', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8', origin: SITE, 'user-agent': PHONE_UA, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/ingest/event (bio links)', () => {
  it('records a page view with its source and device, and no personal data', async () => {
    const { d, stored } = deps();
    const res = await handleEventIngest(beacon({ t: 'view', page: 'bio', via: 'ig', ref: 'https://l.instagram.com/?u=https%3A%2F%2Faurioncreative.com%2Flinks&e=secret' }), d);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(stored).toEqual([
      { type: 'link_page_view', subject_type: 'link_page', subject_id: 'bio', anon_id: 'visitor-code-1', payload: { page: 'bio', via: 'instagram', ref_host: 'l.instagram.com', device: 'mobile' } },
    ]);
    // Only the referrer host is kept, never its query string.
    expect(JSON.stringify(stored)).not.toContain('secret');
  });

  it('records a click with the link key and label', async () => {
    const { d, stored } = deps();
    await handleEventIngest(beacon({ t: 'click', link: 'audit', label: 'Book a Workflow Audit', via: 'li' }), d);
    expect(stored[0]).toMatchObject({ type: 'link_click', subject_id: 'audit', payload: { via: 'linkedin', label: 'Book a Workflow Audit' } });
  });

  it('refuses other origins and missing origins', async () => {
    const { d, stored } = deps();
    expect((await handleEventIngest(beacon({ t: 'view' }, { origin: 'https://evil.example' }), d)).status).toBe(403);
    expect((await handleEventIngest(beacon({ t: 'view' }, { origin: '' }), d)).status).toBe(403);
    expect(stored).toHaveLength(0);
  });

  it('honours Do Not Track and Global Privacy Control, and drops bots, without saying so', async () => {
    const { d, stored } = deps();
    expect((await handleEventIngest(beacon({ t: 'view' }, { dnt: '1' }), d)).status).toBe(204);
    expect((await handleEventIngest(beacon({ t: 'view' }, { 'sec-gpc': '1' }), d)).status).toBe(204);
    expect((await handleEventIngest(beacon({ t: 'view' }, { 'user-agent': 'facebookexternalhit/1.1' }), d)).status).toBe(204);
    expect((await handleEventIngest(beacon({ t: 'view' }, { 'user-agent': '' }), d)).status).toBe(204);
    expect(stored).toHaveLength(0);
  });

  it('validates: size, JSON, event shape, link key characters', async () => {
    const { d, stored } = deps();
    expect((await handleEventIngest(beacon({ t: 'view', label: 'x'.repeat(3000) }), d)).status).toBe(413);
    expect((await handleEventIngest(beacon('not json'), d)).status).toBe(422);
    expect((await handleEventIngest(beacon({ t: 'purchase' }), d)).status).toBe(422);
    expect((await handleEventIngest(beacon({ t: 'click' }), d)).status).toBe(422);
    expect((await handleEventIngest(beacon({ t: 'click', link: '<script>' }), d)).status).toBe(422);
    expect(stored).toHaveLength(0);
  });

  it('rate limits per IP', async () => {
    const { d } = deps({ rateLimit: async () => false });
    expect((await handleEventIngest(beacon({ t: 'view' }), d)).status).toBe(429);
  });
});

describe('sources and visitor codes', () => {
  it('reads ?via= first, then the referrer', () => {
    expect(sourceOf('IG', null)).toBe('instagram');
    expect(sourceOf(undefined, 'lnkd.in')).toBe('linkedin');
    expect(sourceOf(undefined, 'm.facebook.com')).toBe('facebook');
    expect(sourceOf(undefined, 't.co')).toBe('x');
    expect(sourceOf(undefined, null)).toBe('direct');
    expect(sourceOf('newsletter', null)).toBe('newsletter');
    expect(sourceOf('<bad>', null)).toBe('other');
  });

  it('the visitor code changes every day and never contains the IP', () => {
    const a = dailyVisitorCode('p'.repeat(40), '2026-12-01', '102.65.1.2', PHONE_UA);
    const b = dailyVisitorCode('p'.repeat(40), '2026-12-02', '102.65.1.2', PHONE_UA);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain('102');
  });
});

describe('desk.link_stats', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
    await seedMembers(db);
    const ev = (type: string, subject: string, anon: string, via: string, at: string, label?: string) =>
      asRole(
        db,
        SERVICE,
        `insert into desk.events (source, type, subject_type, subject_id, anon_id, occurred_at, payload) values ('website', $1, $2, $3, $4, $5, $6)`,
        [type, type === 'link_click' ? 'link' : 'link_page', subject, anon, at, JSON.stringify({ page: 'bio', via, device: 'mobile', ...(label ? { label } : {}) })],
      );
    await ev('link_page_view', 'bio', 'v1', 'instagram', '2026-12-01T08:00:00Z');
    await ev('link_page_view', 'bio', 'v1', 'instagram', '2026-12-01T09:00:00Z'); // same visitor, same day
    await ev('link_page_view', 'bio', 'v2', 'linkedin', '2026-12-01T10:00:00Z');
    await ev('link_page_view', 'bio', 'v1', 'instagram', '2026-12-02T08:00:00Z'); // new day counts again
    await ev('link_click', 'audit', 'v1', 'instagram', '2026-12-01T08:01:00Z', 'Book a Workflow Audit');
    await ev('link_click', 'audit', 'v2', 'linkedin', '2026-12-01T10:01:00Z', 'Book a Workflow Audit');
    await ev('link_click', 'whatsapp', 'v1', 'instagram', '2026-12-02T08:01:00Z', 'WhatsApp');
    await ev('link_page_view', 'bio', 'v9', 'instagram', '2026-11-20T08:00:00Z'); // outside the period
  });

  const stats = (claims = ownerClaims('aal2')) =>
    asRole<{ s: Record<string, unknown> }>(db, claims, `select desk.link_stats('2026-11-30T22:00:00Z', '2026-12-02T22:00:00Z') s`).then((r) => r[0]!.s);

  it('counts views, daily visitors, clicks, by link, by source and by day', async () => {
    const s = await stats();
    expect(s).toMatchObject({ views: 4, visitors: 3, clicks: 3, clickers: 3 });
    expect(s.by_link).toEqual([
      { link: 'audit', label: 'Book a Workflow Audit', clicks: 2 },
      { link: 'whatsapp', label: 'WhatsApp', clicks: 1 },
    ]);
    expect(s.by_source).toEqual([
      { source: 'instagram', views: 3, clicks: 2 },
      { source: 'linkedin', views: 1, clicks: 1 },
    ]);
    expect(s.by_day).toEqual([
      { day: '2026-12-01', views: 3, clicks: 2 },
      { day: '2026-12-02', views: 1, clicks: 1 },
    ]);
    expect(s.by_device).toEqual({ mobile: 4 });
  });

  it('a viewer sees the numbers; a session without 2FA sees nothing', async () => {
    expect((await stats(viewerClaims('aal2'))).views).toBe(4);
    expect((await stats(ownerClaims('aal1'))).views).toBe(0);
  });
});
