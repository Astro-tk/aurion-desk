# Aurion Desk: Phase 1 plan, module map and migration plan

Status: approved and built (Phase 1). The README is the operating guide; this file records the
plan as approved, plus the changes below.

## Changes made during the build

| Approved plan said | What was built | Why |
| --- | --- | --- |
| Use the same Supabase project as aurion-assistant | A new Supabase project (README step 2.1) | aurion-assistant has no Supabase project: it uses Upstash Redis and Google Sheets. The `desk` schema isolation is unchanged. |
| Email through Brevo | Email through **Resend** | aurion-assistant already sends through Resend from a verified aurioncreative.com sender: no new DNS records, one transactional provider. Brevo stays for nurture and the newsletter. |
| WhatsApp alert variables named freely | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ALERT_NUMBER`, `WHATSAPP_ALERT_TEMPLATE` | Same values as aurion-assistant, so you copy them across; the template is its `new_lead_alert` (who, need, score). |
| Score scale assumed 0 to 5 | Chatbot sends 1 to 5 (confirmed in its code); the database allows 0 to 5 | |
| 11 migrations | 15: the 11 approved, plus pipeline functions (import, quick add), inbox functions (ingest, accept, dismiss, send-once claims), blueprint apply, and events defaulting their actor | Multi-table writes run as one database transaction each. |
| Chatbot alerts | Both alert until you set `CHATBOT_ALERTS_ENABLED=false` on aurion-assistant | Avoids two alerts per lead once Desk's are proven. |
| Website: homepage and contact forms | All three forms (homepage contact, pricing enquiry, contact page) send to Desk and have the consent box | The homepage has two forms; any form whose leads land in Desk needs an explicit consent choice. |

## 1. What I found in the two files

### blueprint.md
- 11 numbered sections, 36 sub-headings, **189 checklist items**.
- Tasks per section: 3 Marketing part 1: 28 · 4 Marketing part 2: 25 · 5 Brand and website: 14 · 6 Sales: 9 · 7 Delivery: 8 · 8 Support, finance, legal, admin: 16 · 9 Away-from-keyboard: 12 · 10 Run sheet: 77 · sections 1, 2 and 11: none (tables and prose only).
- The run sheet has 24 day headings, Tue 1 Dec to Thu 24 Dec. The byline date (14 Nov 2026) fixes the year, and the parser checks every weekday against the date ("Tue 1 Dec" really is a Tuesday in 2026) and stops with an error if one is wrong. Suffixes like "Fri 11 Dec: last outreach day" and "Wed 16 Dec, public holiday" are handled.
- Clean-up the parser does: `&#32;` and `&#91;embedded content ...\]` (export artefacts) are dropped; tables become real tables; links are kept.

### pipeline.csv: this is not the tracker
It is the **dropdown lists** sheet (Type, Source, Channel, Consent, Stage, Status), 18 rows and no leads. It has none of the 16 tracker columns. So:
- I use it to seed the config lists (org types, lead sources, channels) and to confirm the stages. The stages in it match the blueprint exactly.
- The importer is built for the 16-column tracker as you specified. Its dry run on this file will correctly refuse it with "missing columns: Firm, Contact, Email...".
- To prove the dry run, I will also generate a fictional 16-column CSV with deliberately broken rows.
- Consent mapping on import: `Not asked` or blank gives no record; `Asked` gives asked; `Yes` gives yes; `No (never contact)` gives no. Evidence is "import" plus the batch id.
- The "Status" column (Not started, In progress, Done) has no home in the spec. I am ignoring it unless you tell me what it tracks.

### Where the blueprint and this spec disagree
| Blueprint says | Spec says | What I will do |
| --- | --- | --- |
| Digest goes "Aurion Desk to Telegram" (workflow 7) | Email | Email in Phase 1. Telegram is a second `Notifier` and can be added later in about an hour. |
| Workflow 1: auto-reply S7 within a minute | Not in Phase 1 | Not built. The form ingest emits an event a future auto-reply can hang off. |
| Workflow 6: evening queue with drafted messages | Not in Phase 1 | Belongs with Phase 2 `ai` (reply drafts). The consent block is already in place for it. |
| Workflow 8: support@ tickets into Desk | Not in Phase 1 | Not built. It would be a third `IngestSource`. |
| "Checker reports generated" | Manual weekly entry | Manual now. Becomes automatic in Phase 2 when the Checker writes events. |

## 2. Decisions, and why

