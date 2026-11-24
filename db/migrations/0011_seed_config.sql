-- =====================================================================
-- SEED (migration 0010). Fixed stages, lists from pipeline.csv, targets
-- from blueprint sections 3 and 11, platforms named in the blueprint.
-- =====================================================================

insert into desk.roles (key, label) values
  ('owner', 'Owner'), ('viewer', 'Viewer (reserved)'), ('assistant', 'Assistant (reserved)');

-- Generated from permissions.ts. Shown here so the shape can be reviewed.
insert into desk.role_capabilities (role, capability)
select 'owner', c from unnest(array[
  'pipeline.read', 'pipeline.write', 'pipeline.import', 'contacts.forget',
  'inbox.read', 'inbox.decide',
  'blueprint.read', 'blueprint.write', 'blueprint.import',
  'scorecard.read', 'scorecard.write',
  'platforms.read', 'platforms.write',
  'events.read', 'events.write', 'audit.read',
  'settings.read', 'settings.write', 'data.export'
]) c
union all
select 'assistant', c from unnest(array[
  'pipeline.read', 'pipeline.write', 'inbox.read', 'inbox.decide',
  'blueprint.read', 'blueprint.write', 'scorecard.read', 'scorecard.write',
  'platforms.read', 'events.read', 'events.write'
]) c
union all
select 'viewer', c from unnest(array[
  'pipeline.read', 'inbox.read', 'blueprint.read', 'scorecard.read', 'platforms.read', 'events.read'
]) c;

insert into desk.stages (key, label, position, is_closed) values
  ('new',              'New',              1, false),
  ('permission_given', 'Permission given', 2, false),
  ('checker_used',     'Checker used',     3, false),
  ('audit_booked',     'Audit booked',     4, false),
  ('audit_done',       'Audit done',       5, false),
  ('proposal_sent',    'Proposal sent',    6, false),
  ('signed',           'Signed',           7, true),
  ('not_now',          'Not now',          8, true);

-- From pipeline.csv column "Type"
insert into desk.org_types (key, label, sort_order) values
  ('qs_practice', 'QS practice', 1), ('consulting_engineers', 'Consulting engineers', 2),
  ('contractor', 'Contractor', 3), ('partner', 'Partner', 4), ('esd_manager', 'ESD manager', 5),
  ('esd_implementer', 'ESD implementer', 6), ('warm_contact', 'Warm contact', 7),
  ('past_client', 'Past client', 8), ('other', 'Other', 9);

-- From pipeline.csv column "Source", plus "Website chatbot" for aurion-assistant leads
insert into desk.lead_sources (key, label, sort_order) values
  ('warm_network', 'Warm network', 1),
  ('linkedin_search_a', 'LinkedIn search A', 2), ('linkedin_search_b', 'LinkedIn search B', 3),
  ('linkedin_search_c', 'LinkedIn search C', 4), ('linkedin_search_d', 'LinkedIn search D', 5),
  ('linkedin_search_e', 'LinkedIn search E', 6),
  ('google_maps', 'Google Maps', 7), ('cesa_directory', 'CESA directory', 8),
  ('leads_2_business', 'Leads 2 Business', 9), ('cidb_register', 'CIDB register', 10),
  ('google_search', 'Google search', 11), ('partner_search', 'Partner search', 12),
  ('referral', 'Referral', 13), ('website_form', 'Website form', 14), ('boq_checker', 'BOQ Checker', 15),
  ('talk_or_event', 'Talk or event', 16), ('community_group', 'Community group', 17),
  ('past_client', 'Past client', 18), ('website_chatbot', 'Website chatbot', 19);

-- From pipeline.csv column "Channel"
insert into desk.channels (key, label, number, sort_order) values
  ('warm_network', 'Warm network', 1, 1), ('linkedin', 'LinkedIn', 2, 2),
  ('firm_email', 'Firm email', 3, 3), ('partners', 'Partners', 4, 4),
  ('reels_posts', 'Reels and posts', 5, 5), ('boq_checker', 'BOQ Checker', 6, 6),
  ('search', 'Search', 7, 7), ('talks', 'Talks', 8, 8), ('trade_press', 'Trade press', 9, 9),
  ('communities', 'Communities', 10, 10), ('past_clients', 'Past clients', 11, 11),
  ('beelevel_audience', 'BeeLevel''s audience', 12, 12);

