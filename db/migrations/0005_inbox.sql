-- ---------------------------------------------------------------------
-- 10. Inbox (everything that arrives by itself)
-- ---------------------------------------------------------------------
create table desk.inbox_items (
  id               uuid primary key default gen_random_uuid(),
  source           text not null check (source in ('form', 'chatbot')),
  received_at      timestamptz not null default now(),
  status           text not null default 'new' check (status in ('new', 'accepted', 'dismissed')),
  contact_id       uuid references desk.contacts (id),
  organisation_id  uuid references desk.organisations (id),
  -- snapshot of what arrived (redacted by forget_contact)
  name             text,
  company          text,
  email            extensions.citext,
  phone_e164       text,
  message          text check (char_length(message) <= 5000),
  form_id          text,          -- which website form, e.g. "homepage", "contact"
  page_url         text,
  need             text,          -- chatbot fields
  offer            text,
  score            smallint check (score between 0 and 5),
  score_reason     text,
  transcript_id    text,
  consent_ticked   boolean not null default false,
  consent_wording  text,
  suppressed       boolean not null default false,  -- matched the suppression list or a latest "no"
  payload          jsonb not null default '{}',     -- the validated body as received
  dedupe_key       text not null unique,            -- chatbot: transcript id; form: hash of contact+form+minute
  lead_id          uuid references desk.leads (id),
  dismiss_reason   text check (char_length(dismiss_reason) <= 300),
  decided_at       timestamptz,
  decided_by       uuid,
  check (status <> 'dismissed' or dismiss_reason is not null),
  check (status <> 'accepted'  or lead_id is not null)
);
create index inbox_status_idx  on desk.inbox_items (status, received_at desc);
create index inbox_contact_idx on desk.inbox_items (contact_id);
