-- ---------------------------------------------------------------------
-- 6. Organisations, contacts, suppression list
-- ---------------------------------------------------------------------
create table desk.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  type_key    text references desk.org_types (key),
  town        text check (char_length(town) <= 100),
  website     text check (char_length(website) <= 300),
  domain      extensions.citext,   -- derived from website by the app, used for dedupe hints
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid
);
create index organisations_domain_idx on desk.organisations (domain) where domain is not null;
create index organisations_name_idx   on desk.organisations (lower(name));

create table desk.contacts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references desk.organisations (id) on delete set null,
  full_name        text check (char_length(full_name) <= 200),
  role_title       text check (char_length(role_title) <= 200),
  email            extensions.citext check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone_e164       text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  linkedin_url     text check (linkedin_url ~* '^https://([a-z]{2,3}\.)?linkedin\.com/'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  forgotten_at     timestamptz,   -- set by desk.forget_contact(); row becomes an anonymous tombstone
  check (forgotten_at is not null
         or full_name is not null or email is not null or phone_e164 is not null or linkedin_url is not null),
  check (forgotten_at is null
         or (full_name is null and role_title is null and email is null and phone_e164 is null and linkedin_url is null))
);
-- Dedupe on email and phone.
create unique index contacts_email_uq on desk.contacts (email) where email is not null;
create unique index contacts_phone_uq on desk.contacts (phone_e164) where phone_e164 is not null;
create index contacts_org_idx on desk.contacts (organisation_id);

