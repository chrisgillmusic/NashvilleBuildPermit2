import Link from 'next/link';
import { SavedFilterBar } from '@/components/live/saved-filter-bar';
import { prisma } from '@/lib/db';
import { formatCurrency, formatDate } from '@/lib/format';

function parseRange(value: string | null | undefined): number | null {
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export default async function LivePage({
  searchParams
}: {
  searchParams: {
    zip?: string;
    subtype?: string;
    q?: string;
    phase?: string;
    repeatedGc?: string;
    min?: string;
    max?: string;
  };
}) {
  const [savedFilters, watchlist, baseProjects] = await Promise.all([
    prisma.savedFilter.findMany({ orderBy: { updatedAt: 'desc' }, take: 12 }),
    prisma.gcWatchlist.findMany({ include: { gcEntity: true }, orderBy: { updatedAt: 'desc' }, take: 12 }),
    prisma.project.findMany({
      where: {
        isCommercial: true,
        isNashvilleArea: true,
        ...(searchParams.zip ? { zip: searchParams.zip } : {}),
        ...(searchParams.subtype
          ? { permitSubtypeDescription: { contains: searchParams.subtype, mode: 'insensitive' } }
          : {}),
        ...(searchParams.phase ? { phaseBucket: searchParams.phase } : {}),
        ...(searchParams.q
          ? {
              OR: [
                { normalizedContactName: { contains: searchParams.q.toUpperCase(), mode: 'insensitive' } },
                { purpose: { contains: searchParams.q, mode: 'insensitive' } },
                { permitSubtypeDescription: { contains: searchParams.q, mode: 'insensitive' } }
              ]
            }
          : {}),
        ...((parseRange(searchParams.min) || parseRange(searchParams.max))
          ? {
              constructionCost: {
                ...(parseRange(searchParams.min) ? { gte: parseRange(searchParams.min)! } : {}),
                ...(parseRange(searchParams.max) ? { lte: parseRange(searchParams.max)! } : {})
              }
            }
          : {})
      },
      orderBy: [{ scoreOverride: 'desc' }, { score: 'desc' }, { dateIssued: 'desc' }],
      take: 300
    })
  ]);

  const projects = searchParams.repeatedGc
    ? baseProjects.filter((project) => {
        const count = baseProjects.filter((candidate) => candidate.normalizedContactName && candidate.normalizedContactName === project.normalizedContactName).length;
        return count >= 2;
      })
    : baseProjects;

  const currentQuery = {
    ...(searchParams.q ? { q: searchParams.q } : {}),
    ...(searchParams.zip ? { zip: searchParams.zip } : {}),
    ...(searchParams.subtype ? { subtype: searchParams.subtype } : {}),
    ...(searchParams.phase ? { phase: searchParams.phase } : {}),
    ...(searchParams.min ? { min: searchParams.min } : {}),
    ...(searchParams.max ? { max: searchParams.max } : {}),
    ...(searchParams.repeatedGc ? { repeatedGc: searchParams.repeatedGc } : {})
  };

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Intelligence Mode</h1>
          <p className="text-sm text-slate-700">Filter current commercial Nashville projects by timing, valuation, subtype, and GC/contact activity.</p>
        </div>
        <Link className="text-sm font-semibold text-amber-700 underline" href="/admin">Admin</Link>
      </header>

      <form className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <input className="rounded border border-slate-300 p-2 text-sm" name="q" placeholder="contact / gc / keyword" defaultValue={searchParams.q} />
        <input className="rounded border border-slate-300 p-2 text-sm" name="zip" placeholder="zip" defaultValue={searchParams.zip} />
        <input className="rounded border border-slate-300 p-2 text-sm" name="subtype" placeholder="subtype" defaultValue={searchParams.subtype} />
        <select className="rounded border border-slate-300 p-2 text-sm" name="phase" defaultValue={searchParams.phase || ''}>
          <option value="">All phases</option>
          <option value="ON DECK">ON DECK</option>
          <option value="IN MOTION">IN MOTION</option>
          <option value="CLOSING OUT">CLOSING OUT</option>
        </select>
        <input className="rounded border border-slate-300 p-2 text-sm" name="min" placeholder="min valuation" defaultValue={searchParams.min} />
        <input className="rounded border border-slate-300 p-2 text-sm" name="max" placeholder="max valuation" defaultValue={searchParams.max} />
        <label className="flex items-center gap-2 rounded border border-slate-300 p-2 text-sm">
          <input defaultChecked={Boolean(searchParams.repeatedGc)} name="repeatedGc" type="checkbox" value="1" />
          Repeated GC activity only
        </label>
        <button className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white sm:col-span-3" type="submit">Apply Filters</button>
      </form>

      <SavedFilterBar
        filters={savedFilters.map((f) => ({
          id: f.id,
          name: f.name,
          queryJson: (f.queryJson || {}) as Record<string, string>
        }))}
        currentQuery={currentQuery}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">GC Watchlist</h2>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {watchlist.map((row) => (
            <li key={row.id}>
              {row.gcEntity.canonicalName} {row.notes ? `- ${row.notes}` : ''}
            </li>
          ))}
          {!watchlist.length ? <li>No watchlist entries yet.</li> : null}
        </ul>
      </section>

      <section className="space-y-2">
        {projects.map((project) => (
          <article key={project.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">{project.phaseBucket}</p>
            <h2 className="text-base font-semibold">{project.address || 'Address pending'}</h2>
            <p className="text-sm text-slate-700">{project.permitSubtypeDescription || 'Subtype N/A'} • {formatCurrency(Number(project.constructionCost || 0))} • {formatDate(project.dateIssued)}</p>
            <p className="text-sm text-slate-700">Contact: {project.contactRaw || 'Not listed'} • Score {(project.scoreOverride ?? project.score ?? 0).toFixed(1)}</p>
            <p className="mt-1 text-sm text-slate-800">{project.purpose || 'Scope not provided'}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