insert into desk.contact_methods (key, label, sort_order) values
  ('email', 'Email', 1), ('whatsapp', 'WhatsApp', 2), ('linkedin', 'LinkedIn', 3),
  ('phone', 'Phone', 4), ('in_person', 'In person', 5), ('website_form', 'Website form', 6),
  ('chatbot', 'Website chatbot', 7);

insert into desk.activity_purposes (key, label, sort_order) values
  ('permission_ask', 'Permission ask', 1), ('introduction_ask', 'Introduction ask', 2),
  ('follow_up', 'Follow-up', 3), ('reply', 'Reply', 4), ('demo', 'Demo', 5),
  ('audit_call', 'Audit call', 6), ('proposal', 'Proposal', 7), ('referral_ask', 'Referral ask', 8),
  ('testimonial_ask', 'Testimonial ask', 9), ('other', 'Other', 10);

insert into desk.app_settings (key, value) values
  ('founding_office_places', '3'),
  ('founding_office_closes', '"2027-03-31"'),
  ('alert_score_threshold',  '4'),
  ('renewal_warning_days',   '14'),
  ('digest_local_time',      '"18:00"');

-- December channel targets (blueprint section 3). "leads" = counted from leads
-- whose channel matches and whose first contact date falls in December.
insert into desk.targets (kind, metric_key, label, channel_key, period_start, period_end, unit, target_value, due_date, count_source, source_filter, sort_order) values
  ('channel', 'messages_sent',        'Messages sent',               'warm_network',      '2026-12-01', '2026-12-31', 'count',     40,   null,         'leads',  '{}', 1),
  ('channel', 'blank_invitations',    'Blank invitations',           'linkedin',          '2026-12-01', '2026-12-31', 'count',     105,  null,         'leads',  '{}', 2),
  ('channel', 'permission_messages',  'Permission messages',         'linkedin',          '2026-12-01', '2026-12-31', 'count',     35,   null,         'manual', '{}', 3),
  ('channel', 'permission_emails',    'Permission emails',           'firm_email',        '2026-12-01', '2026-12-31', 'count',     60,   null,         'leads',  '{}', 4),
  ('channel', 'partner_emails',       'Partner emails',              'partners',          '2026-12-01', '2026-12-31', 'count',     20,   null,         'leads',  '{}', 5),
  ('channel', 'partner_calls',        'Partner calls',               'partners',          '2026-12-01', '2026-12-31', 'count',     3,    null,         'manual', '{}', 6),
  ('channel', 'reels_made',           'Reels made and scheduled',    'reels_posts',       '2026-12-01', '2026-12-31', 'count',     12,   null,         'manual', '{}', 7),
  ('channel', 'posts_made',           'Posts made and scheduled',    'reels_posts',       '2026-12-01', '2026-12-31', 'count',     12,   null,         'manual', '{}', 8),
  ('channel', 'checker_live',         'Live by 8 Dec',               'boq_checker',       '2026-12-01', '2026-12-31', 'milestone', 1,    '2026-12-08', 'manual', '{}', 9),
  ('channel', 'service_pages',        'Service pages',               'search',            '2026-12-01', '2026-12-31', 'count',     3,    null,         'manual', '{}', 10),
  ('channel', 'articles',             'Articles',                    'search',            '2026-12-01', '2026-12-31', 'count',     4,    null,         'manual', '{}', 11),
  ('channel', 'google_business',      'Google Business Profile',     'search',            '2026-12-01', '2026-12-31', 'milestone', 1,    null,         'manual', '{}', 12),
  ('channel', 'talk_pitches',         'Pitches',                     'talks',             '2026-12-01', '2026-12-31', 'count',     6,    null,         'manual', '{}', 13),
  ('channel', 'press_pitches',        'Pitches',                     'trade_press',       '2026-12-01', '2026-12-31', 'count',     4,    null,         'manual', '{}', 14),
  ('channel', 'groups_joined',        'Groups joined',               'communities',       '2026-12-01', '2026-12-31', 'count',     4,    null,         'manual', '{}', 15),
  ('channel', 'group_posts',          'Posts, one per group',        'communities',       '2026-12-01', '2026-12-31', 'count',     4,    null,         'manual', '{}', 16),
  ('channel', 'past_clients_contacted','Every past client contacted','past_clients',      '2026-12-01', '2026-12-31', 'count',     null, null,         'leads',  '{}', 17),
  ('channel', 'blank_invitations',    'Blank invitations',           'beelevel_audience', '2026-12-01', '2026-12-31', 'count',     30,   null,         'leads',  '{"source_key": "linkedin_search_e"}', 18),
  ('channel', 'permission_emails',    'Permission emails',           'beelevel_audience', '2026-12-01', '2026-12-31', 'count',     8,    null,         'manual', '{}', 19);

