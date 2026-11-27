-- ---------------------------------------------------------------------
-- 0016 Bio links analytics (aurioncreative.com/links): aggregates website events.
-- Runs as the caller, so RLS applies: only members with events.read see numbers.
-- ---------------------------------------------------------------------

create index if not exists events_website_links_idx on desk.events (type, occurred_at)
  where source = 'website' and type in ('link_page_view', 'link_click');

create or replace function desk.link_stats(p_from timestamptz, p_to timestamptz, p_page text default 'bio')
returns jsonb language sql stable set search_path = '' as $$
  with e as (
    select type, subject_id, anon_id, payload,
           (occurred_at at time zone 'Africa/Johannesburg')::date as day
      from desk.events
     where source = 'website'
       and type in ('link_page_view', 'link_click')
       and occurred_at >= p_from and occurred_at < p_to
       and coalesce(payload ->> 'page', 'bio') = p_page
  ),
  views as (select * from e where type = 'link_page_view'),
  clicks as (select * from e where type = 'link_click')
  select jsonb_build_object(
    'views',    (select count(*) from views),
    'clicks',   (select count(*) from clicks),
    'visitors', (select count(distinct (day, anon_id)) from views where anon_id is not null),
    'clickers', (select count(distinct (day, anon_id)) from clicks where anon_id is not null),
    'by_link', coalesce((
      select jsonb_agg(x order by x.clicks desc, x.link)
        from (select subject_id as link, max(payload ->> 'label') as label, count(*)::int as clicks
                from clicks group by subject_id) x), '[]'::jsonb),
    'by_source', coalesce((
      select jsonb_agg(x order by x.views desc, x.source)
        from (select s.source,
                     (select count(*) from views v where v.payload ->> 'via' = s.source)::int as views,
                     (select count(*) from clicks c where c.payload ->> 'via' = s.source)::int as clicks
                from (select distinct payload ->> 'via' as source from e) s) x), '[]'::jsonb),
    'by_device', coalesce((
      select jsonb_object_agg(device, n)
        from (select coalesce(payload ->> 'device', 'unknown') as device, count(*)::int as n
                from views group by 1) x), '{}'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(x order by x.day)
        from (select day,
                     count(*) filter (where type = 'link_page_view')::int as views,
                     count(*) filter (where type = 'link_click')::int as clicks
                from e group by day) x), '[]'::jsonb)
  )
$$;

revoke all on function desk.link_stats(timestamptz, timestamptz, text) from public, anon;
grant execute on function desk.link_stats(timestamptz, timestamptz, text) to authenticated, service_role;
