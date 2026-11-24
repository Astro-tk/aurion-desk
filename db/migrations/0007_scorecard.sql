-- ---------------------------------------------------------------------
-- 12. Targets and the weekly scorecard
-- ---------------------------------------------------------------------
create table desk.targets (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('channel', 'weekly')),
  metric_key    text not null check (metric_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  label         text not null,
  channel_key   text references desk.channels (key),
  period_start  date not null,      -- channel: the period; weekly: in force from this Monday
  period_end    date,               -- null = open-ended
  unit          text not null check (unit in ('count', 'hours', 'cents', 'milestone')),
  target_value  numeric(12, 2),     -- count / hours / milestone (1 = done)
  target_cents  bigint,             -- money targets only
  cap_value     numeric(12, 2),     -- e.g. hours: target 8, cap 10
  due_date      date,               -- milestones, e.g. BOQ Checker live by 8 Dec
  count_source  text not null check (count_source in ('leads', 'stage_history', 'manual')),
  source_filter jsonb not null default '{}',  -- {"source_key": "linkedin_search_e"} or {"to_stage": "audit_booked"}
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (kind <> 'channel' or channel_key is not null),
  check (unit = 'cents' or target_cents is null),
  check (unit <> 'cents' or target_value is null),
  unique nulls not distinct (kind, metric_key, channel_key, period_start)
);

create table desk.scorecard_entries (
  id            uuid primary key default gen_random_uuid(),
  target_id     uuid not null references desk.targets (id),
  period_start  date not null,      -- Monday of the SAST week, or the channel target's period start
  value         numeric(12, 2),
  value_cents   bigint,
  note          text check (char_length(note) <= 500),
  entered_by    uuid,
  entered_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (target_id, period_start),
  check (num_nonnulls(value, value_cents) = 1)
);
