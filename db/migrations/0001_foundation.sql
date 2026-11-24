-- =====================================================================
-- Aurion Desk, Phase 1 schema. FOR REVIEW (not yet split into migrations).
--
-- Lives entirely in Postgres schema "desk" inside the shared Supabase
-- project, so it never collides with aurion-assistant's tables.
--
-- Conventions
--   * Money: bigint cents. Never numeric rands.
--   * Time: timestamptz (stored UTC). Calendar days ("due", "next date",
--     "first contact") are plain date values, meaning a day in Africa/Johannesburg.
--   * Lists the owner can extend (types, sources, channels, ways of contact,
--     activity purposes) are config tables, not enums.
--   * Stages are fixed by the blueprint, so they are a locked lookup table.
--   * No PII in audit_log or import reports, so a POPIA "forget" never has
--     to rewrite the audit trail.
--   * Every table has RLS on. Every policy needs an aal2 session AND a
--     capability from desk.role_capabilities (generated from permissions.ts).
-- =====================================================================

create schema if not exists desk;
revoke all on schema desk from public;
revoke all on schema desk from anon;
grant usage on schema desk to authenticated, service_role;

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------
-- 0. Instance marker: stops demo data and real data ever sharing a database
-- ---------------------------------------------------------------------
create table desk.instance (
  id          boolean primary key default true check (id),   -- single row
  mode        text not null check (mode in ('production', 'demo')),
  created_at  timestamptz not null default now()
);
comment on table desk.instance is
  'One row. The app refuses to start if DEMO=true and mode=production, or the reverse. The demo seed refuses to run unless mode=demo.';


-- ---------------------------------------------------------------------
-- 1. People who can sign in, roles and capabilities
-- ---------------------------------------------------------------------
create table desk.roles (
  key    text primary key check (key in ('owner', 'viewer', 'assistant')),
  label  text not null
);

create table desk.members (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  email         extensions.citext not null unique,
  display_name  text not null check (char_length(display_name) between 1 and 80),
  role          text not null references desk.roles (key),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  disabled_at   timestamptz
);

create table desk.role_capabilities (
  role        text not null references desk.roles (key),
  capability  text not null check (capability ~ '^[a-z]+\.[a-z_]+$'),
  primary key (role, capability)
);
comment on table desk.role_capabilities is
  'GENERATED from src/lib/auth/permissions.ts by "npm run gen:capabilities". A unit test fails if this table and permissions.ts disagree.';


-- ---------------------------------------------------------------------
-- 2. Helper functions used by every policy
-- ---------------------------------------------------------------------
create or replace function desk.session_is_aal2()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- True only for an active member, in an aal2 session, whose role has the capability.
create or replace function desk.can(p_capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select desk.session_is_aal2() and exists (
    select 1
    from desk.members m
    join desk.role_capabilities rc on rc.role = m.role
    where m.user_id = auth.uid()
      and m.disabled_at is null
      and rc.capability = p_capability
  )
$$;

-- True for any active member in an aal2 session (used for shared lookup lists).
create or replace function desk.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select desk.session_is_aal2() and exists (
    select 1 from desk.members m where m.user_id = auth.uid() and m.disabled_at is null
  )
$$;

-- PostgREST exposes request headers as a setting. Server code using the
-- service-role key sends x-desk-actor (ingest, cron, import) and x-desk-source.
create or replace function desk.request_header(p_name text)
returns text language sql stable set search_path = '' as $$
  select nullif(current_setting('request.headers', true), '')::jsonb ->> lower(p_name)
$$;

create or replace function desk.current_actor_kind()
returns text language sql stable set search_path = '' as $$
  select case
    when auth.uid() is not null then 'member'
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      then case when desk.request_header('x-desk-actor') in ('ingest', 'cron', 'import', 'system')
                then desk.request_header('x-desk-actor') else 'system' end
    when current_user in ('postgres', 'supabase_admin') then 'system'
    else 'anonymous'
  end
$$;

create or replace function desk.current_event_source()
returns text language sql stable set search_path = '' as $$
  select case
    when desk.request_header('x-desk-source') in
         ('website', 'chatbot', 'whatsapp', 'form', 'manual', 'import', 'system')
      then desk.request_header('x-desk-source')
    when auth.uid() is not null then 'manual'
    else 'system'
  end
$$;

-- Today in South Africa, for "overdue" and "due today".
create or replace function desk.today_sast()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Africa/Johannesburg')::date
$$;

create or replace function desk.tg_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function desk.tg_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'desk.% is append-only', tg_table_name using errcode = 'DK100';
end $$;
