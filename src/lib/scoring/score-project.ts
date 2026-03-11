import type { PhaseBucket } from '../phase';

type ScoreInput = {
  constructionCost?: number | null;
  minCost: number;
  maxCost: number;
  permitSubtypeDescription?: string | null;
  purpose?: string | null;
  hasUsableContact: boolean;
  repeatedGcActivityCount: number;
  zip?: string | null;
  phaseBucket: PhaseBucket;
  ageDays: number;
};

export type ScoreBreakdown = {
  cost: number;
  subtype: number;
  contact: number;
  repeatedGc: number;
  geo: number;
  scopePenalty: number;
  ageAdjustment: number;
  total: number;
};

const POSITIVE_SUBTYPE_TERMS = ['office', 'retail', 'medical', 'restaurant', 'warehouse', 'hotel', 'adaptive'];
const NEGATIVE_SCOPE_TERMS = ['sign only', 'fence', 'demolition only', 'temporary'];
const HIGH_ACTIVITY_ZIPS = ['37203', '37201', '37204', '37210', '37211', '37212'];

export function scoreProject(input: ScoreInput): ScoreBreakdown {
  let cost = 0;
  if (input.constructionCost && input.constructionCost >= input.minCost && input.constructionCost <= input.maxCost) {
    const ratio = (input.constructionCost - input.minCost) / (input.maxCost - input.minCost || 1);
    cost = 20 * Math.sqrt(Math.max(0, ratio));
  }

  const descriptor = `${input.permitSubtypeDescription || ''} ${input.purpose || ''}`.toLowerCase();
  const subtype = POSITIVE_SUBTYPE_TERMS.some((term) => descriptor.includes(term)) ? 12 : 0;
  const contact = input.hasUsableContact ? 8 : 0;
  const repeatedGc = Math.min(16, input.repeatedGcActivityCount * 3);
  const geo = input.zip && HIGH_ACTIVITY_ZIPS.includes(input.zip) ? 4 : 0;
  const scopePenalty = NEGATIVE_SCOPE_TERMS.some((term) => descriptor.includes(term)) ? -8 : 0;

  let ageAdjustment = 0;
  if (input.phaseBucket === 'CLOSING OUT') ageAdjustment -= 4;
  if (input.ageDays > 75) ageAdjustment -= 3;
  if (input.phaseBucket === 'ON DECK') ageAdjustment += 3;

  const total = cost + subtype + contact + repeatedGc + geo + scopePenalty + ageAdjustment;

  return { cost, subtype, contact, repeatedGc, geo, scopePenalty, ageAdjustment, total };
}
