-- =====================================================================
-- Aurion Desk DEMO data, for screenshots. Every person and firm here is fictional and every
-- email ends in .example, which can never deliver.
--
-- Refuses to run unless this database is marked demo (npm run db:migrate -- --mode demo),
-- so real data and demo data can never mix. Run with: npm run seed:demo
-- Dates are relative to today, so the screens always look current.
-- =====================================================================

do $$
begin
  if not exists (select 1 from desk.instance where mode = 'demo') then
    raise exception 'Refusing to seed demo data: this database is not marked demo.';
  end if;
  if exists (select 1 from desk.leads) then
    raise exception 'Refusing to seed demo data: this database already has leads.';
  end if;
end $$;

select set_config('request.headers', '{"x-desk-source":"system","x-desk-actor":"system"}', true);

with orgs(name, type_key, town, website) as (
  values
    ('Ridgeline Quantity Surveyors', 'qs_practice', 'Centurion', 'https://ridgeline-qs.example'),
    ('Mokoena and Partners Consulting Engineers', 'consulting_engineers', 'Pretoria', 'https://mokoena-ce.example'),
    ('Blue Crane Civils', 'contractor', 'Midrand', 'https://bluecrane-civils.example'),
    ('Tshwane Tender Services', 'partner', 'Pretoria', null),
    ('Ubuntu Supplier Development Fund', 'esd_manager', 'Johannesburg', 'https://ubuntu-sdf.example'),
    ('Jacaranda Building Contractors', 'contractor', 'Pretoria East', null),
    ('Highveld Estimating', 'qs_practice', 'Randburg', 'https://highveld-est.example'),
    ('Karoo Growth Partners', 'esd_implementer', 'Sandton', 'https://karoo-growth.example')
)
insert into desk.organisations (name, type_key, town, website, domain)
select name, type_key, town, website, replace(replace(website, 'https://', ''), 'www.', '') from orgs;

with people(firm, full_name, role_title, email, phone) as (
  values
    ('Ridgeline Quantity Surveyors', 'Ayanda Dlamini', 'Director', 'ayanda@ridgeline-qs.example', '+27820000101'),
    ('Mokoena and Partners Consulting Engineers', 'Pieter van Wyk', 'Principal', 'pieter@mokoena-ce.example', null),
    ('Blue Crane Civils', 'Lerato Khumalo', 'Estimating manager', 'lerato@bluecrane-civils.example', '+27820000103'),
    ('Tshwane Tender Services', 'Sipho Nkosi', 'Owner', 'sipho@tshwane-tenders.example', null),
    ('Ubuntu Supplier Development Fund', 'Naledi Mahlangu', 'ESD manager', 'naledi@ubuntu-sdf.example', null),
    ('Jacaranda Building Contractors', 'Johan Botha', 'Managing member', 'johan@jacaranda-build.example', '+27820000106'),
    ('Highveld Estimating', 'Zanele Mokoena', 'Senior estimator', 'zanele@highveld-est.example', null),
    ('Karoo Growth Partners', 'Thabo Molefe', 'Programme lead', 'thabo@karoo-growth.example', null)
)
insert into desk.contacts (organisation_id, full_name, role_title, email, phone_e164)
select o.id, p.full_name, p.role_title, p.email, p.phone
from people p join desk.organisations o on o.name = p.firm;

