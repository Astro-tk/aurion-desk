-- ---------------------------------------------------------------------
-- 13. Platforms register (no secrets, ever)
-- ---------------------------------------------------------------------
create table desk.platforms (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique check (char_length(name) between 1 and 100),
  purpose             text check (char_length(purpose) <= 300),
  url                 text check (url ~* '^https://'),
  monthly_cost_cents  bigint check (monthly_cost_cents >= 0),  -- null = not set yet (shown, not counted)
  billing_cycle       text not null default 'monthly' check (billing_cycle in ('monthly', 'annual', 'usage', 'free', 'once')),
  renewal_date        date,
  auto_advance        boolean not null default true,   -- roll renewal_date forward one cycle once it passes
  login_location      text check (char_length(login_location) <= 200),
  owner_email         extensions.citext,
  status              text not null default 'active' check (status in ('active', 'planned', 'deciding', 'paused', 'cancelled')),
  is_reminder         boolean not null default false,  -- e.g. "Monthly backup export", not a paid tool
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- A hint like "Bitwarden: Aurion > Vercel" is fine. Things that look like secrets are refused.
  constraint platforms_login_location_not_secret check (
    login_location is null or (
      login_location !~* '(password|passwd|pwd|secret|token|api[ _-]?key)\s*[:=]'
      and login_location !~ '[A-Za-z0-9_\-]{24,}'
      and login_location !~* '(sk|pk|rk)[-_](live|test|ant)'
    ))
);