-- Keyed hashes (HMAC-SHA256 with SUPPRESSION_PEPPER) of emails and phones that
-- said no or were forgotten. Lets ingest flag a returning "no" without keeping the address.
create table desk.suppressions (
  identifier_hash  text primary key check (identifier_hash ~ '^[0-9a-f]{64}$'),
  kind             text not null check (kind in ('email', 'phone')),
  reason           text not null check (reason in ('consent_no', 'forgotten')),
  created_at       timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 7. Leads and stage history
-- ---------------------------------------------------------------------
create table desk.leads (
  id                       uuid primary key default gen_random_uuid(),
  contact_id               uuid references desk.contacts (id),
  organisation_id          uuid references desk.organisations (id),
  source_key               text references desk.lead_sources (key),
  channel_key              text references desk.channels (key),
  stage_key                text not null default 'new' references desk.stages (key),
  first_contact_date       date,
  next_action              text check (char_length(next_action) <= 500),
  next_action_is_ai_draft  boolean not null default false,
  next_date                date,
  summary                  text check (char_length(summary) <= 1000),
  summary_is_ai_draft      boolean not null default false,
  ai_model                 text,
  score                    smallint check (score between 0 and 5),
  founding_office          boolean not null default false,   -- counts against the 3 Founding Office places when Signed
  owner_id                 uuid references desk.members (user_id),
  notes                    text,
  created_from             text not null check (created_from in ('import', 'form', 'chatbot', 'manual')),
  archived_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid,
  check (contact_id is not null or organisation_id is not null)
);
-- One open lead per contact: a returning person reopens their lead instead of duplicating it.
create unique index leads_one_open_per_contact on desk.leads (contact_id)
  where contact_id is not null and archived_at is null;
create index leads_stage_idx     on desk.leads (stage_key) where archived_at is null;
create index leads_next_date_idx on desk.leads (next_date) where archived_at is null;
create index leads_channel_idx   on desk.leads (channel_key, first_contact_date);
create index leads_org_idx       on desk.leads (organisation_id);

create table desk.stage_history (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references desk.leads (id) on delete cascade,
  from_stage  text references desk.stages (key),
  to_stage    text not null references desk.stages (key),
  changed_at  timestamptz not null default now(),
  changed_by  uuid,
  source      text not null,   -- same vocabulary as events.source; scorecard ignores 'import'
  note        text
);
create index stage_history_lead_idx on desk.stage_history (lead_id, changed_at desc);
create index stage_history_to_idx   on desk.stage_history (to_stage, changed_at);

create trigger stage_history_append_only before update or delete on desk.stage_history
  for each row execute function desk.tg_append_only();

-- Every stage change writes stage_history AND an event, whoever makes it.
create or replace function desk.tg_lead_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source text := desk.current_event_source();
begin
  if tg_op = 'INSERT' then
    insert into desk.stage_history (lead_id, from_stage, to_stage, changed_by, source)
    values (new.id, null, new.stage_key, auth.uid(), v_source);
    insert into desk.events (source, type, subject_type, subject_id, actor_id, payload)
    values (v_source, 'lead_created', 'lead', new.id::text, auth.uid(),
            jsonb_build_object('stage', new.stage_key, 'created_from', new.created_from,
                               'channel', new.channel_key, 'lead_source', new.source_key));
  elsif new.stage_key is distinct from old.stage_key then
    insert into desk.stage_history (lead_id, from_stage, to_stage, changed_by, source)
    values (new.id, old.stage_key, new.stage_key, auth.uid(), v_source);
    insert into desk.events (source, type, subject_type, subject_id, actor_id, payload)
    values (v_source, 'stage_changed', 'lead', new.id::text, auth.uid(),
            jsonb_build_object('from', old.stage_key, 'to', new.stage_key));
  end if;
  return null;
end $$;

create trigger leads_stage_tg after insert or update of stage_key on desk.leads
  for each row execute function desk.tg_lead_stage();


-- ---------------------------------------------------------------------
-- 8. Consent (append-only) and the "no" block
-- ---------------------------------------------------------------------
create table desk.consent_records (
  id             bigint generated always as identity primary key,  -- ordered, so "latest" is unambiguous
  contact_id     uuid not null references desk.contacts (id),
  status         text not null check (status in ('asked', 'yes', 'no')),
  method_key     text not null references desk.contact_methods (key),
  wording_shown  text not null check (char_length(wording_shown) between 1 and 1000),
  evidence_type  text not null check (evidence_type in ('form', 'chat_transcript', 'manual', 'import')),
  evidence_ref   text,          -- form id, chat transcript id, or import batch id
  recorded_at    timestamptz not null default now(),
  recorded_by    uuid,
  check (evidence_type not in ('form', 'chat_transcript', 'import') or evidence_ref is not null)
);
create index consent_contact_latest_idx on desk.consent_records (contact_id, recorded_at desc, id desc);

create trigger consent_append_only before update or delete on desk.consent_records
  for each row execute function desk.tg_append_only();
create trigger consent_no_truncate before truncate on desk.consent_records
  for each statement execute function desk.tg_append_only();

create view desk.contact_consent_current with (security_invoker = true) as
  select distinct on (contact_id)
         contact_id, status, method_key, recorded_at, id as consent_record_id
  from desk.consent_records
  order by contact_id, recorded_at desc, id desc;

create or replace function desk.contact_consent_status(p_contact_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select status from desk.consent_records
  where contact_id = p_contact_id
  order by recorded_at desc, id desc
  limit 1
$$;


-- ---------------------------------------------------------------------
-- 9. Activities (the contact log); outbound to a "no" is refused here too
-- ---------------------------------------------------------------------
create table desk.activities (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid references desk.leads (id),
  contact_id      uuid references desk.contacts (id),
  occurred_at     timestamptz not null default now(),
  method_key      text not null references desk.contact_methods (key),
  direction       text not null check (direction in ('inbound', 'outbound')),
  purpose_key     text not null references desk.activity_purposes (key),
  outcome         text check (char_length(outcome) <= 500),
  follow_up_date  date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  check (lead_id is not null or contact_id is not null)
);
create index activities_lead_idx      on desk.activities (lead_id, occurred_at desc);
create index activities_contact_idx   on desk.activities (contact_id, occurred_at desc);
create index activities_follow_up_idx on desk.activities (follow_up_date) where follow_up_date is not null;

create or replace function desk.tg_activity_consent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contact_id is null and new.lead_id is not null then
    select l.contact_id into new.contact_id from desk.leads l where l.id = new.lead_id;
  end if;
  if new.direction = 'outbound'
     and new.contact_id is not null
     and desk.contact_consent_status(new.contact_id) = 'no' then
    raise exception 'This contact said no. Desk will not log an outbound message to them.'
      using errcode = 'DK001';
  end if;
  return new;
end $$;

create trigger activities_consent_tg before insert or update on desk.activities
  for each row execute function desk.tg_activity_consent();
