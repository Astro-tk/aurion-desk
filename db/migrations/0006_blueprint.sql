-- ---------------------------------------------------------------------
-- 11. Blueprint: stored source, sections and tasks
-- ---------------------------------------------------------------------
create table desk.blueprint_documents (
  id               uuid primary key default gen_random_uuid(),
  version          int not null unique,
  title            text not null,
  doc_date         date,                -- from the byline, e.g. 14 Nov 2026; sets the run-sheet year
  source_markdown  text not null,       -- kept whole for the Phase 2 Docs module
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  is_current       boolean not null default false,
  imported_at      timestamptz not null default now(),
  imported_by      uuid
);
create unique index blueprint_one_current on desk.blueprint_documents (is_current) where is_current;

create table desk.blueprint_sections (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,  -- slug path, e.g. "10-december-run-sheet-day-by-day/tue-1-dec"
  parent_id      uuid references desk.blueprint_sections (id),
  level          smallint not null check (level between 1 and 6),
  number         text,                  -- "10" from "## 10. December run sheet"
  title          text not null,
  position       int not null,
  run_date       date,                  -- set for run-sheet day headings, e.g. 2026-12-01
  body_markdown  text not null default '',  -- prose and tables, without the checklist
  document_id    uuid references desk.blueprint_documents (id),  -- last version that contained it
  removed_at     timestamptz            -- gone from the latest import; kept for history
);

create table desk.tasks (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('blueprint', 'adhoc')),
  title          text not null check (char_length(title) between 1 and 1000),
  section_id     uuid references desk.blueprint_sections (id),
  section_label  text,          -- free label for ad hoc tasks
  source_ref     text,          -- readable heading path, e.g. "10. December run sheet > Tue 1 Dec"
  match_key      text,          -- section key + normalised text + occurrence; how re-import keeps ticks
  position       int,
  due_date       date,
  done_at        timestamptz,
  done_by        uuid,
  lead_id        uuid references desk.leads (id),   -- ad hoc follow-up tied to a lead
  removed_at     timestamptz,   -- dropped by a re-import; tick history kept
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  check (kind <> 'blueprint' or (section_id is not null and match_key is not null))
);
create unique index tasks_match_key_uq on desk.tasks (match_key)
  where kind = 'blueprint' and removed_at is null;
create index tasks_due_idx     on desk.tasks (due_date) where done_at is null and removed_at is null;
create index tasks_section_idx on desk.tasks (section_id, position);