| Decision | Choice | Why |
| --- | --- | --- |
| Email provider | **Brevo**, through its transactional HTTP API | Brevo is already in the blueprint for nurture (N1 to N5) and the newsletter, so it means one account, one bill and one sender-domain setup (SPF and DKIM) instead of two. The free tier (300 a day) covers alerts and one digest easily. I use the HTTP API rather than raw SMTP because serverless functions handle SMTP connections slowly and unreliably, while HTTP returns a message id. Resend has nicer developer tooling but would add a 16th platform and a second DKIM setup on the same domain. |
| Migrations | **Our own small runner** (`npm run db:migrate`), keeping its history in `desk.schema_migrations` | The Supabase project is shared. `supabase db push` from a second repo clashes with aurion-assistant's migration history ("remote migrations not found locally"). Plain SQL files plus a runner over `DATABASE_URL` never touch that history. |
| Data access | supabase-js with schema `desk` and the **user's own JWT**, so RLS applies to every page read. Service-role key only in ingest, cron, the seed scripts and export. | This gives two layers of protection: if a page has a bug, it still cannot read past RLS. It needs `desk` added to Exposed schemas in the Supabase API settings. That is a README step, and it is safe because anon has no grants on `desk` at all. |
| 2FA enforcement | Three layers: (1) proxy/middleware lets an aal1 session reach only `/login/2fa`; (2) every RLS policy calls `desk.can()`, which requires `aal = aal2` in the JWT; (3) server actions call `requireCapability()` from `permissions.ts` | The aal1 session test runs against both the proxy and the database. |
| Roles | `desk.members.role` (owner, viewer, assistant). `permissions.ts` is the single source of truth. `desk.role_capabilities` is **generated** from it, and a test fails if they drift apart. | The app and the database can both enforce the rules without anyone keeping two lists by hand. |
| Login rate limit and lockout | Postgres (`desk.auth_attempts`): 5 failures per email in 15 minutes locks that email for 15 minutes; 20 per IP in an hour locks that IP for an hour. Emails and IPs are stored only as keyed hashes. | No Redis or Upstash, so no new platform. Volume is tiny. |
| Session expiry (7 days, or 12 hours idle) | Enforced in the app with a signed `desk_session` cookie (start time and last-seen time) checked in the proxy, followed by sign-out. I also document Supabase's time-box and inactivity settings for when you are on Pro. | Supabase's built-in session limits are a Pro-plan feature, and I don't know your plan. The app-level check works on any plan. |
| Ingest rate limit | `desk.rate_limit_take()`, an atomic Postgres counter per IP hash | Same reason as the login limit. |
| Chatbot replay protection | HMAC-SHA256 over `timestamp.body`; timestamp within 5 minutes; signature hash stored for 10 minutes and refused if seen again; dedupe on `transcript_id` | Covers both old and replayed requests. |
| Audit log | Generic trigger on every business table. It records actor, time, table, row id and the **names** of changed columns, never values. | A POPIA delete then never has to rewrite the append-only audit log, because the log never held personal data. |
| POPIA delete | `desk.forget_contact()`: blanks the PII columns (the contact becomes an anonymous tombstone), clears notes, activity notes, inbox snapshots and event payloads, and adds HMAC hashes of the email and phone to `desk.suppressions` | Consent records stay, because they hold no PII once the contact is a tombstone. If the same person ever submits a form again, they are flagged as "said no / asked to be forgotten" without Desk keeping their address. |
| Consent "no" block | DB trigger on `activities` (outbound refused, error DK001), plus `assertMayContact()` in `src/lib/consent.ts` for any future drafting | The block holds even if a page forgets to check. |
| Stage changes | DB trigger writes `stage_history` and a `stage_changed` event on every change | No code path can skip it. Imported stages are tagged `source = import`, so they do not inflate "audits booked this week". |
| Demo mode | `desk.instance.mode` is `production` or `demo`. The app refuses to start if `DEMO` disagrees with it, and the demo seed refuses a production database. Demo needs its **own** database. | Real data and demo data cannot mix by construction. |
| Markdown | `mdast-util-from-markdown` with GFM (tables and task lists), used both to parse tasks and to render sections server-side into our own components | No `dangerouslySetInnerHTML`, which keeps the CSP strict. |
| Charts | Hand-drawn SVG sparklines (about 40 lines) | No chart library needed for trend lines. |
| Tests | Vitest. SQL and RLS tests run in **PGlite** (Postgres in WebAssembly) with a stub `auth` schema that mirrors Supabase's `auth.uid()` and `auth.jwt()` | You have no Docker, Supabase CLI or psql on this machine. PGlite runs the real migrations in Node. |
| Next.js | Latest stable (16.x), App Router. The route guard lives in `src/proxy.ts`, which Next 16 calls "proxy"; earlier versions called it middleware. | |

## 3. Directory layout

