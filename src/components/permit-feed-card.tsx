import { formatCurrency, formatPhone } from '@/lib/format';
import { buildVisibleInsight } from '@/lib/permits/trade-utils';
import type { PermitProject } from '@/lib/permits/types';

type Props = {
  project: PermitProject;
  trade?: string;
  expanded: boolean;
  onToggle: () => void;
};

function formatPhoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function formatTextHref(phone: string): string {
  return `sms:${phone.replace(/[^\d+]/g, '')}`;
}

export function PermitFeedCard({ project, trade, expanded, onToggle }: Props) {
  const summaryText = project.readableSummary || 'No project summary listed on the permit.';
  const insightText = buildVisibleInsight(project, trade || '');
  const hasContactActions = Boolean(project.contactPhone || project.contactEmail);

  return (
    <>
      <article className="overflow-hidden rounded-[26px] border border-white/10 bg-[#1c1c1e] shadow-[0_18px_48px_rgba(0,0,0,0.38)] transition duration-200">
        <button type="button" onClick={onToggle} className="block w-full px-5 py-5 text-left transition active:scale-[0.995]">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold leading-tight text-[#f5f5f7]">{project.address || 'Address pending'}</h3>
              <p className="mt-3 text-sm leading-6 text-[#d8d8dc] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] overflow-hidden">
                {summaryText}
              </p>
            </div>
            <div className="flex h-24 w-24 shrink-0 flex-col justify-between rounded-[18px] border border-white/8 bg-[#2a2a2d] p-3 text-[10px] uppercase tracking-[0.22em] text-[#8e8e93]">
              <span>Preview</span>
              <span className="leading-tight text-[#c7c7cc]">Street view soon</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/6 pt-4 text-sm text-[#a1a1aa]">
            <div className="min-w-0">
              <div>{project.issueDateLabel}</div>
              <div className="mt-1 truncate text-[#c7c7cc]">{project.contactName || 'Contact not listed'}</div>
            </div>
            <div className="shrink-0 text-right text-[#f5f5f7]">{formatCurrency(project.valuation)}</div>
          </div>
        </button>
      </article>

      <div
        className={
          expanded
            ? 'pointer-events-auto fixed inset-x-0 top-0 z-40 h-[calc(100vh-6.5rem)] translate-y-0 opacity-100 transition-all duration-300'
            : 'pointer-events-none fixed inset-x-0 top-8 z-40 h-[calc(100vh-6.5rem)] translate-y-6 opacity-0 transition-all duration-300'
        }
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onToggle} />
        <div className="absolute inset-x-3 top-3 bottom-0 overflow-hidden rounded-[30px] border border-white/10 bg-[#111113] shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
          <div className="flex h-full flex-col overflow-y-auto px-5 pb-36 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#ff3b30]">{project.issueDateLabel}</div>
                <h2 className="mt-3 text-2xl font-semibold leading-tight text-[#f5f5f7]">{project.address || 'Address pending'}</h2>
              </div>
              <button
                type="button"
                onClick={onToggle}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#f5f5f7] active:scale-[0.98]"
              >
                Close
              </button>
            </div>

            <p className="mt-5 text-base leading-7 text-[#e3e3e6]">{summaryText}</p>

            {insightText ? (
              <div className="mt-6 rounded-[24px] border border-[#ff3b30]/30 bg-[#171719] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ff3b30]">Why It Matters</div>
                <p className="mt-3 text-sm leading-6 text-[#d8d8dc]">{insightText}</p>
              </div>
            ) : null}

            <div className="mt-6 rounded-[24px] border border-white/8 bg-[#1c1c1e] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8e8e93]">Contact</div>
              <div className="mt-3 text-base font-semibold text-[#f5f5f7]">{project.contactName || 'Contact not listed'}</div>
              {project.contactPhone ? <div className="mt-2 text-sm text-[#d8d8dc]">{formatPhone(project.contactPhone)}</div> : null}
              {project.contactEmail ? <div className="mt-1 text-sm text-[#d8d8dc]">{project.contactEmail}</div> : null}
              {!hasContactActions ? <div className="mt-2 text-sm text-[#8e8e93]">Contact info unavailable</div> : null}
              <div className="mt-3 text-xs text-[#8e8e93]">Where available, contact information is provided directly from permit records.</div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 text-sm text-[#d8d8dc]">
              <div className="rounded-[20px] border border-white/8 bg-[#1c1c1e] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8e8e93]">Value</div>
                <div className="mt-2 font-semibold text-[#f5f5f7]">{formatCurrency(project.valuation)}</div>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-[#1c1c1e] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#8e8e93]">Permit type</div>
                <div className="mt-2 font-semibold text-[#f5f5f7]">{project.permitSubtype || project.permitType}</div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {project.contactPhone ? (
                <a
                  href={formatPhoneHref(project.contactPhone)}
                  className="rounded-full bg-[#ff3b30] px-5 py-3 text-sm font-semibold text-white transition active:scale-[0.98]"
                >
                  Call
                </a>
              ) : null}
              {project.contactEmail ? (
                <a
                  href={`mailto:${project.contactEmail}`}
                  className="rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-[#f5f5f7] transition active:scale-[0.98]"
                >
                  Email
                </a>
              ) : null}
              {project.contactPhone ? (
                <a
                  href={formatTextHref(project.contactPhone)}
                  className="rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-[#f5f5f7] transition active:scale-[0.98]"
                >
                  Text
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
