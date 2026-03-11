import Link from 'next/link';
import { formatCurrency } from '@/lib/format';
import { buildTradeRelevance } from '@/lib/permits/trade-utils';
import type { PermitProject } from '@/lib/permits/types';

type Props = {
  project: PermitProject;
  contactHref?: string;
  trade?: string;
};

function formatPhoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function PermitFeedCard({ project, contactHref, trade }: Props) {
  const tradeNote = trade ? buildTradeRelevance(project, trade) : project.whyItMatters;
  const summaryText = project.readableSummary || 'No project summary listed on the permit.';
  const showTradeNote = trade ? tradeNote.toLowerCase() !== project.whyItMatters.toLowerCase() : true;

  return (
    <article className="overflow-hidden rounded-[24px] border border-stone-200 bg-white/95 shadow-[0_20px_60px_rgba(43,37,20,0.08)]">
      <div className="border-b border-stone-100 bg-[linear-gradient(135deg,rgba(245,238,227,0.9),rgba(255,255,255,0.75))] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">{project.neighborhood}</div>
            <h3 className="mt-2 text-xl font-semibold leading-tight text-stone-950">{project.address || 'Address pending'}</h3>
            <p className="mt-2 text-sm text-stone-600">
              Permit {project.permitNumber} • {project.permitSubtype || project.permitType}
            </p>
          </div>
          <div className="rounded-full bg-stone-950 px-3 py-2 text-xs font-semibold text-white">{formatCurrency(project.valuation)}</div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-wrap gap-2 text-xs font-medium text-stone-600">
          <span className="rounded-full bg-stone-100 px-3 py-1">Issued {project.issueDateLabel}</span>
          <span className="rounded-full bg-stone-100 px-3 py-1">{project.contactName}</span>
        </div>

        <p className="text-sm leading-6 text-stone-700">{summaryText}</p>

        {showTradeNote ? (
          <div className="rounded-2xl bg-stone-50 px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">{trade ? 'Why it matters for your trade' : 'Why it matters'}</div>
            <p className="mt-2 text-sm leading-6 text-stone-800">{tradeNote}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <Link href={`/projects/${project.id}`} className="rounded-full bg-stone-950 px-4 py-2 text-white transition hover:bg-stone-800 active:scale-[0.98]">
            Open project
          </Link>
          <a
            href={contactHref || `/contacts?name=${encodeURIComponent(project.contactName)}`}
            className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 transition hover:border-amber-400 active:scale-[0.98]"
          >
            View contact
          </a>
          <a
            href={project.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 transition hover:border-amber-400 active:scale-[0.98]"
          >
            Google Maps
          </a>
          {project.contactPhone ? (
            <a href={formatPhoneHref(project.contactPhone)} className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 transition hover:border-amber-400 active:scale-[0.98]">
              Call
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
