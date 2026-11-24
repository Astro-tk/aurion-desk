-- ---------------------------------------------------------------------
-- 0012 Pipeline: event triggers, the atomic CSV import, a fallback contact method.
-- ---------------------------------------------------------------------

insert into desk.contact_methods (key, label, sort_order) values ('other', 'Other or unknown', 99)
on conflict (key) do nothing;

-- Every consent record writes an event (subject: the contact).
create or replace function desk.tg_consent_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into desk.events (source, type, subject_type, subject_id, actor_id, payload)
  values (desk.current_event_source(), 'consent_recorded', 'contact', new.contact_id::text, auth.uid(),
          jsonb_build_object('status', new.status, 'method', new.method_key, 'evidence', new.evidence_type));
  return null;
end $$;
create trigger consent_event_tg after insert on desk.consent_records
  for each row execute function desk.tg_consent_event();

-- Every logged activity writes an event (subject: the lead if there is one, else the contact).
create or replace function desk.tg_activity_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into desk.events (source, type, subject_type, subject_id, actor_id, occurred_at, payload)
  values (desk.current_event_source(), 'activity_logged',
          case when new.lead_id is not null then 'lead' else 'contact' end,
          coalesce(new.lead_id, new.contact_id)::text, auth.uid(), new.occurred_at,
          jsonb_build_object('method', new.method_key, 'direction', new.direction, 'purpose', new.purpose_key));
  return null;
end $$;
create trigger activity_event_tg after insert on desk.activities
  for each row execute function desk.tg_activity_event();

/*
 * The CSV import commit. p_rows is the validated, normalised output of the dry run
 * (src/modules/pipeline/csv-import.ts). It runs as the signed-in user (RLS applies) and in a
 * single transaction: either every row lands or none does.
 *
 * Row keys: row, firm, type_key, town, website, domain, contact_name, role_title, linkedin_url,
 * email, source_key, first_contact_date, channel_key, consent_status, consent_raw,
 * consent_method, stage_key, next_action, next_date, notes
 */
create or replace function desk.import_pipeline(p_batch_id uuid, p_rows jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  r          jsonb;
  v_org      uuid;
  v_contact  uuid;
  v_leads    int := 0;
  v_skipped  int := 0;
  v_consents int := 0;
  v_orgs     int := 0;
begin
  if not desk.can('pipeline.import') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from desk.import_batches where id = p_batch_id and status = 'dry_run' and kind = 'pipeline_csv') then
    raise exception 'Run the dry run again before importing.' using errcode = 'DK010';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_org := null;
    v_contact := null;

    -- A contact already in Desk (same email) is skipped, never overwritten.
    if nullif(r ->> 'email', '') is not null
       and exists (select 1 from desk.contacts where email = (r ->> 'email')) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if nullif(r ->> 'firm', '') is not null then
      select id into v_org from desk.organisations
       where lower(name) = lower(r ->> 'firm')
         and coalesce(lower(town), '') = coalesce(lower(nullif(r ->> 'town', '')), coalesce(lower(town), ''))
       order by created_at limit 1;
      if v_org is null then
        insert into desk.organisations (name, type_key, town, website, domain, created_by)
        values (r ->> 'firm', nullif(r ->> 'type_key', ''), nullif(r ->> 'town', ''), nullif(r ->> 'website', ''),
                nullif(r ->> 'domain', ''), auth.uid())
        returning id into v_org;
        v_orgs := v_orgs + 1;
      end if;
    end if;

    if coalesce(nullif(r ->> 'contact_name', ''), nullif(r ->> 'email', ''), nullif(r ->> 'linkedin_url', '')) is not null then
      insert into desk.contacts (organisation_id, full_name, role_title, email, linkedin_url, created_by)
      values (v_org, nullif(r ->> 'contact_name', ''), nullif(r ->> 'role_title', ''), nullif(r ->> 'email', ''),
              nullif(r ->> 'linkedin_url', ''), auth.uid())
      returning id into v_contact;
    end if;

    insert into desk.leads (contact_id, organisation_id, source_key, channel_key, stage_key, first_contact_date,
                            next_action, next_date, notes, created_from, owner_id, created_by)
    values (v_contact, v_org, nullif(r ->> 'source_key', ''), nullif(r ->> 'channel_key', ''),
            coalesce(nullif(r ->> 'stage_key', ''), 'new'), nullif(r ->> 'first_contact_date', '')::date,
            nullif(r ->> 'next_action', ''), nullif(r ->> 'next_date', '')::date, nullif(r ->> 'notes', ''),
            'import', auth.uid(), auth.uid());
    v_leads := v_leads + 1;

    if v_contact is not null and nullif(r ->> 'consent_status', '') is not null then
      insert into desk.consent_records (contact_id, status, method_key, wording_shown, evidence_type, evidence_ref, recorded_by)
      values (v_contact, r ->> 'consent_status', coalesce(nullif(r ->> 'consent_method', ''), 'other'),
              'Imported from the Aurion Pipeline tracker. Consent column: ' || coalesce(r ->> 'consent_raw', ''),
              'import', p_batch_id::text, auth.uid());
      v_consents := v_consents + 1;
    end if;
  end loop;

  update desk.import_batches
     set status = 'committed', committed_at = now(),
         report = report || jsonb_build_object('committed', jsonb_build_object(
           'leads', v_leads, 'skipped', v_skipped, 'consents', v_consents, 'organisations', v_orgs))
   where id = p_batch_id;

  insert into desk.events (source, type, subject_type, subject_id, actor_id, payload)
  values ('import', 'pipeline_imported', 'import_batch', p_batch_id::text, auth.uid(),
          jsonb_build_object('leads', v_leads, 'skipped', v_skipped, 'consents', v_consents, 'organisations', v_orgs));

  return jsonb_build_object('leads', v_leads, 'skipped', v_skipped, 'consents', v_consents, 'organisations', v_orgs);
