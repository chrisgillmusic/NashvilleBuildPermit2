import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCurrency } from '@/lib/format';
import { getProjectById } from '@/lib/permits/live';

export const dynamic = 'force-dynamic';

function formatPhoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const project = await getProjectById(params.id);
  if (!project) notFound();

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6">
      <Link href="/" className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-600">
        Back to app
      </Link>

      <section className="mt-4 rounded-[28px] border border-white/70 bg-white/92 p-6 shadow-[0_24px_80px_rgba(43,37,20,0.12)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">{project.neighborhood}</div>
            <h1 className="mt-2 font-display text-4xl leading-none text-stone-950">{project.address || 'Address pending'}</h1>
            <p className="mt-3 text-sm text-stone-600">
              Permit {project.permitNumber} • {project.permitSubtype || project.permitType}
            </p>
          </div>
          <div className="rounded-2xl bg-stone-950 px-4 py-3 text-white">
            <div className="text-[11px] uppercase tracking-[0.2em] text-stone-300">Estimated value</div>
            <div className="mt-2 text-2xl font-semibold">{formatCurrency(project.valuation)}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-stone-50 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">Project snapshot</div>
            <p className="mt-2 text-sm leading-6 text-stone-800">{project.readableSummary || 'No purpose text listed on the permit.'}</p>
            {project.purpose && project.purpose !== project.readableSummary ? <p className="mt-3 text-sm leading-6 text-stone-600">{project.purpose}</p> : null}
          </div>
          <div className="rounded-2xl bg-amber-50 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-900/70">Why it matters</div>
            <p className="mt-2 text-sm leading-6 text-stone-800">{project.whyItMatters}</p>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">Likely trades involved</div>
            <p className="mt-2 text-sm leading-6 text-stone-800">{project.likelyTradesNote}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">Key fields</div>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-stone-500">Issue date</dt>
                <dd className="text-right text-stone-900">{project.issueDateLabel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-stone-500">Contact</dt>
                <dd className="text-right text-stone-900">
                  <a href={`/contacts?name=${encodeURIComponent(project.contactName)}`} className="underline decoration-stone-300 underline-offset-4">
                    {project.contactName}
                  </a>
                </dd>
              </div>
              {project.contactPhone ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-500">Phone</dt>
                  <dd className="text-right text-stone-900">
                    <a href={formatPhoneHref(project.contactPhone)} className="underline decoration-stone-300 underline-offset-4">
                      {project.contactPhone}
                    </a>
                  </dd>
                </div>
              ) : null}
              {project.contactEmail ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-500">Email</dt>
                  <dd className="text-right text-stone-900">
                    <a href={`mailto:${project.contactEmail}`} className="underline decoration-stone-300 underline-offset-4">
                      {project.contactEmail}
                    </a>
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-stone-500">Coordinates</dt>
                <dd className="text-right text-stone-900">
                  {project.coordinates.lat !== null && project.coordinates.lon !== null
                    ? `${project.coordinates.lat.toFixed(5)}, ${project.coordinates.lon.toFixed(5)}`
                    : 'Not listed'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-stone-500">Google Maps</dt>
                <dd className="text-right">
                  <a href={project.mapsUrl} target="_blank" rel="noreferrer" className="font-semibold text-stone-900 underline decoration-stone-300 underline-offset-4">
                    Open map
                  </a>
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">Raw permit details</div>
            <dl className="mt-3 space-y-3 text-sm">
              {Object.entries(project.rawFields).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-stone-100 pb-3 last:border-b-0 last:pb-0">
                  <dt className="text-stone-500">{label}</dt>
                  <dd className="max-w-[58%] text-right text-stone-900">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </main>
  );
}
