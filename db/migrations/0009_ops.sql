-- ---------------------------------------------------------------------
-- 14. Imports, saved views, jobs, notifications, throttling
-- ---------------------------------------------------------------------
create table desk.import_batches (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('pipeline_csv', 'blueprint_md')),
  filename      text,
  sha256        text not null,
  row_count     int,
  status        text not null check (status in ('dry_run', 'committed', 'failed')),
  report        jsonb not null default '{}',  -- row numbers and problem codes only, no cell values
  created_at    timestamptz not null default now(),
  created_by    uuid,
  committed_at  timestamptz
);

create table desk.saved_views (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references desk.members (user_id) on delete cascade,
  module      text not null,            -- "pipeline" in Phase 1
  name        text not null check (char_length(name) between 1 and 60),
  query       jsonb not null,           -- filters, sort, columns, layout (table or board)
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (member_id, module, name)
);

create table desk.job_runs (
  id           uuid primary key default gen_random_uuid(),
  job          text not null,           -- "digest", "housekeeping", "renewals"
  run_key      text not null,           -- e.g. the SAST date "2026-12-01"
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  error        text,
  details      jsonb not null default '{}'
);
create index job_runs_job_idx    on desk.job_runs (job, started_at desc);
create index job_runs_status_idx on desk.job_runs (status, started_at desc);

-- Every outbound alert or digest claims a dedupe key first, so a second run sends nothing.
create table desk.notifications (
  id                   uuid primary key default gen_random_uuid(),
  dedupe_key           text not null unique,  -- "digest:2026-12-01:email", "alert:<inbox id>:whatsapp"
  channel              text not null check (channel in ('email', 'whatsapp', 'telegram')),
  status               text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'skipped')),
  subject              text,
  provider_message_id  text,
  error                text,
  job_run_id           uuid references desk.job_runs (id),
  claimed_at           timestamptz not null default now(),
  sent_at              timestamptz
);

create table desk.auth_attempts (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  email_hash  text not null,
  ip_hash     text not null,
  succeeded   boolean not null
);
create index auth_attempts_email_idx on desk.auth_attempts (email_hash, at desc);
create index auth_attempts_ip_idx    on desk.auth_attempts (ip_hash, at desc);

-- Lockout rule: 5 failures for one email in 15 minutes locks that email for 15 minutes;
-- 20 failures from one IP in an hour locks that IP for an hour.
create or replace function desk.auth_lockout_seconds(p_email_hash text, p_ip_hash text)
returns int language sql stable security definer set search_path = '' as $$
  select greatest(
    coalesce((select ceil(extract(epoch from (max(at) + interval '15 minutes' - now())))::int
              from desk.auth_attempts
              where email_hash = p_email_hash and not succeeded and at > now() - interval '15 minutes'
              having count(*) >= 5), 0),
    coalesce((select ceil(extract(epoch from (max(at) + interval '1 hour' - now())))::int
              from desk.auth_attempts
              where ip_hash = p_ip_hash and not succeeded and at > now() - interval '1 hour'
              having count(*) >= 20), 0)
  )
$$;

create table desk.rate_limit_buckets (
  bucket        text not null,          -- "ingest-form:<ip hash>"
  window_start  timestamptz not null,
  hits          int not null default 0,
  primary key (bucket, window_start)
);

-- Atomic: returns true if this hit is allowed.
create or replace function desk.rate_limit_take(p_bucket text, p_window_seconds int, p_max int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into desk.rate_limit_buckets as b (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = b.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Signed chatbot requests seen in the last 10 minutes: a replay inside the time window is refused.
create table desk.ingest_nonces (
  signature_hash  text primary key,
  seen_at         timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 15. Read model for the pipeline table and board
-- ---------------------------------------------------------------------
create view desk.lead_overview with (security_invoker = true) as
  select
    l.*,
    c.full_name, c.email, c.phone_e164, c.role_title, c.linkedin_url, c.forgotten_at,
    o.name  as organisation_name, o.type_key as organisation_type, o.town,
    cc.status as consent_status,
    coalesce(cc.status = 'no', false) as do_not_contact,
    (l.next_date is not null and l.next_date < desk.today_sast()
       and not s.is_closed) as is_overdue,
    s.position as stage_position
  from desk.leads l
  join desk.stages s on s.key = l.stage_key
  left join desk.contacts c on c.id = l.contact_id
  left join desk.organisations o on o.id = coalesce(l.organisation_id, c.organisation_id)
  left join desk.contact_consent_current cc on cc.contact_id = l.contact_id;


-- ---------------------------------------------------------------------
-- 16. POPIA delete: remove personal data, keep an anonymous trail
-- ---------------------------------------------------------------------
create or replace function desk.forget_contact(
  p_contact_id uuid, p_email_hash text, p_phone_hash text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_lead_ids  text[];
  v_inbox_ids text[];
begin
  if not desk.can('contacts.forget') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_email_hash is not null then
    insert into desk.suppressions (identifier_hash, kind, reason)
    values (p_email_hash, 'email', 'forgotten') on conflict (identifier_hash) do nothing;
  end if;
  if p_phone_hash is not null then
    insert into desk.suppressions (identifier_hash, kind, reason)
    values (p_phone_hash, 'phone', 'forgotten') on conflict (identifier_hash) do nothing;
  end if;

  select coalesce(array_agg(id::text), '{}') into v_lead_ids  from desk.leads       where contact_id = p_contact_id;
  select coalesce(array_agg(id::text), '{}') into v_inbox_ids from desk.inbox_items where contact_id = p_contact_id;

  update desk.contacts
     set full_name = null, role_title = null, email = null, phone_e164 = null,
         linkedin_url = null, forgotten_at = now()
   where id = p_contact_id;

  update desk.leads
     set notes = null, summary = null, next_action = null
   where contact_id = p_contact_id;

  update desk.activities set notes = null, outcome = null where contact_id = p_contact_id;

  update desk.inbox_items
     set name = null, company = null, email = null, phone_e164 = null, message = null,
         need = null, score_reason = null, page_url = null,
         payload = jsonb_build_object('redacted', true)
   where contact_id = p_contact_id;

  update desk.events
     set payload = jsonb_build_object('redacted', true)
   where (subject_type = 'contact'    and subject_id = p_contact_id::text)
      or (subject_type = 'lead'       and subject_id = any (v_lead_ids))
      or (subject_type = 'inbox_item' and subject_id = any (v_inbox_ids));

  insert into desk.events (source, type, subject_type, subject_id, actor_id)
  values ('manual', 'contact_forgotten', 'contact', p_contact_id::text, auth.uid());

  insert into desk.audit_log (actor_id, actor_kind, action, table_name, record_id)
  values (auth.uid(), 'member', 'forget', 'contacts', p_contact_id::text);
end $$;
