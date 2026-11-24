-- ---------------------------------------------------------------------
-- 0014 Blueprint: apply an import (keeping ticks), and events for ticking tasks.
-- ---------------------------------------------------------------------

/*
 * Applies a parsed blueprint in one transaction. p is built by applyPayload() in
 * src/modules/blueprint/diff.ts after you have seen the diff:
 *   expected_version  the version the diff was computed against (stops a stale apply)
 *   doc               title, doc_date, source_markdown, sha256
 *   sections[]        key, parent_key, level, number, title, position, run_date, body_markdown
 *   tasks[]           match_key, section_key, title, position, due_date, source_ref
 *   renames[]         id, match_key: existing tasks (reworded or restored) that take a new key
 * Ticks (done_at) are never touched here.
 */
create or replace function desk.apply_blueprint(p jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_current int;
  v_version int;
  v_doc     uuid;
  s         jsonb;
  t         jsonb;
  r         jsonb;
  v_section uuid;
  v_task    uuid;
  v_added   int := 0;
  v_updated int := 0;
  v_removed int := 0;
begin
  if not (desk.can('blueprint.import') and desk.can('blueprint.write')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select version into v_current from desk.blueprint_documents where is_current;
  if v_current is distinct from (p ->> 'expected_version')::int then
    raise exception 'The blueprint changed since this diff was made. Upload it again.' using errcode = 'DK012';
  end if;
  v_version := coalesce((select max(version) from desk.blueprint_documents), 0) + 1;

  update desk.blueprint_documents set is_current = false where is_current;
  insert into desk.blueprint_documents (version, title, doc_date, source_markdown, sha256, is_current, imported_by)
  values (v_version, p -> 'doc' ->> 'title', nullif(p -> 'doc' ->> 'doc_date', '')::date,
          p -> 'doc' ->> 'source_markdown', p -> 'doc' ->> 'sha256', true, auth.uid())
  returning id into v_doc;

  -- Sections: upsert by key (parents come first in document order).
  for s in select * from jsonb_array_elements(p -> 'sections') loop
    insert into desk.blueprint_sections (key, parent_id, level, number, title, position, run_date, body_markdown, document_id, removed_at)
    values (s ->> 'key',
            (select id from desk.blueprint_sections where key = s ->> 'parent_key'),
            (s ->> 'level')::smallint, nullif(s ->> 'number', ''), s ->> 'title', (s ->> 'position')::int,
            nullif(s ->> 'run_date', '')::date, coalesce(s ->> 'body_markdown', ''), v_doc, null)
    on conflict (key) do update
       set parent_id = excluded.parent_id, level = excluded.level, number = excluded.number,
           title = excluded.title, position = excluded.position, run_date = excluded.run_date,
           body_markdown = excluded.body_markdown, document_id = v_doc, removed_at = null;
  end loop;
  update desk.blueprint_sections set removed_at = now()
   where removed_at is null and key not in (select x ->> 'key' from jsonb_array_elements(p -> 'sections') x);

  -- Reworded and restored tasks take their new key first, keeping their tick.
  for r in select * from jsonb_array_elements(coalesce(p -> 'renames', '[]'::jsonb)) loop
    update desk.tasks set match_key = r ->> 'match_key', removed_at = null
     where id = (r ->> 'id')::uuid and kind = 'blueprint';
  end loop;

  for t in select * from jsonb_array_elements(p -> 'tasks') loop
    select id into v_section from desk.blueprint_sections where key = t ->> 'section_key';
    select id into v_task from desk.tasks where kind = 'blueprint' and match_key = t ->> 'match_key' and removed_at is null;
    if v_task is null then
      insert into desk.tasks (kind, title, section_id, source_ref, match_key, position, due_date, created_by)
      values ('blueprint', t ->> 'title', v_section, t ->> 'source_ref', t ->> 'match_key', (t ->> 'position')::int,
              nullif(t ->> 'due_date', '')::date, auth.uid());
      v_added := v_added + 1;
    else
      update desk.tasks
         set title = t ->> 'title', section_id = v_section, source_ref = t ->> 'source_ref',
             position = (t ->> 'position')::int, due_date = nullif(t ->> 'due_date', '')::date
       where id = v_task;
      v_updated := v_updated + 1;
    end if;
  end loop;

  update desk.tasks set removed_at = now()
   where kind = 'blueprint' and removed_at is null
     and match_key not in (select x ->> 'match_key' from jsonb_array_elements(p -> 'tasks') x);
  get diagnostics v_removed = row_count;

  insert into desk.events (source, type, subject_type, subject_id, actor_id, payload)
  values ('import', 'blueprint_imported', 'blueprint_document', v_doc::text, auth.uid(),
          jsonb_build_object('version', v_version, 'added', v_added, 'updated', v_updated, 'removed', v_removed));

  return jsonb_build_object('version', v_version, 'added', v_added, 'updated', v_updated, 'removed', v_removed);
end $$;

revoke all on function desk.apply_blueprint(jsonb) from public, anon;
grant execute on function desk.apply_blueprint(jsonb) to authenticated;

-- Ticking and unticking a task writes an event (task_done / task_reopened).
create or replace function desk.tg_task_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.done_at is distinct from old.done_at then
    insert into desk.events (source, type, subject_type, subject_id, actor_id, payload)
    values (desk.current_event_source(), case when new.done_at is null then 'task_reopened' else 'task_done' end,
            'task', new.id::text, auth.uid(), jsonb_build_object('kind', new.kind, 'due_date', new.due_date));
  end if;
  return null;
end $$;
create trigger tasks_event_tg after update of done_at on desk.tasks
  for each row execute function desk.tg_task_event();

create or replace function desk.tg_task_created_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'adhoc' then
    insert into desk.events (source, type, subject_type, subject_id, actor_id, payload)
    values (desk.current_event_source(), 'task_created', 'task', new.id::text, auth.uid(), jsonb_build_object('due_date', new.due_date));
  end if;
  return null;
end $$;
create trigger tasks_created_event_tg after insert on desk.tasks
  for each row execute function desk.tg_task_created_event();
