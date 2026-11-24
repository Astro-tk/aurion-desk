-- ---------------------------------------------------------------------
-- 0013 Inbox: ingest (service role), accept and dismiss (members), notification claims.
-- ---------------------------------------------------------------------

/*
 * Called only by the ingest endpoints (service role). One transaction:
 *   - drop exact repeats (same dedupe_key) and report them as duplicates;
 *   - find the contact by email, then phone; fill in blanks, never overwrite;
 *   - create the organisation and contact when new;
 *   - add the inbox item;
 *   - record consent ONLY when the visitor explicitly ticked it (evidence: form id or transcript id);
 *   - write form_submitted / chatbot_lead_received.
 * Keys: source, dedupe_key, name, company, email, phone, message, form_id, page_url, need, offer,
 *       score, score_reason, transcript_id, consent_ticked, consent_wording, suppressed, payload
 */
create or replace function desk.ingest_lead(p jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_existing uuid;
  v_contact  uuid;
  v_org      uuid;
  v_item     uuid;
  v_source   text := p ->> 'source';
  v_said_no  boolean := false;
begin
  if v_source not in ('form', 'chatbot') then
    raise exception 'unknown source %', v_source using errcode = '22023';
  end if;

  select id into v_existing from desk.inbox_items where dedupe_key = p ->> 'dedupe_key';
  if v_existing is not null then
    return jsonb_build_object('inbox_item_id', v_existing, 'duplicate', true);
  end if;

  if nullif(p ->> 'email', '') is not null then
    select id, organisation_id into v_contact, v_org from desk.contacts where email = (p ->> 'email');
  end if;
  if v_contact is null and nullif(p ->> 'phone', '') is not null then
    select id, organisation_id into v_contact, v_org from desk.contacts where phone_e164 = (p ->> 'phone');
  end if;

  if v_org is null and nullif(p ->> 'company', '') is not null then
    select id into v_org from desk.organisations where lower(name) = lower(p ->> 'company') order by created_at limit 1;
    if v_org is null then
      insert into desk.organisations (name) values (left(p ->> 'company', 200)) returning id into v_org;
    end if;
  end if;

  if v_contact is null then
    insert into desk.contacts (organisation_id, full_name, email, phone_e164)
    values (v_org, nullif(left(p ->> 'name', 200), ''), nullif(p ->> 'email', ''), nullif(p ->> 'phone', ''))
    returning id into v_contact;
  else
    -- fill blanks only; a phone or email already used by someone else is left alone
    update desk.contacts c
       set full_name = coalesce(c.full_name, nullif(left(p ->> 'name', 200), '')),
           organisation_id = coalesce(c.organisation_id, v_org),
           email = case when c.email is null and nullif(p ->> 'email', '') is not null
                         and not exists (select 1 from desk.contacts x where x.email = (p ->> 'email'))
                        then p ->> 'email' else c.email end,
           phone_e164 = case when c.phone_e164 is null and nullif(p ->> 'phone', '') is not null
                              and not exists (select 1 from desk.contacts x where x.phone_e164 = (p ->> 'phone'))
                             then p ->> 'phone' else c.phone_e164 end
     where c.id = v_contact and c.forgotten_at is null;
    v_said_no := coalesce(desk.contact_consent_status(v_contact) = 'no', false);
  end if;

  insert into desk.inbox_items (source, contact_id, organisation_id, name, company, email, phone_e164, message,
                                form_id, page_url, need, offer, score, score_reason, transcript_id,
                                consent_ticked, consent_wording, suppressed, payload, dedupe_key)
  values (v_source, v_contact, v_org, nullif(p ->> 'name', ''), nullif(p ->> 'company', ''), nullif(p ->> 'email', ''),
          nullif(p ->> 'phone', ''), nullif(p ->> 'message', ''), nullif(p ->> 'form_id', ''), nullif(p ->> 'page_url', ''),
          nullif(p ->> 'need', ''), nullif(p ->> 'offer', ''), nullif(p ->> 'score', '')::smallint,
          nullif(p ->> 'score_reason', ''), nullif(p ->> 'transcript_id', ''),
          coalesce((p ->> 'consent_ticked')::boolean, false), nullif(p ->> 'consent_wording', ''),
          coalesce((p ->> 'suppressed')::boolean, false) or v_said_no,
          coalesce(p -> 'payload', '{}'::jsonb), p ->> 'dedupe_key')
  returning id into v_item;

  insert into desk.events (source, type, subject_type, subject_id, idempotency_key, payload)
  values (v_source, case v_source when 'form' then 'form_submitted' else 'chatbot_lead_received' end,
          'inbox_item', v_item::text, p ->> 'dedupe_key',
          jsonb_build_object('form_id', p ->> 'form_id', 'score', p ->> 'score', 'offer', p ->> 'offer',
                             'consent_ticked', coalesce((p ->> 'consent_ticked')::boolean, false)));

  -- Consent is recorded only for an explicit tick. A visitor who once said no and now ticks
  -- "yes" has asked us in writing to contact them: that new record becomes their current one.
  if coalesce((p ->> 'consent_ticked')::boolean, false) and nullif(p ->> 'consent_wording', '') is not null then
    insert into desk.consent_records (contact_id, status, method_key, wording_shown, evidence_type, evidence_ref)
    values (v_contact, 'yes', case v_source when 'form' then 'website_form' else 'chatbot' end,
            p ->> 'consent_wording',
            case v_source when 'form' then 'form' else 'chat_transcript' end,
            coalesce(nullif(p ->> 'transcript_id', ''), nullif(p ->> 'form_id', ''), v_item::text));
  end if;

  return jsonb_build_object('inbox_item_id', v_item, 'contact_id', v_contact, 'duplicate', false,
                            'suppressed', coalesce((p ->> 'suppressed')::boolean, false) or v_said_no);
end $$;

revoke all on function desk.ingest_lead(jsonb) from public, anon, authenticated;
grant execute on function desk.ingest_lead(jsonb) to service_role;

/*
 * Accept an inbox item into the pipeline. Reuses the contact's open lead if there is one.
 */
create or replace function desk.accept_inbox_item(p_id uuid, p_channel_key text, p_source_key text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  i       desk.inbox_items%rowtype;
  v_lead  uuid;
  v_new   boolean := false;
  v_notes text;
begin
  if not (desk.can('inbox.decide') and desk.can('pipeline.write')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into i from desk.inbox_items where id = p_id for update;
  if not found then raise exception 'No such inbox item' using errcode = 'P0002'; end if;
  if i.status <> 'new' then raise exception 'This item was already handled.' using errcode = 'DK011'; end if;

  if i.contact_id is not null then
    select id into v_lead from desk.leads where contact_id = i.contact_id and archived_at is null;
  end if;

  v_notes := concat_ws(E'\n',
    case i.source when 'form' then 'From the website form' || coalesce(' (' || i.form_id || ')', '') else 'From the website chatbot' end
      || ' on ' || to_char(i.received_at at time zone 'Africa/Johannesburg', 'DD Mon YYYY') || '.',
    'Message: ' || i.message,
    'Need: ' || i.need,
    'Offer: ' || i.offer,
    'Score reason: ' || i.score_reason);

  if v_lead is null then
    insert into desk.leads (contact_id, organisation_id, source_key, channel_key, first_contact_date, score, notes,
                            next_date, created_from, owner_id, created_by)
    values (i.contact_id, i.organisation_id, p_source_key, p_channel_key,
            (i.received_at at time zone 'Africa/Johannesburg')::date, i.score, v_notes,
            desk.today_sast() + 1, i.source, auth.uid(), auth.uid())
    returning id into v_lead;
    v_new := true;
  else
    update desk.leads
       set score = coalesce(i.score, score),
           notes = concat_ws(E'\n\n', notes, v_notes)
     where id = v_lead;
  end if;

  update desk.inbox_items
     set status = 'accepted', lead_id = v_lead, decided_at = now(), decided_by = auth.uid()
   where id = p_id;

  insert into desk.events (source, type, subject_type, subject_id, actor_id, payload)
  values ('manual', 'inbox_accepted', 'inbox_item', p_id::text, auth.uid(),
          jsonb_build_object('lead_id', v_lead, 'new_lead', v_new));

  return jsonb_build_object('lead_id', v_lead, 'new_lead', v_new);
end $$;

create or replace function desk.dismiss_inbox_item(p_id uuid, p_reason text)
returns void language plpgsql set search_path = '' as $$
begin
  if not desk.can('inbox.decide') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason.' using errcode = '23514';
  end if;
  update desk.inbox_items
     set status = 'dismissed', dismiss_reason = left(trim(p_reason), 300), decided_at = now(), decided_by = auth.uid()
   where id = p_id and status = 'new';
  if not found then raise exception 'This item was already handled.' using errcode = 'DK011'; end if;
  insert into desk.events (source, type, subject_type, subject_id, actor_id, payload)
  values ('manual', 'inbox_dismissed', 'inbox_item', p_id::text, auth.uid(), jsonb_build_object('reason', left(trim(p_reason), 300)));
end $$;

revoke all on function desk.accept_inbox_item(uuid, text, text), desk.dismiss_inbox_item(uuid, text) from public, anon;
grant execute on function desk.accept_inbox_item(uuid, text, text), desk.dismiss_inbox_item(uuid, text) to authenticated;

/*
 * Claim a notification before sending it. Returns true only for the first claim of a key
 * (or a retry of one that failed), so running a job twice never sends twice.
 */
create or replace function desk.claim_notification(p_key text, p_channel text, p_subject text, p_job_run uuid default null)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into desk.notifications (dedupe_key, channel, subject, job_run_id)
  values (p_key, p_channel, p_subject, p_job_run)
  on conflict (dedupe_key) do update
     set status = 'claimed', claimed_at = now(), error = null, job_run_id = excluded.job_run_id
   where desk.notifications.status = 'failed'
  returning id into v_id;
  return v_id is not null;
end $$;

revoke all on function desk.claim_notification(text, text, text, uuid) from public, anon, authenticated;
grant execute on function desk.claim_notification(text, text, text, uuid) to service_role;

-- Resend sends Desk's alerts and digest (its sender domain is already verified for aurion-assistant).
insert into desk.platforms (name, purpose, url, billing_cycle, status, notes) values
  ('Resend', 'Desk alerts and daily digest; aurion-assistant alert emails', 'https://resend.com', 'monthly', 'active',
   'Sender domain aurioncreative.com is shared with aurion-assistant')
on conflict (name) do nothing;

