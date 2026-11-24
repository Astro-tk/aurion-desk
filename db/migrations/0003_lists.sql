-- ---------------------------------------------------------------------
-- 5. Config lists (editable in Settings) and the fixed stages
-- ---------------------------------------------------------------------
create table desk.stages (
  key          text primary key,
  label        text not null unique,
  position     smallint not null unique,
  is_closed    boolean not null default false     -- Signed and Not now
);

-- Same shape for every editable list. Values (key) are stable; labels can change;
-- rows are deactivated, never deleted, so history keeps its meaning.
create table desk.org_types (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null, sort_order int not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table desk.lead_sources      (like desk.org_types including all);
create table desk.contact_methods   (like desk.org_types including all);  -- email, WhatsApp, LinkedIn, phone...
create table desk.activity_purposes (like desk.org_types including all);  -- permission ask, follow-up...
create table desk.channels (
  like desk.org_types including all,
  number smallint unique                       -- the blueprint's channel 1 to 12
);
comment on table desk.channels is 'Marketing channels from blueprint section 3 (1. Warm network ... 12. BeeLevel''s audience).';
comment on table desk.contact_methods is 'HOW a message travelled (email, WhatsApp, LinkedIn). Different from channels, which are WHICH marketing effort it belongs to.';

create table desk.app_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
