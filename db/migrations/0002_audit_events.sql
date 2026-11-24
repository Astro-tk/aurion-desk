-- ---------------------------------------------------------------------
-- 3. Audit log (append-only, no personal data, only column NAMES)
-- ---------------------------------------------------------------------
create table desk.audit_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  actor_id         uuid,                       -- auth user, null for system work
  actor_kind       text not null check (actor_kind in ('member', 'system', 'ingest', 'cron', 'import', 'anonymous')),
  action           text not null check (action in (
                     'create', 'update', 'delete',
                     'sign_in', 'sign_in_failed', 'sign_in_locked', 'sign_out',
                     'mfa_enrolled', 'mfa_verified', 'mfa_failed', 'session_expired',
                     'export', 'forget', 'import')),
  table_name       text,
  record_id        text,
  changed_columns  text[],                     -- names only, never values
  context          jsonb not null default '{}' -- e.g. {"ip_hash": "...", "reason": "idle"}; never PII
);
create index audit_log_at_idx     on desk.audit_log (at desc);
create index audit_log_record_idx on desk.audit_log (table_name, record_id, at desc);

create trigger audit_log_append_only before update or delete on desk.audit_log
  for each row execute function desk.tg_append_only();
create trigger audit_log_no_truncate before truncate on desk.audit_log
  for each statement execute function desk.tg_append_only();

-- Generic row trigger attached to every business table below.
create or replace function desk.tg_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cols text[];
  v_id   text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_cols
    from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key)
      and n.key <> 'updated_at';
    if v_cols is null then
      return null;                               -- nothing really changed
    end if;
    v_id := to_jsonb(new) ->> 'id';
  elsif tg_op = 'INSERT' then
    v_id := to_jsonb(new) ->> 'id';
  else
    v_id := to_jsonb(old) ->> 'id';
  end if;

  insert into desk.audit_log (actor_id, actor_kind, action, table_name, record_id, changed_columns)
  values (auth.uid(), desk.current_actor_kind(),
          case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
          tg_table_name, v_id, v_cols);
  return null;
end $$;

-- Auth events (sign-in, 2FA, lockout) are written by server code through this.
create or replace function desk.audit_auth_event(
  p_action text, p_actor_id uuid, p_context jsonb default '{}'
) returns void language sql security definer set search_path = '' as $$
  insert into desk.audit_log (actor_id, actor_kind, action, context)
  values (p_actor_id, case when p_actor_id is null then 'anonymous' else 'member' end, p_action, coalesce(p_context, '{}'))
$$;


-- ---------------------------------------------------------------------
-- 4. Event store (Phase 2 analytics and Phase 3 social/experiments read this)
-- ---------------------------------------------------------------------
create table desk.events (
  id               bigint generated always as identity primary key,
  occurred_at      timestamptz not null default now(),  -- when it happened
  recorded_at      timestamptz not null default now(),  -- when Desk stored it
  source           text not null check (source in ('website', 'chatbot', 'whatsapp', 'form', 'manual', 'import', 'system')),
  type             text not null check (type ~ '^[a-z][a-z0-9_]{1,62}$'),
  subject_type     text check (subject_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  subject_id       text,      -- text, not uuid, so Phase 2 can use page paths and Phase 3 external post ids
  actor_id         uuid,
  anon_id          text,      -- Phase 2: rotating cookieless visitor hash, never PII. Null in Phase 1.
  idempotency_key  text,      -- lets ingest and importers retry safely
  payload          jsonb not null default '{}',
  check ((subject_type is null) = (subject_id is null))
);
create index events_occurred_at_idx on desk.events (occurred_at desc);
create index events_source_type_idx on desk.events (source, type, occurred_at desc);
create index events_subject_idx     on desk.events (subject_type, subject_id, occurred_at desc)
  where subject_id is not null;
create index events_anon_idx        on desk.events (anon_id, occurred_at)
  where anon_id is not null;
create unique index events_idempotency_uq on desk.events (source, idempotency_key)
  where idempotency_key is not null;
comment on table desk.events is
  'Generic event store. Phase 1 types: lead_created, stage_changed, form_submitted, chatbot_lead_received, inbox_accepted, inbox_dismissed, consent_recorded, activity_logged, task_done, task_reopened, blueprint_imported, pipeline_imported, scorecard_entered, platform_renewal_due, alert_sent, digest_sent, contact_forgotten, export_created. Only desk.forget_contact() may rewrite a payload.';
