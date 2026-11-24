import Link from 'next/link';
import { ActionForm } from '@/components/forms';
import { EmptyState, PageHeader } from '@/components/ui';
import { memberCan, requireMember } from '@/lib/auth/session';
import { userDb } from '@/lib/db/server';
import { getLists } from '@/lib/lists';
import { deleteViewAction, saveViewAction } from '../actions';
import { Board } from '../Board';
import { LeadTable } from '../components';
import { SORTS, filtersToQuery, parseFilters } from '../filters';
import { LEAD_LIMIT, listLeads, listSavedViews } from '../queries';

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requireMember();
  const f = parseFilters(await searchParams);
  const db = await userDb();
  const [lists, leads, views, canWrite, canImport, canExport] = await Promise.all([
    getLists(db),
    listLeads(db, f),
    listSavedViews(db, member.userId),
    memberCan('pipeline.write'),
    memberCan('pipeline.import'),
    memberCan('data.export'),
  ]);
  const layout = f.layout ?? 'table';
  const query = filtersToQuery(f);
  const anyFilter = Boolean(f.q || f.stage || f.channel || f.source || f.type || f.consent || f.overdue || f.archived);
  const overdue = leads.filter((l) => l.is_overdue).length;

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={`${leads.length}${leads.length === LEAD_LIMIT ? '+' : ''} lead${leads.length === 1 ? '' : 's'}${overdue ? `, ${overdue} overdue` : ''}`}
        actions={
          <>
            {canWrite ? (
              <Link href="/pipeline/new" className="btn-primary">
                Add lead
              </Link>
            ) : null}
            {canImport ? (
              <Link href="/pipeline/import" className="btn">
                Import CSV
              </Link>
            ) : null}
            {canExport ? (
              <a href={`/pipeline/export${query}`} className="btn">
                Export this view
              </a>
            ) : null}
          </>
        }
      />

      <form method="get" className="card mb-3 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="layout" value={layout} />
        <input className="input" name="q" defaultValue={f.q} placeholder="Search name, firm, email, town" aria-label="Search" />
        <select className="input" name="stage" defaultValue={f.stage ?? ''} aria-label="Stage">
          <option value="">All stages</option>
          {lists.stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="input" name="channel" defaultValue={f.channel ?? ''} aria-label="Channel">
          <option value="">All channels</option>
          {lists.channels.map((c) => (
            <option key={c.key} value={c.key}>
              {c.number ? `${c.number}. ` : ''}
              {c.label}
            </option>
          ))}
        </select>
        <select className="input" name="source" defaultValue={f.source ?? ''} aria-label="Source">
          <option value="">All sources</option>
          {lists.sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="input" name="type" defaultValue={f.type ?? ''} aria-label="Type">
          <option value="">All types</option>
          {lists.orgTypes.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="input" name="consent" defaultValue={f.consent ?? ''} aria-label="Consent">
          <option value="">Any consent</option>
          <option value="yes">Consent yes</option>
          <option value="asked">Asked</option>
          <option value="none">Not asked</option>
          <option value="no">Said no</option>
        </select>
        <select className="input" name="sort" defaultValue={f.sort ?? 'next_date'} aria-label="Sort">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              Sort: {v}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" name="overdue" value="1" defaultChecked={Boolean(f.overdue)} /> Overdue only
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" name="archived" value="1" defaultChecked={Boolean(f.archived)} /> Archived
          </label>
          <button className="btn btn-sm">Apply</button>
          {anyFilter ? (
            <Link href={`/pipeline${filtersToQuery({ layout })}`} className="text-xs underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-3">Show as</span>
        <Link href={`/pipeline${filtersToQuery(f, { layout: 'table' })}`} className={layout === 'table' ? 'chip-accent' : 'chip'}>
          Table
        </Link>
        <Link href={`/pipeline${filtersToQuery(f, { layout: 'board' })}`} className={layout === 'board' ? 'chip-accent' : 'chip'}>
          Board
        </Link>
        <span className="ml-2 text-ink-3">Views</span>
        {views.map((v) => (
          <span key={v.id} className="chip">
            <Link href={`/pipeline${v.query.search}`}>{v.name}</Link>
            <form action={deleteViewAction} className="inline">
              <input type="hidden" name="id" value={v.id} />
              <button aria-label={`Delete view ${v.name}`} className="text-ink-3">
                x
              </button>
            </form>
          </span>
        ))}
        {anyFilter || layout === 'board' ? (
          <details className="inline-block">
            <summary className="chip cursor-pointer">Save this view</summary>
            <div className="card mt-2 p-2">
              <ActionForm action={saveViewAction} submitLabel="Save view" className="flex flex-wrap items-end gap-2" submitClass="btn btn-sm">
                <input type="hidden" name="search" value={query} />
                <input className="input w-48" name="name" placeholder="View name" aria-label="View name" required />
              </ActionForm>
            </div>
          </details>
        ) : null}
      </div>

      {leads.length === 0 ? (
        anyFilter ? (
          <EmptyState sentence="No leads match these filters." actionLabel="Clear filters" actionHref="/pipeline" />
        ) : (
          <EmptyState sentence="No leads yet." actionLabel={canImport ? 'Import your tracker' : 'Add a lead'} actionHref={canImport ? '/pipeline/import' : '/pipeline/new'} />
        )
      ) : layout === 'board' ? (
        <Board leads={leads} lists={lists} canWrite={canWrite} />
      ) : (
        <LeadTable leads={leads} lists={lists} />
      )}
    </>
  );
}
