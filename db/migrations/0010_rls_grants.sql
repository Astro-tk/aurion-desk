-- ---------------------------------------------------------------------
-- 17. Triggers: updated_at and audit on every business table
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'members', 'org_types', 'lead_sources', 'contact_methods', 'activity_purposes', 'channels',
    'organisations', 'contacts', 'leads', 'activities', 'tasks', 'targets', 'scorecard_entries',
    'platforms', 'saved_views', 'app_settings'
  ] loop
    execute format('create trigger %I before update on desk.%I for each row execute function desk.tg_touch_updated_at()',
                   t || '_touch', t);
  end loop;

  foreach t in array array[
    'members', 'role_capabilities', 'org_types', 'lead_sources', 'contact_methods', 'activity_purposes', 'channels',
    'app_settings', 'organisations', 'contacts', 'leads', 'consent_records', 'activities', 'inbox_items',
    'blueprint_documents', 'blueprint_sections', 'tasks', 'targets', 'scorecard_entries', 'platforms',
    'import_batches', 'saved_views', 'suppressions'
  ] loop
    execute format('create trigger %I after insert or update or delete on desk.%I for each row execute function desk.tg_audit()',
                   t || '_audit', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 18. Grants. anon gets nothing at all. authenticated gets table rights that
--     RLS then narrows. Append-only tables never get UPDATE or DELETE.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema desk from anon, public;
revoke all on all sequences in schema desk from anon, public;
revoke all on all functions in schema desk from anon, public;
alter default privileges in schema desk revoke all on tables    from anon, public;
alter default privileges in schema desk revoke all on functions from anon, public;

grant select on all tables in schema desk to authenticated;
grant insert, update on
  desk.org_types, desk.lead_sources, desk.contact_methods, desk.activity_purposes, desk.channels,
  desk.app_settings, desk.members, desk.organisations, desk.contacts, desk.leads, desk.activities,
  desk.inbox_items, desk.blueprint_documents, desk.blueprint_sections, desk.tasks,
  desk.targets, desk.scorecard_entries, desk.platforms, desk.saved_views, desk.import_batches
  to authenticated;
grant insert on desk.consent_records, desk.events to authenticated;
grant delete on desk.saved_views to authenticated;
grant usage on all sequences in schema desk to authenticated;

grant execute on function
  desk.session_is_aal2(), desk.can(text), desk.is_member(), desk.today_sast(),
  desk.request_header(text), desk.current_actor_kind(), desk.current_event_source(),
  desk.contact_consent_status(uuid), desk.forget_contact(uuid, text, text)
  to authenticated;

-- Server-only helpers: service role only.
grant execute on function
  desk.audit_auth_event(text, uuid, jsonb), desk.auth_lockout_seconds(text, text),
  desk.rate_limit_take(text, int, int)
  to service_role;

grant all on all tables    in schema desk to service_role;
grant all on all sequences in schema desk to service_role;
grant execute on all functions in schema desk to service_role;

-- The service role may not rewrite history either (triggers still refuse; this is belt and braces).
revoke update, delete, truncate on desk.audit_log, desk.consent_records, desk.stage_history from service_role;


-- ---------------------------------------------------------------------
-- 19. Row Level Security: on for EVERY table, aal2 required by every policy
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'desk' loop
    -- ENABLE, not FORCE: security-definer helpers (desk.can, triggers) run as the
    -- table owner and must read desk.members without recursing into its own policy.
    execute format('alter table desk.%I enable row level security', t);
  end loop;
end $$;

-- Lookup lists: any member reads; owner edits.
do $$
declare t text;
begin
  foreach t in array array['stages', 'roles', 'org_types', 'lead_sources', 'contact_methods',
                           'activity_purposes', 'channels', 'app_settings', 'role_capabilities'] loop
    execute format('create policy %I on desk.%I for select to authenticated using (desk.is_member())', t || '_read', t);
  end loop;
  foreach t in array array['org_types', 'lead_sources', 'contact_methods', 'activity_purposes', 'channels', 'app_settings'] loop
    execute format('create policy %I on desk.%I for insert to authenticated with check (desk.can(''settings.write''))', t || '_insert', t);
    execute format('create policy %I on desk.%I for update to authenticated using (desk.can(''settings.write'')) with check (desk.can(''settings.write''))', t || '_update', t);
  end loop;
end $$;

-- Pipeline data
do $$
declare t text;
begin
  foreach t in array array['organisations', 'contacts', 'leads', 'activities'] loop
    execute format('create policy %I on desk.%I for select to authenticated using (desk.can(''pipeline.read''))', t || '_read', t);
    execute format('create policy %I on desk.%I for insert to authenticated with check (desk.can(''pipeline.write''))', t || '_insert', t);
    execute format('create policy %I on desk.%I for update to authenticated using (desk.can(''pipeline.write'')) with check (desk.can(''pipeline.write''))', t || '_update', t);
  end loop;
end $$;

create policy stage_history_read on desk.stage_history for select to authenticated using (desk.can('pipeline.read'));
create policy consent_read   on desk.consent_records for select to authenticated using (desk.can('pipeline.read'));
create policy consent_insert on desk.consent_records for insert to authenticated with check (desk.can('pipeline.write'));

create policy inbox_read   on desk.inbox_items for select to authenticated using (desk.can('inbox.read'));
create policy inbox_update on desk.inbox_items for update to authenticated
  using (desk.can('inbox.decide')) with check (desk.can('inbox.decide'));
-- No insert policy: only the ingest endpoints (service role) create inbox items.

create policy events_read   on desk.events for select to authenticated using (desk.can('events.read'));
create policy events_insert on desk.events for insert to authenticated
  with check (desk.can('events.write') and actor_id = auth.uid());

create policy audit_read on desk.audit_log for select to authenticated using (desk.can('audit.read'));

create policy bp_docs_read     on desk.blueprint_documents for select to authenticated using (desk.can('blueprint.read'));
create policy bp_docs_insert   on desk.blueprint_documents for insert to authenticated with check (desk.can('blueprint.import'));
create policy bp_docs_update   on desk.blueprint_documents for update to authenticated
  using (desk.can('blueprint.import')) with check (desk.can('blueprint.import'));
create policy bp_sec_read      on desk.blueprint_sections for select to authenticated using (desk.can('blueprint.read'));
create policy bp_sec_insert    on desk.blueprint_sections for insert to authenticated with check (desk.can('blueprint.import'));
create policy bp_sec_update    on desk.blueprint_sections for update to authenticated
  using (desk.can('blueprint.import')) with check (desk.can('blueprint.import'));
create policy tasks_read       on desk.tasks for select to authenticated using (desk.can('blueprint.read'));
create policy tasks_insert     on desk.tasks for insert to authenticated with check (desk.can('blueprint.write'));
create policy tasks_update     on desk.tasks for update to authenticated
  using (desk.can('blueprint.write')) with check (desk.can('blueprint.write'));

create policy targets_read     on desk.targets for select to authenticated using (desk.can('scorecard.read'));
create policy targets_insert   on desk.targets for insert to authenticated with check (desk.can('settings.write'));
create policy targets_update   on desk.targets for update to authenticated
  using (desk.can('settings.write')) with check (desk.can('settings.write'));
create policy score_read       on desk.scorecard_entries for select to authenticated using (desk.can('scorecard.read'));
create policy score_insert     on desk.scorecard_entries for insert to authenticated with check (desk.can('scorecard.write'));
create policy score_update     on desk.scorecard_entries for update to authenticated
  using (desk.can('scorecard.write')) with check (desk.can('scorecard.write'));

create policy platforms_read   on desk.platforms for select to authenticated using (desk.can('platforms.read'));
create policy platforms_insert on desk.platforms for insert to authenticated with check (desk.can('platforms.write'));
create policy platforms_update on desk.platforms for update to authenticated
  using (desk.can('platforms.write')) with check (desk.can('platforms.write'));

create policy members_read on desk.members for select to authenticated
  using (desk.session_is_aal2() and (user_id = auth.uid() or desk.can('settings.read')));
create policy members_update on desk.members for update to authenticated
  using (desk.can('settings.write')) with check (desk.can('settings.write'));

create policy imports_read   on desk.import_batches for select to authenticated
  using (desk.can('pipeline.import') or desk.can('blueprint.import'));
create policy imports_insert on desk.import_batches for insert to authenticated
  with check (desk.can('pipeline.import') or desk.can('blueprint.import'));
create policy imports_update on desk.import_batches for update to authenticated
  using (desk.can('pipeline.import') or desk.can('blueprint.import'))
  with check (desk.can('pipeline.import') or desk.can('blueprint.import'));

create policy views_all on desk.saved_views for all to authenticated
  using (desk.is_member() and member_id = auth.uid())
  with check (desk.is_member() and member_id = auth.uid());

create policy job_runs_read      on desk.job_runs      for select to authenticated using (desk.can('settings.read'));
create policy notifications_read on desk.notifications for select to authenticated using (desk.can('settings.read'));
create policy instance_read      on desk.instance      for select to authenticated using (desk.is_member());

-- No policies at all (service role only): suppressions, auth_attempts,
-- rate_limit_buckets, ingest_nonces. With RLS on and no policy, authenticated sees nothing.
