import clsx from 'clsx';
import { formatCurrency, formatPhone } from '@/lib/format';
import { buildVisibleInsight } from '@/lib/permits/trade-utils';
import type { PermitProject } from '@/lib/permits/types';
import { useState } from 'react';

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

const PLACEHOLDER_IMAGES = ['/placeholders/street-1.png', '/placeholders/street-2.png', '/placeholders/street-3.png'] as const;

function placeholderImageForProject(project: PermitProject): string {
  const numericId = Number.parseInt(project.id, 10);
  const seed = Number.isFinite(numericId) ? numericId : project.objectId;
  return PLACEHOLDER_IMAGES[Math.abs(seed) % PLACEHOLDER_IMAGES.length];
}

export function PermitFeedCard({ project, trade, expanded, onToggle }: Props) {
  const summaryText = project.readableSummary || 'No project summary listed on the permit.';
  const insightText = buildVisibleInsight(project, trade || '');
  const hasContactActions = Boolean(project.contactPhone || project.contactEmail);
  const [imageFallback, setImageFallback] = useState(false);
  const placeholderImage = placeholderImageForProject(project);

  return (
    <article
      className={clsx(
        'overflow-hidden rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(34,34,37,0.96)_0%,rgba(24,24,27,0.98)_100%)] shadow-[0_14px_32px_rgba(0,0,0,0.34),0_1px_0_rgba(255,255,255,0.05)_inset] transition-all duration-200 ease-out',
        expanded ? 'translate-y-[-1px] shadow-[0_24px_52px_rgba(0,0,0,0.45),0_1px_0_rgba(255,255,255,0.05)_inset]' : ''
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="block w-full px-5 py-5 text-left transition-transform duration-150 ease-out active:scale-[0.992]"
      >
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold leading-tight text-[#f5f5f7]">{project.address || 'Address pending'}</h3>
              <p className="mt-3 text-sm leading-6 text-[#d8d8dc] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] overflow-hidden">
                {summaryText}
              </p>
            </div>
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[18px] border border-white/8 bg-[#2a2a2d]">
              {!imageFallback ? (
                <>
                  <img
                    src={placeholderImage}
                    alt=""
                    aria-hidden="true"
                    width={96}
                    height={96}
                    className="h-full w-full object-cover saturate-50 brightness-[0.82]"
                    onError={() => setImageFallback(true)}
                  />
                  <div className="absolute inset-0 bg-black/30" />
                  <div className="absolute inset-x-2 bottom-2 text-[10px] uppercase tracking-[0.16em] text-[#d1d1d6]">Street view</div>
                </>
              ) : (
                <div className="flex h-full w-full flex-col justify-between p-3 text-[10px] uppercase tracking-[0.22em] text-[#8e8e93]">
                  <span>Preview</span>
                  <span className="leading-tight text-[#c7c7cc]">Street view soon</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/6 pt-4 text-sm text-[#a1a1aa]">
            <div className="min-w-0 space-y-1">
              <div>{project.issueDateLabel}</div>
              <div className="mt-1 truncate text-[#c7c7cc]">{project.contactName || 'Contact not listed'}</div>
            </div>
            <div className="shrink-0 text-right text-[#f5f5f7]">{formatCurrency(project.valuation)}</div>
          </div>
      </button>

      {expanded ? (
        <div className="animate-[card_reveal_220ms_cubic-bezier(0.22,1,0.36,1)] border-t border-white/8 bg-[linear-gradient(180deg,rgba(22,22,24,0.96)_0%,rgba(17,17,19,1)_100%)] px-5 pb-6 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#ff3b30]">{project.issueDateLabel}</div>
              <h2 className="mt-3 text-2xl font-semibold leading-tight text-[#f5f5f7]">{project.address || 'Address pending'}</h2>
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#f5f5f7] transition-transform duration-150 ease-out active:scale-[0.98]"
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

          <div className="mt-6 rounded-[24px] border border-white/8 bg-[#1c1c1e] p-4 shadow-[0_12px_28px_rgba(0,0,0,0.18)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8e8e93]">Contact</div>
            <div className="mt-3 text-base font-semibold text-[#f5f5f7]">{project.contactName || 'Contact not listed'}</div>
            {project.contactPhone ? <div className="mt-2 text-sm text-[#d8d8dc]">{formatPhone(project.contactPhone)}</div> : null}
            {project.contactEmail ? <div className="mt-1 text-sm text-[#d8d8dc]">{project.contactEmail}</div> : null}
            {!hasContactActions ? <div className="mt-2 text-sm text-[#8e8e93]">Contact info unavailable</div> : null}
            <div className="mt-3 text-xs text-[#8e8e93]">Where available, contact information is provided directly from permit records.</div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 text-sm text-[#d8d8dc]">
            <div className="rounded-[20px] border border-white/8 bg-[#1c1c1e] px-4 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.15)]">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#8e8e93]">Value</div>
              <div className="mt-2 font-semibold text-[#f5f5f7]">{formatCurrency(project.valuation)}</div>
            </div>
            <div className="rounded-[20px] border border-white/8 bg-[#1c1c1e] px-4 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.15)]">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#8e8e93]">Permit type</div>
              <div className="mt-2 font-semibold text-[#f5f5f7]">{project.permitSubtype || project.permitType}</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {project.contactPhone ? (
              <a
                href={formatPhoneHref(project.contactPhone)}
                className={clsx('rounded-full bg-[#ff3b30] px-5 py-3 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.98]')}
              >
                Call
              </a>
            ) : null}
            {project.contactEmail ? (
              <a
                href={`mailto:${project.contactEmail}`}
                className="rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-[#f5f5f7] transition-transform duration-150 ease-out active:scale-[0.98]"
              >
                Email
              </a>
            ) : null}
            {project.contactPhone ? (
              <a
                href={formatTextHref(project.contactPhone)}
                className="rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-[#f5f5f7] transition-transform duration-150 ease-out active:scale-[0.98]"
              >
                Text
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
