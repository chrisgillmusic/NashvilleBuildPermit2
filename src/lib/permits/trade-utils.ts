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

export function projectMatchesTrade(project: PermitProject, trade: string): boolean {
  if (!trade) return true;
  const keywords = tradeKeywordMap(trade);
  const haystack = `${project.likelyTrades.join(' ')} ${project.tradeSummary} ${project.whyItMatters}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

export function buildTradeRelevance(project: PermitProject, trade: string): string {
  if (!trade) return project.whyItMatters;

  const normalized = normalizeTradeValue(trade);
  const match = projectMatchesTrade(project, trade);

  if (match) {
    if (normalized === 'plumbing') return 'Worth a plumbing look because the scope points to MEP coordination and fixture or utility work.';
    if (normalized === 'electrical') return 'Worth an electrical look because the permit points to power, lighting, or fit-out coordination.';
    if (normalized === 'hvac') return 'Worth an HVAC look because comfort systems and mechanical adjustments are likely in play.';
    if (normalized === 'drywall') return 'Worth a drywall look because interior framing, partitions, or ceiling work may follow.';
    if (normalized === 'flooring') return 'Worth a flooring look because finish packages and interior turnover work are likely in play.';
    if (normalized === 'roofing') return 'Worth a roofing look because envelope or exterior system scope may be active here.';
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