end $$;

revoke all on function desk.import_pipeline(uuid, jsonb) from public, anon;
grant execute on function desk.import_pipeline(uuid, jsonb) to authenticated, service_role;

/*
 * Quick add: organisation (reused by name), contact (deduped on email, then phone) and lead,
 * in one transaction. If the person already has an open lead, nothing is created and that
 * lead is returned with existing = true.
 * Keys: name, firm, email, phone, channel_key, source_key, next_action, next_date, first_contact_date
 */
create or replace function desk.quick_add_lead(p jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_org     uuid;
  v_contact uuid;
  v_lead    uuid;
begin
  if not desk.can('pipeline.write') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if nullif(p ->> 'email', '') is not null then
    select id into v_contact from desk.contacts where email = (p ->> 'email');
  end if;
  if v_contact is null and nullif(p ->> 'phone', '') is not null then
    select id into v_contact from desk.contacts where phone_e164 = (p ->> 'phone');
  end if;

  if v_contact is not null then
    select id into v_lead from desk.leads where contact_id = v_contact and archived_at is null;
    if v_lead is not null then
      return jsonb_build_object('lead_id', v_lead, 'existing', true);
    end if;
    select organisation_id into v_org from desk.contacts where id = v_contact;
  end if;

  if v_org is null and nullif(p ->> 'firm', '') is not null then
    select id into v_org from desk.organisations where lower(name) = lower(p ->> 'firm') order by created_at limit 1;
    if v_org is null then
      insert into desk.organisations (name, created_by) values (p ->> 'firm', auth.uid()) returning id into v_org;
    end if;
  end if;

  if v_contact is null and coalesce(nullif(p ->> 'name', ''), nullif(p ->> 'email', ''), nullif(p ->> 'phone', '')) is not null then
    insert into desk.contacts (organisation_id, full_name, email, phone_e164, created_by)
    values (v_org, nullif(p ->> 'name', ''), nullif(p ->> 'email', ''), nullif(p ->> 'phone', ''), auth.uid())
    returning id into v_contact;
  end if;

  insert into desk.leads (contact_id, organisation_id, channel_key, source_key, next_action, next_date,
                          first_contact_date, created_from, owner_id, created_by)
  values (v_contact, v_org, nullif(p ->> 'channel_key', ''), nullif(p ->> 'source_key', ''),
          nullif(p ->> 'next_action', ''), nullif(p ->> 'next_date', '')::date,
          coalesce(nullif(p ->> 'first_contact_date', '')::date, desk.today_sast()),
          'manual', auth.uid(), auth.uid())
  returning id into v_lead;

  return jsonb_build_object('lead_id', v_lead, 'existing', false);
end $$;

revoke all on function desk.quick_add_lead(jsonb) from public, anon;
grant execute on function desk.quick_add_lead(jsonb) to authenticated;

-- The export needs the organisation's website; appended as the last column of the read model.
create or replace view desk.lead_overview with (security_invoker = true) as
  select
    l.*,
    c.full_name, c.email, c.phone_e164, c.role_title, c.linkedin_url, c.forgotten_at,
    o.name  as organisation_name, o.type_key as organisation_type, o.town,
    cc.status as consent_status,
    coalesce(cc.status = 'no', false) as do_not_contact,
    (l.next_date is not null and l.next_date < desk.today_sast()
       and not s.is_closed) as is_overdue,
    s.position as stage_position,
    o.website as organisation_website
  from desk.leads l
  join desk.stages s on s.key = l.stage_key
  left join desk.contacts c on c.id = l.contact_id
  left join desk.organisations o on o.id = coalesce(l.organisation_id, c.organisation_id)
  left join desk.contact_consent_current cc on cc.contact_id = l.contact_id;