with leads(email, source_key, channel_key, stage_key, first_contact, next_action, next_in_days, score, founding) as (
  values
    ('ayanda@ridgeline-qs.example', 'linkedin_search_a', 'linkedin', 'audit_booked', -9, 'Run the Workflow Audit (script S1)', 2, 5, true),
    ('pieter@mokoena-ce.example', 'cesa_directory', 'firm_email', 'permission_given', -6, 'Send E2 with the Checker link', -1, 3, false),
    ('lerato@bluecrane-civils.example', 'google_maps', 'firm_email', 'checker_used', -5, 'Send L3 and offer an audit slot', 1, 4, false),
    ('sipho@tshwane-tenders.example', 'partner_search', 'partners', 'new', -3, 'Partner call using P2', 3, null, false),
    ('naledi@ubuntu-sdf.example', 'linkedin_search_e', 'beelevel_audience', 'proposal_sent', -14, 'Day 6 follow-up: offer a 15-minute call', 0, 4, false),
    ('johan@jacaranda-build.example', 'cidb_register', 'firm_email', 'not_now', -8, null, null, 2, false),
    ('zanele@highveld-est.example', 'warm_network', 'warm_network', 'audit_done', -12, 'Send the two-page plan and proposal', -2, 5, false),
    ('thabo@karoo-growth.example', 'referral', 'beelevel_audience', 'signed', -20, 'Kick-off call, week 1 of onboarding', 5, 5, true)
)
insert into desk.leads (contact_id, organisation_id, source_key, channel_key, stage_key, first_contact_date, next_action,
                        next_date, score, founding_office, created_from)
select c.id, c.organisation_id, l.source_key, l.channel_key, l.stage_key, desk.today_sast() + l.first_contact,
       l.next_action, case when l.next_in_days is null then null else desk.today_sast() + l.next_in_days end,
       l.score, l.founding, 'manual'
from leads l join desk.contacts c on c.email = l.email;

-- Consent history: asks, yeses and one clear no.
insert into desk.consent_records (contact_id, status, method_key, wording_shown, evidence_type, recorded_at)
select c.id, x.status, x.method, x.wording, 'manual', now() - (x.days_ago || ' days')::interval
from (values
  ('ayanda@ridgeline-qs.example', 'asked', 'linkedin', 'L1: May I send you a two-minute BOQ check?', 9),
  ('ayanda@ridgeline-qs.example', 'yes', 'linkedin', 'L1: May I send you a two-minute BOQ check?', 8),
  ('pieter@mokoena-ce.example', 'yes', 'email', 'E1: May I send you one example of a checked BOQ?', 5),
  ('lerato@bluecrane-civils.example', 'yes', 'email', 'E1: May I send you one example of a checked BOQ?', 4),
  ('naledi@ubuntu-sdf.example', 'yes', 'linkedin', 'B2: May I show you a five-minute BeeLevel demo?', 13),
  ('johan@jacaranda-build.example', 'no', 'email', 'E1: May I send you one example of a checked BOQ?', 7),
  ('zanele@highveld-est.example', 'yes', 'whatsapp', 'W1: Would you be open to an introduction?', 12),
  ('thabo@karoo-growth.example', 'yes', 'email', 'Referral introduction, consent confirmed by email', 20)
) as x(email, status, method, wording, days_ago)
join desk.contacts c on c.email = x.email;

insert into desk.activities (lead_id, contact_id, occurred_at, method_key, direction, purpose_key, outcome, follow_up_date)
select l.id, l.contact_id, now() - (x.days_ago || ' days')::interval, x.method, x.direction, x.purpose, x.outcome, null
from (values
  ('ayanda@ridgeline-qs.example', 8, 'linkedin', 'outbound', 'permission_ask', 'Said yes to the Checker'),
  ('ayanda@ridgeline-qs.example', 3, 'email', 'inbound', 'reply', 'Booked Tuesday 19:30 audit slot'),
  ('lerato@bluecrane-civils.example', 2, 'email', 'inbound', 'reply', 'Ran the Checker on a 400-line BOQ'),
  ('naledi@ubuntu-sdf.example', 6, 'email', 'outbound', 'proposal', 'Proposal sent, three options'),
  ('zanele@highveld-est.example', 2, 'phone', 'outbound', 'audit_call', 'Audit done: about 26 hours a month to save')
) as x(email, days_ago, method, direction, purpose, outcome)
join desk.contacts c on c.email = x.email
join desk.leads l on l.contact_id = c.id;