-- Weekly scorecard (blueprint section 11). In force from the week of 1 Dec 2026.
insert into desk.targets (kind, metric_key, label, period_start, unit, target_value, target_cents, cap_value, count_source, source_filter, sort_order) values
  ('weekly', 'live_conversations',   'Live conversations of 20 minutes or more', '2026-11-30', 'count', 2,    null,    null, 'manual',        '{}', 1),
  ('weekly', 'audits_booked',        'Audits booked',                            '2026-11-30', 'count', 1,    null,    null, 'stage_history', '{"to_stage": "audit_booked"}', 2),
  ('weekly', 'proposals_sent',       'Proposals sent (1 a fortnight)',           '2026-11-30', 'count', 0.5,  null,    null, 'stage_history', '{"to_stage": "proposal_sent"}', 3),
  ('weekly', 'linkedin_invitations', 'LinkedIn invitations sent',                '2026-11-30', 'count', 30,   null,    null, 'manual',        '{}', 4),
  ('weekly', 'checker_reports',      'Checker reports generated',                '2026-11-30', 'count', 5,    null,    null, 'manual',        '{}', 5),
  ('weekly', 'hours_worked',         'Hours worked on Aurion',                   '2026-11-30', 'hours', 8,    null,    10,   'manual',        '{}', 6),
  ('weekly', 'recurring_revenue',    'Recurring revenue (last Sunday of the month)', '2026-11-30', 'cents', null, 3540000, null, 'manual',   '{}', 7);

-- Platforms named in blueprint.md. Costs and logins left blank for the owner to fill in.
insert into desk.platforms (name, purpose, url, billing_cycle, status, notes) values
  ('Cal.com',          'Workflow Audit bookings',                         'https://cal.com',               'monthly', 'planned',  'Opened 1 Dec (run sheet)'),
  ('Brevo',            'Nurture emails N1 to N5, newsletter, Desk alerts and digest', 'https://www.brevo.com', 'monthly', 'planned', null),
  ('Paystack or Yoco', 'Audit payment link, deposits, debit orders',      null,                            'usage',   'deciding', 'Pick one; rename this row'),
  ('Zoho Invoice',     'Invoices and recurring billing',                  'https://www.zoho.com/invoice/', 'monthly', 'planned',  null),
  ('UptimeRobot',      'Monitors: site, Checker, Command Centre, Desk',   'https://uptimerobot.com',       'monthly', 'planned',  null),
  ('Telegram',         'Bot for phone alerts',                            'https://telegram.org',          'free',    'planned',  null),
  ('Google Cloud',     'Places API project',                              'https://console.cloud.google.com', 'usage', 'planned', null),
  ('Anthropic',        'API for Desk lead summaries and Claude Code',     'https://console.anthropic.com', 'usage',   'active',   null),
  ('Vercel',           'Hosting: website, Desk, products',                'https://vercel.com',            'monthly', 'active',   null),
  ('Supabase',         'Database, auth and storage (shared with aurion-assistant)', 'https://supabase.com', 'monthly', 'active', null),
  ('GitHub',           'Code repositories',                               'https://github.com',            'monthly', 'active',   null),
  ('Meta WhatsApp',    'WhatsApp Business and the chatbot template',      'https://business.facebook.com', 'usage',   'active',   null),
  ('Formspree',        'Website forms (primary)',                         'https://formspree.io',          'monthly', 'active',   null),
  ('Canva',            'One-pager, proposal and report templates',        'https://www.canva.com',         'monthly', 'active',   null),
  ('Domain registrar', 'aurioncreative.com: domain and DNS',              null,                            'annual',  'active',   'Rename to the registrar you use; set auto-renew');

insert into desk.platforms (name, purpose, billing_cycle, renewal_date, status, is_reminder, notes) values
  ('Monthly backup export', 'Download the full CSV ZIP from Settings and store it in your password-manager vault or offline drive',
   'free', '2026-12-01', 'active', true, 'Reminder only. Rolls forward a month after each due date.');
