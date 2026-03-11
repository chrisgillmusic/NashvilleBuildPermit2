import Link from 'next/link';
import { formatCurrency } from '@/lib/format';
import { getProjectsByContact } from '@/lib/permits/live';
import { projectMatchesTrade } from '@/lib/permits/trade-utils';
import type { DashboardFilters } from '@/lib/permits/types';

export const dynamic = 'force-dynamic';

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatPhoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export default async function ContactPage({
  searchParams
}: {
  searchParams: { name?: string; minBudget?: string; maxBudget?: string; dateFrom?: string; dateTo?: string; permitType?: string; neighborhood?: string; contractorQuery?: string; sort?: string; mode?: string; trade?: string };
}) {
  const name = searchParams.name?.trim() || '';
  const mode = searchParams.mode || 'all-jobs';
  const trade = searchParams.trade || '';
  const filters: Partial<DashboardFilters> = {
    minBudget: toNumber(searchParams.minBudget),
    maxBudget: toNumber(searchParams.maxBudget),
    dateFrom: searchParams.dateFrom,
    dateTo: searchParams.dateTo,
    permitType: searchParams.permitType,
    neighborhood: searchParams.neighborhood,
    contractorQuery: searchParams.contractorQuery,
    sort: searchParams.sort as DashboardFilters['sort'] | undefined
  };
  const payload = await getProjectsByContact(name, filters);
  const projects = mode === 'my-trade' && trade ? payload.projects.filter((project) => projectMatchesTrade(project, trade)) : payload.projects;

  const totalValuation = projects.reduce((sum, project) => sum + project.valuation, 0);
  const leadPhone = projects.find((project) => project.contactPhone)?.contactPhone || null;
  const leadEmail = projects.find((project) => project.contactEmail)?.contactEmail || null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6">
      <Link href="/" className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-600">
        Back to app
      </Link>

      <section className="mt-4 rounded-[28px] border border-white/70 bg-white/92 p-6 shadow-[0_24px_80px_rgba(43,37,20,0.12)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">Builder view</div>
            <h1 className="mt-2 font-display text-4xl leading-none text-stone-950">{name || 'No contact selected'}</h1>
            <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
              {leadPhone ? (
                <a href={formatPhoneHref(leadPhone)} className="rounded-full bg-stone-950 px-4 py-2 text-white active:scale-[0.98]">
                  Call
                </a>
              ) : null}
              {leadEmail ? (
                <a href={`mailto:${leadEmail}`} className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 active:scale-[0.98]">
                  Email
                </a>
              ) : null}
              {!leadPhone && !leadEmail ? <div className="rounded-full bg-stone-100 px-4 py-2 text-stone-500">Contact info unavailable</div> : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center text-sm sm:min-w-[250px]">
            <div className="rounded-2xl bg-stone-950 px-4 py-4 text-white">
              <div className="text-[11px] uppercase tracking-[0.2em] text-stone-300">Projects</div>
              <div className="mt-2 text-2xl font-semibold">{projects.length}</div>
            </div>
            <div className="rounded-2xl bg-amber-100 px-4 py-4 text-stone-900">
              <div className="text-[11px] uppercase tracking-[0.2em] text-amber-900/70">Valuation</div>
              <div className="mt-2 text-xl font-semibold">{formatCurrency(totalValuation)}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {projects.map((project) => (
            <article key={project.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950">{project.address || 'Address pending'}</h2>
                  <p className="mt-1 text-sm text-stone-600">
                    Permit {project.permitNumber} • {project.permitSubtype || project.permitType}
                  </p>
                </div>
                <div className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-stone-900 ring-1 ring-stone-200">
                  {formatCurrency(project.valuation)}
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-stone-700">{project.readableSummary}</p>
              <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                <Link href={`/projects/${project.id}`} className="rounded-full bg-stone-950 px-4 py-2 text-white active:scale-[0.98]">
                  Open project
                </Link>
                <a href={project.mapsUrl} target="_blank" rel="noreferrer" className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 active:scale-[0.98]">
                  Google Maps
                </a>
                {project.contactPhone ? (
                  <a href={formatPhoneHref(project.contactPhone)} className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 active:scale-[0.98]">
                    Call
                  </a>
                ) : null}
                {project.contactEmail ? (
                  <a href={`mailto:${project.contactEmail}`} className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 active:scale-[0.98]">
                    Email
                  </a>
                ) : null}
              </div>
            </article>
          ))}
          {!projects.length ? <p className="text-sm text-stone-500">No projects found for that contact in the current filtered dataset.</p> : null}
        </div>
      </section>
    </main>
  );
}
