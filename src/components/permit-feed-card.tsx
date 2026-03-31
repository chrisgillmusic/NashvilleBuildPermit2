import Link from 'next/link';
import { formatCurrency } from '@/lib/format';
import { buildTradeRelevance } from '@/lib/permits/trade-utils';
import type { PermitProject } from '@/lib/permits/types';

type Props = {
  project: PermitProject;
  contactHref?: string;
  trade?: string;
  expanded: boolean;
  onToggle: () => void;
};

function formatPhoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function PermitFeedCard({ project, contactHref, trade, expanded, onToggle }: Props) {
  const tradeNote = trade ? buildTradeRelevance(project, trade) : project.whyItMatters;
  const summaryText = project.readableSummary || 'No project summary listed on the permit.';
  const showTradeNote = trade ? tradeNote.toLowerCase() !== project.whyItMatters.toLowerCase() : true;

  return (
    <article className="overflow-hidden rounded-[24px] border border-stone-200 bg-white/86 shadow-[0_20px_60px_rgba(43,37,20,0.08)] backdrop-blur transition duration-200">
      <button type="button" onClick={onToggle} className="block w-full px-5 py-5 text-left transition active:scale-[0.995]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold leading-tight text-stone-950">{project.address || 'Address pending'}</h3>
            <p className="mt-2 text-sm leading-6 text-stone-700 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{summaryText}</p>
          </div>
          <div className="rounded-full bg-stone-950 px-3 py-2 text-xs font-semibold text-white">{formatCurrency(project.valuation)}</div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-stone-600">
          <span className="rounded-full bg-stone-100 px-3 py-1">{project.issueDateLabel}</span>
          <span className="rounded-full bg-stone-100 px-3 py-1">{project.contactName}</span>
        </div>
      </button>

      <div className="border-t border-stone-100 px-5 pb-5 pt-4">
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          {project.contactPhone ? (
            <a href={formatPhoneHref(project.contactPhone)} className="rounded-full bg-stone-950 px-4 py-2 text-white transition hover:bg-stone-800 active:scale-[0.98]">
              Call
            </a>
          ) : null}
          <a href={project.mapsUrl} target="_blank" rel="noreferrer" className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 transition hover:border-amber-400 active:scale-[0.98]">
            Map
          </a>
        </div>

        <div className={expanded ? 'mt-4 max-h-[420px] overflow-hidden opacity-100 transition-all duration-200' : 'max-h-0 overflow-hidden opacity-0 transition-all duration-200'}>
          <div className="space-y-4 rounded-2xl bg-stone-50 px-4 py-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">What&apos;s happening</div>
              <p className="mt-2 text-sm leading-6 text-stone-800">{project.whyItMatters}</p>
            </div>

            {showTradeNote ? (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">{trade ? 'Why it matters' : 'Extra context'}</div>
                <p className="mt-2 text-sm leading-6 text-stone-800">{tradeNote}</p>
              </div>
            ) : null}

            <div className="text-sm leading-6 text-stone-700">
              <div className="font-semibold text-stone-950">{project.contactName}</div>
              {project.contactPhone ? <div>{project.contactPhone}</div> : null}
            </div>

            <div className="flex flex-wrap gap-3 text-sm font-semibold">
              {project.contactPhone ? (
                <a href={formatPhoneHref(project.contactPhone)} className="rounded-full bg-stone-950 px-4 py-2 text-white transition hover:bg-stone-800 active:scale-[0.98]">
                  Call
                </a>
              ) : null}
              <Link href={`/projects/${project.id}`} className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 transition hover:border-amber-400 active:scale-[0.98]">
                Open full details
              </Link>
              <a href={contactHref || `/contacts?name=${encodeURIComponent(project.contactName)}`} className="rounded-full border border-stone-300 px-4 py-2 text-stone-800 transition hover:border-amber-400 active:scale-[0.98]">
                Builder
              </a>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
