import type { PermitProject } from './types';

export const TRADE_OPTIONS = [
  'Plumbing',
  'Electrical',
  'HVAC',
  'Drywall',
  'Flooring',
  'Roofing',
  'Concrete',
  'Framing',
  'Fire Protection',
  'Paint',
  'Storefront',
  'General Interiors'
] as const;

export type TradeOption = (typeof TRADE_OPTIONS)[number];
export type FeedMode = 'my-trade' | 'all-jobs';

function normalizeTradeValue(value: string): string {
  return value.trim().toLowerCase();
}

function tradeKeywordMap(trade: string): string[] {
  const normalized = normalizeTradeValue(trade);

  if (normalized === 'plumbing') return ['plumbing', 'mep', 'restaurant'];
  if (normalized === 'electrical') return ['electrical', 'lighting', 'power', 'mep'];
  if (normalized === 'hvac') return ['hvac', 'mechanical', 'mep'];
  if (normalized === 'drywall') return ['drywall', 'framing', 'ceilings', 'interiors'];
  if (normalized === 'flooring') return ['flooring', 'tile', 'finishes', 'interiors'];
  if (normalized === 'roofing') return ['roofing', 'sheet metal', 'waterproofing', 'exterior'];
  if (normalized === 'concrete') return ['concrete', 'foundation', 'structural'];
  if (normalized === 'framing') return ['framing', 'drywall', 'structural'];
  if (normalized === 'fire protection') return ['fire protection', 'sprinkler', 'mep'];
  if (normalized === 'paint') return ['paint', 'finishes', 'interiors'];
  if (normalized === 'storefront') return ['storefront', 'glass', 'exterior'];
  return ['drywall', 'ceilings', 'flooring', 'paint', 'interiors'];
}

function hasNegativeRoofSignal(project: PermitProject): boolean {
  const haystack = `${project.rawPurpose} ${project.purpose}`.toLowerCase();
  return [
    'no exterior',
    'no change to exterior',
    'no exterior work',
    'no outside work',
    'no roof',
    'no roof work',
    'no roofline change',
    'interior only',
    'interior renovation only',
    'interior build-out',
    'interior alterations only',
    'tenant finish',
    'tenant improvement'
  ].some((term) => haystack.includes(term));
}

function hasPositiveRoofSignal(project: PermitProject): boolean {
  const haystack = `${project.rawPurpose} ${project.purpose} ${project.permitSubtype} ${project.permitType}`.toLowerCase();
  return ['roof replacement', 'reroof', 're-roof', 'roof repair', 'roofing', 'roof deck', 'roofline', 'siding', 'sheet metal', 'waterproofing', 'exterior envelope'].some((term) =>
    haystack.includes(term)
  );
}

export function projectMatchesTrade(project: PermitProject, trade: string): boolean {
  if (!trade) return true;
  const normalized = normalizeTradeValue(trade);

  if (normalized === 'roofing') {
    if (hasNegativeRoofSignal(project) && !hasPositiveRoofSignal(project)) return false;
    if ((project.permitSubtype || project.permitType || '').toLowerCase().includes('tenant') && !hasPositiveRoofSignal(project)) return false;
  }

  const keywords = tradeKeywordMap(trade);
  const haystack = `${project.likelyTrades.join(' ')} ${project.tradeSummary} ${project.whyItMatters} ${project.permitType} ${project.permitSubtype} ${project.purpose}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

export function buildTradeRelevance(project: PermitProject, trade: string): string {
  if (!trade) return project.whyItMatters;
  if (project.tradeSummary && project.tradeSummary !== project.readableSummary) return project.tradeSummary;

  const normalized = normalizeTradeValue(trade);
  const match = projectMatchesTrade(project, trade);

  if (match) {
    if (normalized === 'plumbing') return 'Worth a plumbing look because the scope points to MEP coordination and fixture or utility work.';
    if (normalized === 'electrical') return 'Worth an electrical look because the permit points to power, lighting, or fit-out coordination.';
    if (normalized === 'hvac') return 'Worth an HVAC look because comfort systems and mechanical adjustments are likely in play.';
    if (normalized === 'drywall') return 'Worth a drywall look because interior framing, partitions, or ceiling work may follow.';
    if (normalized === 'flooring') return 'Worth a flooring look because finish packages and interior turnover work are likely in play.';
    if (normalized === 'roofing') return 'Worth a roofing look only if the permit scope points to envelope, roof, or exterior system work.';
    if (normalized === 'concrete') return 'Worth a concrete look because early structural or foundation scope may still be in motion.';
    if (normalized === 'framing') return 'Worth a framing look because shell or interior build-out work appears relevant.';
    if (normalized === 'fire protection') return 'Worth a fire protection look because commercial interiors often trigger life-safety coordination.';
    if (normalized === 'paint') return 'Worth a paint look because finish turnover work appears relevant on this permit.';
    if (normalized === 'storefront') return 'Worth a storefront look because retail or exterior frontage work appears relevant.';
    return 'Worth a look because the scope lines up with interior trade packages.';
  }

  return `Less directly tied to ${trade.toLowerCase()}, but still within your market filters.`;
}

export function projectViewForMode(projects: PermitProject[], mode: FeedMode, trade: string): PermitProject[] {
  if (mode === 'all-jobs' || !trade) return projects;
  return projects.filter((project) => projectMatchesTrade(project, trade));
}