```
aurion-desk/
  db/
    migrations/0001_... .sql          one file per area (see section 6)
    schema.sql                        concatenated view, for review only
  scripts/
    migrate.ts                        applies db/migrations, records desk.schema_migrations
    seed-owner.ts                     creates the owner in auth + desk.members (password >= 14)
    seed-demo.ts                      fictional data; refuses unless desk.instance.mode = demo
    gen-capabilities.ts               permissions.ts -> SQL for desk.role_capabilities
  src/
    proxy.ts                          auth + aal2 + idle/absolute expiry + security headers + CSP nonce
    app/
      (public)/login/page.tsx         re-exports from src/modules/settings/auth
      (public)/login/2fa/page.tsx
      (desk)/layout.tsx               shell + sidebar from registry; requireAal2() again server-side
      (desk)/page.tsx                 Home
      (desk)/<module>/...             one-line re-exports of src/modules/<name>/routes/*
      api/ingest/form/route.ts        -> integrations/website-form
      api/ingest/chatbot/route.ts     -> integrations/chatbot
      api/cron/digest/route.ts        -> modules/digest
      api/cron/housekeeping/route.ts  purge throttle rows, roll renewals, expire nonces
      api/export/route.ts             ZIP of every desk table (owner, audited)
      robots.txt/route.ts             Disallow: /
    lib/
      auth/permissions.ts             EVERY capability check lives here
      auth/session.ts                 getSession(), requireAal2(), requireCapability()
      db/server.ts                    user-JWT client (RLS)   | import 'server-only'
      db/service.ts                   service-role client     | import 'server-only'
      events.ts                       recordEvent()
      consent.ts                      currentConsent(), assertMayContact()
      format.ts                       formatRand(cents) -> "R 1 234 567.89", formatDate -> "12 Mar 2026", SAST helpers
      crypto.ts                       hmac, keyed hashes for suppression and throttling
      csv.ts                          parse + export
    integrations/
      types.ts                        IngestSource, Notifier, AIProvider, AnalyticsSource
      website-form/                   IngestSource (origin allowlist, CORS, honeypot, size, Zod)
      chatbot/                        IngestSource (HMAC, timestamp, nonce)
      brevo/                          Notifier (email)
      whatsapp/                       Notifier via the chatbot's template; no-op if WHATSAPP_* unset
      anthropic/                      AIProvider (AI_MODEL, default claude-haiku-5-5)
    modules/
      registry.ts                     ordered list of module manifests -> sidebar, Home cards, digest sections
      home/  pipeline/  inbox/  blueprint/  scorecard/  platforms/  digest/  settings/
      analytics/  docs/  ai/  social/  experiments/  money/   manifest only, status "later"
    components/ui/                    AppIcon, DataTable (sticky header, tabular nums), Field, EmptyState...
  tests/
```

Every module folder has the same shape:

```
modules/<name>/
  index.ts        manifest: { key, label, icon, href, phase, status, capability, homeCards?, digestSections? }
  routes/         page components re-exported by src/app
  actions.ts      server actions: Zod parse -> requireCapability -> write -> recordEvent
  queries.ts      reads through the user-JWT client
  schema.ts       Zod schemas
  components/
```

Because the manifest can contribute **Home cards** and **digest sections**, Phase 2 and 3 modules extend Home and the digest without either of those being edited.

## 4. Module map

| Module | Routes | Tables | Events written | Capabilities |
| --- | --- | --- | --- | --- |
| **home** | `/` | reads from all modules through their `homeCards` | none | any member |
| **pipeline** | `/pipeline` (table, board), `/pipeline/new` (quick add), `/pipeline/[id]`, `/pipeline/import`, `/pipeline/export` | organisations, contacts, leads, stage_history, consent_records, activities, saved_views, import_batches | lead_created*, stage_changed*, consent_recorded, activity_logged, pipeline_imported | pipeline.read/write/import, contacts.forget |
| **inbox** | `/inbox`, `/inbox/[id]` + `api/ingest/*` | inbox_items, contacts, leads, consent_records, notifications | form_submitted, chatbot_lead_received, inbox_accepted, inbox_dismissed, alert_sent, ai_draft_created | inbox.read/decide |
| **blueprint** | `/blueprint`, `/blueprint/[section]`, `/blueprint/import` (diff, then apply) | blueprint_documents, blueprint_sections, tasks | blueprint_imported, task_done, task_reopened | blueprint.read/write/import |
| **scorecard** | `/scorecard` (week), `/scorecard/december` (channel targets) | targets, scorecard_entries; reads leads, stage_history | scorecard_entered | scorecard.read/write |
| **platforms** | `/platforms`, `/platforms/[id]` | platforms | platform_renewal_due (cron) | platforms.read/write |
| **digest** | `api/cron/digest` + `/digest/preview` | job_runs, notifications; reads every module's `digestSections` | digest_sent | cron secret; preview needs settings.read |
| **settings** | `/settings` (lists, targets, profile, 2FA, export, danger zone), `/login`, `/login/2fa` | org_types, lead_sources, channels, contact_methods, activity_purposes, app_settings, members, audit_log | export_created, contact_forgotten | settings.read/write, data.export, audit.read |
| analytics (P2) | sidebar: Coming later | | | |
| docs (P2) | sidebar: Coming later | | | |
| ai (P2) | sidebar: Coming later | | | |
| social (P3) | sidebar: Coming later | | | |
| experiments (P3) | sidebar: Coming later | | | |
| money (P3) | sidebar: Coming later | | | |

