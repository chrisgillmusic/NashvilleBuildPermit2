export const DEFAULT_JACKSONVILLE_SWEEP_TERMS = [
  'MAIN',
  'ATLANTIC',
  'BEACH',
  'BLANDING',
  'ROOSEVELT',
  'SAN JOSE',
  'UNIVERSITY',
  'DUNN',
  'BAYMEADOWS',
  'PHILIPS',
  'RIVERSIDE',
  'MERRILL',
  'NORMANDY',
  'CESERY',
  'HODGES',
  'LEM TURNER',
  'HECKSCHER',
  'JTB',
  'LANE',
  'BOULEVARD',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9'
] as const;

export const JACKSONVILLE_SEARCH_PAGE_SIZE = 100;
export const JACKSONVILLE_DETAIL_CONCURRENCY = 16;

export function getJacksonvilleSweepTerms(): string[] {
  const override = process.env.JAX_PERMITS_SWEEP_TERMS;
  const terms = (override ? override.split(',') : [...DEFAULT_JACKSONVILLE_SWEEP_TERMS]).map((term) => term.trim()).filter(Boolean);

  return Array.from(new Set(terms));
}
