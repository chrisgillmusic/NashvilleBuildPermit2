import { formatCurrency, formatPhone } from '@/lib/format';
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
  const showWhyItMatters = Boolean(project.whyItMatters && project.whyItMatters.toLowerCase() !== summaryText.toLowerCase());
  const showTradeNote = Boolean(
    trade &&
      tradeNote &&
      tradeNote.toLowerCase() !== project.whyItMatters.toLowerCase() &&
      tradeNote.toLowerCase() !== summaryText.toLowerCase()
  );
  const detailHref = `/projects/${project.id}${trade ? `?trade=${encodeURIComponent(trade)}` : ''}`;

  return (
    <article className="overflow-hidden rounded-[24px] border border-white/10 bg-[rgba(15,16,18,0.8)] shadow-[0_22px_70px_rgba(0,0,0,0.34)] backdrop-blur-xl transition duration-200">
      <button type="button" onClick={onToggle} className="block w-full px-5 py-5 text-left transition active:scale-[0.995]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold leading-tight text-white">{project.address || 'Address pending'}</h3>
            <p className="mt-2 text-sm leading-6 text-stone-300 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{summaryText}</p>
          </div>
          <div className="rounded-full bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-100 ring-1 ring-amber-300/20">{formatCurrency(project.valuation)}</div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-stone-300">
          <span className="rounded-full bg-white/10 px-3 py-1">{project.issueDateLabel}</span>
          <span className="rounded-full bg-white/10 px-3 py-1">{project.contactName}</span>
        </div>
      </button>

      <div className="border-t border-white/5 px-5 pb-5 pt-4">
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          {project.contactPhone ? (
            <a href={formatPhoneHref(project.contactPhone)} className="rounded-full bg-amber-400 px-4 py-2 text-stone-950 transition hover:bg-amber-300 active:scale-[0.98]">
              Call
            </a>
          ) : null}
          <a href={project.mapsUrl} target="_blank" rel="noreferrer" className="rounded-full border border-white/20 px-4 py-2 text-stone-100 transition hover:border-amber-300 active:scale-[0.98]">
            Map
          </a>
          <a href={detailHref} className="rounded-full border border-white/20 px-4 py-2 text-stone-100 transition hover:border-amber-300 active:scale-[0.98]">
            Open
          </a>
        </div>

        <div className={expanded ? 'mt-4 max-h-[420px] overflow-hidden opacity-100 transition-all duration-200' : 'max-h-0 overflow-hidden opacity-0 transition-all duration-200'}>
          <div className="space-y-4 rounded-2xl bg-white/5 px-4 py-4 ring-1 ring-white/10">
            {showWhyItMatters ? (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">Why it matters</div>
                <p className="mt-2 text-sm leading-6 text-stone-100">{project.whyItMatters}</p>
              </div>
            ) : null}

            {showTradeNote ? (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">For your trade</div>
                <p className="mt-2 text-sm leading-6 text-stone-200">{tradeNote}</p>
              </div>
            ) : null}

            <div className="text-sm leading-6 text-stone-300">
              <div className="font-semibold text-white">{project.contactName}</div>
              {project.contactPhone ? <div>{formatPhone(project.contactPhone)}</div> : null}
            </div>

            <div className="flex flex-wrap gap-3 text-sm font-semibold">
              {project.contactPhone ? (
                <a href={formatPhoneHref(project.contactPhone)} className="rounded-full bg-amber-400 px-4 py-2 text-stone-950 transition hover:bg-amber-300 active:scale-[0.98]">
                  Call
                </a>
              ) : null}
              <a href={detailHref} className="rounded-full border border-white/20 px-4 py-2 text-stone-100 transition hover:border-amber-300 active:scale-[0.98]">
                Open full details
              </a>
              <a href={contactHref || `/contacts?name=${encodeURIComponent(project.contactName)}`} className="rounded-full border border-white/20 px-4 py-2 text-stone-100 transition hover:border-amber-300 active:scale-[0.98]">
                Builder
              </a>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