-- Two items waiting in the Inbox.
insert into desk.contacts (full_name, email) values ('Kagiso Sithole', 'kagiso@sithole-qs.example'), ('Megan Peters', 'megan@peters-build.example');
insert into desk.inbox_items (source, contact_id, name, company, email, message, form_id, page_url, consent_ticked, consent_wording, payload, dedupe_key, received_at)
select 'form', c.id, 'Kagiso Sithole', 'Sithole QS', 'kagiso@sithole-qs.example',
       'Needs: Workflow Audit' || chr(10) || chr(10) || 'We check subcontractor BOQs by hand every week and keep missing unit errors.',
       'contact', 'https://aurioncreative.com/contact.html', true, 'Aurion may contact me about this enquiry.', '{"demo":true}', 'demo:form:1', now() - interval '3 hours'
from desk.contacts c where c.email = 'kagiso@sithole-qs.example';
insert into desk.inbox_items (source, contact_id, name, company, email, need, offer, score, score_reason, transcript_id, consent_ticked, consent_wording, payload, dedupe_key, received_at)
select 'chatbot', c.id, 'Megan Peters', 'Peters Building', 'megan@peters-build.example', 'Tender returnable documents for grade 6 bids',
       'Project Command', 4, 'Clear repeated pain, asked about pricing and timelines', 'web-demo0000000000000000000-s4', true,
       'Consent given in the Aurion Assistant chat to be contacted about this enquiry.', '{"demo":true}', 'chatbot:web-demo0000000000000000000-s4', now() - interval '50 minutes'
from desk.contacts c where c.email = 'megan@peters-build.example';
insert into desk.consent_records (contact_id, status, method_key, wording_shown, evidence_type, evidence_ref)
select c.id, 'yes', 'website_form', 'Aurion may contact me about this enquiry.', 'form', 'contact' from desk.contacts c where c.email = 'kagiso@sithole-qs.example';
insert into desk.consent_records (contact_id, status, method_key, wording_shown, evidence_type, evidence_ref)
select c.id, 'yes', 'chatbot', 'Consent given in the Aurion Assistant chat to be contacted about this enquiry.', 'chat_transcript', 'web-demo0000000000000000000-s4'
from desk.contacts c where c.email = 'megan@peters-build.example';

-- Last weeks' scorecard numbers, so the trend lines have something to draw.
insert into desk.scorecard_entries (target_id, period_start, value)
select t.id, (date_trunc('week', desk.today_sast()::timestamp)::date - (w * 7)), v
from desk.targets t
join (values
  ('live_conversations', 0, 1), ('live_conversations', 1, 2), ('live_conversations', 2, 3), ('live_conversations', 3, 1),
  ('linkedin_invitations', 0, 22), ('linkedin_invitations', 1, 30), ('linkedin_invitations', 2, 34), ('linkedin_invitations', 3, 18),
  ('checker_reports', 0, 3), ('checker_reports', 1, 6), ('checker_reports', 2, 4), ('checker_reports', 3, 2),
  ('hours_worked', 0, 7), ('hours_worked', 1, 9.5), ('hours_worked', 2, 11), ('hours_worked', 3, 8)
) as x(metric, w, v) on x.metric = t.metric_key
where t.kind = 'weekly';

insert into desk.scorecard_entries (target_id, period_start, value_cents)
select id, date_trunc('week', desk.today_sast()::timestamp)::date, 490000 from desk.targets where metric_key = 'recurring_revenue';

-- Example costs so the register shows a total.
update desk.platforms set monthly_cost_cents = c.cents, renewal_date = desk.today_sast() + c.renew_in, login_location = c.hint
from (values
  ('Vercel', 38000, 9, 'Password manager: Aurion > Vercel'),
  ('Supabase', 47500, 21, 'Password manager: Aurion > Supabase'),
  ('Canva', 21900, 4, 'Password manager: Aurion > Canva'),
  ('Cal.com', 0, 30, 'Password manager: Aurion > Cal.com'),
  ('Resend', 0, 30, 'Password manager: Aurion > Resend'),
  ('Domain registrar', 2500, 12, 'Password manager: Aurion > Registrar')
) as c(name, cents, renew_in, hint)
where desk.platforms.name = c.name;
