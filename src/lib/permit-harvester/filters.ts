import type { NormalizedPermit, PermitHarvesterFilters, PermitOccupancyFilter } from './types';

function toDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOccupancy(value: unknown): PermitOccupancyFilter {
  if (value === 'residential' || value === 'nonResidential' || value === 'unknown' || value === 'all') {
    return value;
  }
  return 'all';
}

function parseBoundary(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  const parsed = new Date(`${value}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function parseIssuedAt(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function buildDefaultFilters(now = new Date()): PermitHarvesterFilters {
  const from = new Date(now);
  from.setDate(from.getDate() - 30);

  return {
    minValue: 25000,
    permitType: '',
    dateFrom: toDateInputValue(from),
    dateTo: toDateInputValue(now),
    occupancy: 'nonResidential'
  };
}

export function normalizeFilters(input?: Partial<PermitHarvesterFilters>): PermitHarvesterFilters {
  const defaults = buildDefaultFilters();
  const hasMinValue = Boolean(input && Object.prototype.hasOwnProperty.call(input, 'minValue'));
  const hasPermitType = Boolean(input && Object.prototype.hasOwnProperty.call(input, 'permitType'));
  const hasDateFrom = Boolean(input && Object.prototype.hasOwnProperty.call(input, 'dateFrom'));
  const hasDateTo = Boolean(input && Object.prototype.hasOwnProperty.call(input, 'dateTo'));
  const hasOccupancy = Boolean(input && Object.prototype.hasOwnProperty.call(input, 'occupancy'));

  return {
    minValue: hasMinValue ? parseNumber(input?.minValue) : defaults.minValue,
    permitType: hasPermitType ? normalizeText(input?.permitType) : defaults.permitType,
    dateFrom: hasDateFrom ? normalizeText(input?.dateFrom) : defaults.dateFrom,
    dateTo: hasDateTo ? normalizeText(input?.dateTo) : defaults.dateTo,
    occupancy: hasOccupancy ? normalizeOccupancy(input?.occupancy) : defaults.occupancy
  };
}

export function applyPermitFilters(permits: NormalizedPermit[], filters: PermitHarvesterFilters): NormalizedPermit[] {
  const minIssuedAt = parseBoundary(filters.dateFrom, false);
  const maxIssuedAt = parseBoundary(filters.dateTo, true);
  const requestedType = filters.permitType.toLowerCase();

  return permits.filter((permit) => {
    const issuedAt = parseIssuedAt(permit.dateIssued);

    if (filters.minValue !== null && (permit.value ?? 0) < filters.minValue) return false;
    if (requestedType && permit.type.toLowerCase() !== requestedType) return false;
    if (filters.occupancy !== 'all' && permit.occupancy !== filters.occupancy) return false;
    if (minIssuedAt !== null && issuedAt !== null && issuedAt < minIssuedAt) return false;
    if (maxIssuedAt !== null && issuedAt !== null && issuedAt > maxIssuedAt) return false;

    return true;
  });
}
