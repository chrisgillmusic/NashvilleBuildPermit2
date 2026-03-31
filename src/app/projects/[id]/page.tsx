import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCurrency, formatPhone } from '@/lib/format';
import { getProjectById } from '@/lib/permits/live';

export const dynamic = 'force-dynamic';

function formatPhoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export default async function ProjectDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { trade?: string } }) {
  const project = await getProjectById(params.id, searchParams.trade || '');
  if (!project) notFound();
  const showWhyItMatters = project.whyItMatters.toLowerCase() !== project.readableSummary.toLowerCase();
  const showLikelyTrades = project.likelyTrades.length > 0 && project.likelyTrades.length <= 4;

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-16 pt-6 text-stone-100 sm:px-6">
      <Link href="/" className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-300">
        Back to app
      </Link>

      <section className="mt-4 rounded-[28px] border border-white/10 bg-[rgba(15,16,18,0.82)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-400">{project.neighborhood}</div>
            <h1 className="mt-2 font-display text-4xl leading-none text-white">{project.address || 'Address pending'}</h1>
            <p className="mt-3 text-sm text-stone-300">
              Permit {project.permitNumber} • {project.permitSubtype || project.permitType}
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-stone-100">{project.readableSummary || 'No project summary listed on the permit.'}</p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
              {project.contactPhone ? (
                <a href={formatPhoneHref(project.contactPhone)} className="rounded-full bg-amber-400 px-4 py-2 text-stone-950 active:scale-[0.98]">
                  Call {formatPhone(project.contactPhone)}
                </a>
              ) : null}
              <a href={project.mapsUrl} target="_blank" rel="noreferrer" className="rounded-full border border-white/20 px-4 py-2 text-stone-100 active:scale-[0.98]">
                Open map
              </a>
            </div>
          </div>
          <div className="rounded-2xl bg-black/40 px-4 py-3 text-white ring-1 ring-white/10">
            <div className="text-[11px] uppercase tracking-[0.2em] text-stone-400">Estimated value</div>
            <div className="mt-2 text-2xl font-semibold">{formatCurrency(project.valuation)}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-amber-400/10 p-4 ring-1 ring-amber-300/20">
            {showWhyItMatters ? <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200">Why it matters</div> : null}
            {showWhyItMatters ? <p className="mt-2 text-sm leading-6 text-stone-100">{project.whyItMatters}</p> : null}
            {showLikelyTrades ? (
              <>
                <div className={showWhyItMatters ? 'mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400' : 'text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400'}>
                  Likely trades involved
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-200">{project.likelyTrades.join(', ')}</p>
              </>
            ) : null}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">Key fields</div>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-stone-400">Issue date</dt>
                <dd className="text-right text-stone-100">{project.issueDateLabel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-stone-400">Contact</dt>
                <dd className="text-right text-stone-100">
                  <a href={`/contacts?name=${encodeURIComponent(project.contactName)}`} className="underline decoration-stone-300 underline-offset-4">
                    {project.contactName}
                  </a>
                </dd>
              </div>
              {project.contactPhone ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-400">Phone</dt>
                  <dd className="text-right text-stone-100">
                    <a href={formatPhoneHref(project.contactPhone)} className="underline decoration-stone-300 underline-offset-4">
                      {formatPhone(project.contactPhone)}
                    </a>
                  </dd>
                </div>
              ) : null}
              {project.contactEmail ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-400">Email</dt>
                  <dd className="text-right text-stone-100">
                    <a href={`mailto:${project.contactEmail}`} className="underline decoration-stone-300 underline-offset-4">
                      {project.contactEmail}
                    </a>
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-stone-400">Coordinates</dt>
                <dd className="text-right text-stone-100">
                  {project.coordinates.lat !== null && project.coordinates.lon !== null
                    ? `${project.coordinates.lat.toFixed(5)}, ${project.coordinates.lon.toFixed(5)}`
                    : 'Not listed'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-stone-400">Google Maps</dt>
                <dd className="text-right">
                  <a href={project.mapsUrl} target="_blank" rel="noreferrer" className="font-semibold text-stone-100 underline decoration-stone-300 underline-offset-4">
                    Open map
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">Raw permit details</div>
            <dl className="mt-3 space-y-3 text-sm">
              {Object.entries(project.rawFields).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-white/5 pb-3 last:border-b-0 last:pb-0">
                  <dt className="text-stone-400">{label}</dt>
                  <dd className="max-w-[58%] text-right text-stone-100">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </main>
  );
}