\* written by a database trigger, so they cannot be skipped.

Home cards: Today's blueprint tasks (blueprint), Overdue follow-ups (pipeline: overdue `next_date` plus activity `follow_up_date`), New inbox items (inbox), This week against target (scorecard), Founding Office: places left out of 3 (pipeline: 3 minus Signed leads marked `founding_office`), Renewals within 14 days (platforms).

Digest sections, in order: new inbox items; promising leads (score 4 or more, or stage Audit booked or later with a next date this week); follow-ups due tomorrow; overdue; today's unticked blueprint tasks; renewals due within 14 days; yesterday's failed job runs. Idempotency: the digest claims `notifications.dedupe_key = 'digest:<SAST date>:email'` before sending. A second run finds the claim, sends nothing, and records `skipped` in job_runs.

## 5. How Phases 2 and 3 slot in (README gets the full version)

| Future module | Reads / writes | New tables (expected) | Interface |
| --- | --- | --- | --- |
| analytics | events `source=website, type=page_view`, using `anon_id` (already indexed), plus form_submitted and lead_created for funnels | none; possibly a monthly rollup table | AnalyticsSource (first-party tracker) |
| docs | blueprint_documents.source_markdown; Storage bucket `desk-docs` | documents (with a tsvector column) | none |
| ai | leads.summary and summary_is_ai_draft (already there), activities, scorecard_entries; consent block via assertMayContact | ai_drafts | AIProvider (already built) |
| uptime, hours | events `source=system`; scorecard target `hours_worked` already exists | hours_log | AnalyticsSource |
| social | events `source=system, type=social_metric`, subject = post | social_posts | AnalyticsSource (YouTube, Instagram), CSV import (LinkedIn) |
| experiments | events, activities (reply rate per variant), leads | experiments, experiment_assignments | none |
| money | platforms (costs), leads (Signed) | invoices, ledger_entries, all in cents | none |

Nothing in Phase 1 blocks these. The one scaling note: if page views pass a few million rows, `events` should move to monthly partitions. The primary key and indexes are chosen so that move is a migration, not a redesign.

## 6. Migration plan

Applied by `npm run db:migrate` (connection string in `DATABASE_URL`, the Supabase "Session pooler" URI). Each file runs in one transaction and is recorded in `desk.schema_migrations`. Re-running is a no-op.

| File | Contents |
| --- | --- |
| 0001_schema_roles.sql | schema, grants baseline, instance, roles, members, role_capabilities, helper functions |
| 0002_audit_events.sql | audit_log and tg_audit, events and indexes |
| 0003_lists.sql | stages, org_types, lead_sources, contact_methods, activity_purposes, channels, app_settings |
| 0004_pipeline.sql | organisations, contacts, suppressions, leads, stage_history and trigger, consent_records and view, activities and consent trigger, lead_overview |
| 0005_inbox.sql | inbox_items, ingest_nonces, rate_limit_buckets and rate_limit_take |
| 0006_blueprint.sql | blueprint_documents, blueprint_sections, tasks |
| 0007_scorecard.sql | targets, scorecard_entries |
| 0008_platforms.sql | platforms |
| 0009_ops.sql | import_batches, saved_views, job_runs, notifications, auth_attempts and lockout function, forget_contact |
| 0010_rls_grants.sql | triggers loop, final grants, enable RLS, every policy |
| 0011_seed_config.sql | roles, capabilities (generated), stages, lists, app_settings, targets, platforms |

The owner account is not a migration. It comes from `npm run seed:owner -- --email ... --name ...`, which prompts for the password and never echoes it.

Rollback: every migration is additive inside `desk`. A full rollback is `drop schema desk cascade`, which touches nothing of aurion-assistant's. The README states this, with a warning.

## 7. Build order (after approval)

1. Auth and security: proxy, headers and CSP, login, 2FA enrol and verify, lockout, session expiry, permissions.ts, audit, robots. Tests.
2. Pipeline and import. 3. Inbox and ingest and the AI draft. 4. Blueprint. 5. Scorecard. 6. Platforms. 7. Digest. 8. Settings.
9. Branches `desk-forms` (Astro-tk/newaurionsite) and `desk-ingest` (aurion-assistant). Not merged.
10. README.

After each step: tests, then a two-line summary.
