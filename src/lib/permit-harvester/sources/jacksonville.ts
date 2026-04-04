import { buildDefaultFilters } from '../filters';
import type {
  HarvestCoverage,
  HarvestStopReason,
  HarvestTermCoverage,
  NormalizedPermit,
  PermitDateRangeSummary,
  PermitHarvesterFilters,
  PermitOccupancy
} from '../types';
import { JACKSONVILLE_DETAIL_CONCURRENCY, JACKSONVILLE_SEARCH_PAGE_SIZE, getJacksonvilleSweepTerms } from './jacksonville-config';
import type { CitySource, SourceFetchResult, SourceLog } from './types';

const API_BASE = process.env.JAX_PERMITS_API_URL || 'https://jaxepicsapi.coj.net/api';
const REQUEST_RETRIES = 3;

type JacksonvilleSearchItem = {
  title?: string;
  description?: string;
  key?: string;
  link?: string;
  obj?: {
    PermitType?: string | null;
    ProposedUse?: string | null;
    StructureType?: string | null;
    WorkType?: string | null;
    Status?: string | null;
    DateIssued?: string | null;
    Address?: string | null;
    PropertyKey?: string | null;
  };
};

type JacksonvilleSearchResponse = {
  values?: JacksonvilleSearchItem[];
  count?: number;
  page?: number;
  pageSize?: number;
};

type JacksonvillePermitDetail = Record<string, unknown> & {
  PermitId?: number;
  FullPermitNumber?: string;
  PermitTypeDescription?: string | null;
  ProposedUseDescription?: string | null;
  WorkTypeDescription?: string | null;
  StatusDescription?: string | null;
  DateIssued?: string | null;
  TotalCost?: number | null;
  WorkDescription?: string | null;
  PermitCompanies?: Array<Record<string, unknown>> | null;
  PermitWorkSubTypes?: Array<{ WorkSubTypeDescription?: string | null }> | null;
  PropertyOwner?: Record<string, unknown> | null;
  Address?: {
    BaseAddress?: string | null;
    FullAddress?: string | null;
    City?: string | null;
    State?: string | null;
    ZipCode?: string | null;
  } | null;
};

type HarvestedSearchPermit = {
  id: string;
  primaryHit: JacksonvilleSearchItem;
  matchedTerms: string[];
  hits: JacksonvilleSearchItem[];
  issuedAt: string;
  issuedAtMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildApiUrl(path: string, params?: URLSearchParams): string {
  const normalizedBase = API_BASE.replace(/\/+$/, '');
  return `${normalizedBase}/${path.replace(/^\/+/, '')}${params ? `?${params.toString()}` : ''}`;
}

async function fetchJson<T>(url: string, init?: RequestInit, attempt = 0): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {})
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    if (attempt >= REQUEST_RETRIES) {
      throw new Error(`JAXEPICS request failed with status ${response.status}`);
    }

    await sleep(300 * (attempt + 1));
    return fetchJson<T>(url, init, attempt + 1);
  }

  return (await response.json()) as T;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeAddress(value: string): string {
  const cleaned = normalizeText(value);
  if (!cleaned) return '';

  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .replace(/\bNw\b/g, 'NW')
    .replace(/\bNe\b/g, 'NE')
    .replace(/\bSw\b/g, 'SW')
    .replace(/\bSe\b/g, 'SE')
    .replace(/\bUs\b/g, 'US');
}

function sentenceCase(value: string): string {
  if (!value) return '';
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/(^\w|[.!?]\s+\w)/g, (match) => match.toUpperCase());
}

function normalizeDescription(value: string): string {
  const cleaned = normalizeText(value)
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();

  return sentenceCase(cleaned);
}

function getNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value: string): number {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function parseBoundary(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  return parseTimestamp(`${value}${suffix}`);
}

function normalizeOccupancy(value: string): PermitOccupancy {
  const normalized = value.toLowerCase();
  if (normalized.includes('non-residential')) return 'nonResidential';
  if (normalized.includes('residential')) return 'residential';
  return 'unknown';
}

function buildDateRangeSummary(timestamps: number[]): PermitDateRangeSummary {
  const valid = timestamps.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (!valid.length) {
    return {
      earliest: null,
      latest: null
    };
  }

  return {
    earliest: new Date(valid[0]).toISOString(),
    latest: new Date(valid[valid.length - 1]).toISOString()
  };
}

function isWithinHarvestWindow(issuedAt: number, minIssuedAt: number | null, maxIssuedAt: number | null): boolean {
  if (!issuedAt) return false;
  if (minIssuedAt !== null && issuedAt < minIssuedAt) return false;
  if (maxIssuedAt !== null && issuedAt > maxIssuedAt) return false;
  return true;
}

function getPrimaryCompany(detail: JacksonvillePermitDetail): Record<string, unknown> | null {
  const companies = Array.isArray(detail.PermitCompanies) ? detail.PermitCompanies : [];
  return companies.find((company) => company.IsPrimary) || companies[0] || null;
}

function getPhoneFromParty(party?: Record<string, unknown>): string {
  const directPhone = normalizeText(party?.Phone);
  if (directPhone && directPhone !== '0') return directPhone;

  const numbers = Array.isArray(party?.UserPhoneNumbers) ? party.UserPhoneNumbers : [];
  for (const entry of numbers) {
    const phoneNumber = normalizeText((entry as { PhoneNumber?: { Number?: unknown } }).PhoneNumber?.Number);
    if (phoneNumber) return phoneNumber;
  }

  return '';
}

function getContactName(detail: JacksonvillePermitDetail): string {
  const primaryCompany = getPrimaryCompany(detail);
  const company = primaryCompany?.Company as Record<string, unknown> | undefined;
  const contractor = primaryCompany?.Contractor as Record<string, unknown> | undefined;
  const owner = detail.PropertyOwner as Record<string, unknown> | undefined;

  return (
    normalizeText(company?.BusinessName) ||
    normalizeText(company?.DisplayName) ||
    normalizeText(contractor?.DisplayName) ||
    normalizeText(owner?.DisplayName) ||
    'Contact not listed'
  );
}

function getContactPhone(detail: JacksonvillePermitDetail): string {
  const primaryCompany = getPrimaryCompany(detail);
  const company = primaryCompany?.Company as Record<string, unknown> | undefined;
  const contractor = primaryCompany?.Contractor as Record<string, unknown> | undefined;
  const owner = detail.PropertyOwner as Record<string, unknown> | undefined;

  return getPhoneFromParty(company) || getPhoneFromParty(contractor) || getPhoneFromParty(owner);
}

function getContactEmail(detail: JacksonvillePermitDetail): string {
  const primaryCompany = getPrimaryCompany(detail);
  const company = primaryCompany?.Company as Record<string, unknown> | undefined;
  const contractor = primaryCompany?.Contractor as Record<string, unknown> | undefined;
  const owner = detail.PropertyOwner as Record<string, unknown> | undefined;

  return normalizeText(company?.Email) || normalizeText(contractor?.Email) || normalizeText(owner?.Email);
}

function buildPermitType(detail: JacksonvillePermitDetail, search: JacksonvilleSearchItem): string {
  const permitType = normalizeText(detail.PermitTypeDescription || search.obj?.PermitType);
  const subtypes = Array.isArray(detail.PermitWorkSubTypes)
    ? detail.PermitWorkSubTypes.map((entry) => normalizeText(entry.WorkSubTypeDescription)).filter(Boolean)
    : [];
  const subtypeLabel = subtypes.join(', ') || normalizeText(detail.WorkTypeDescription || search.obj?.WorkType);

  return [permitType, subtypeLabel].filter(Boolean).join(' / ') || 'Permit';
}

function buildDescription(detail: JacksonvillePermitDetail, search: JacksonvilleSearchItem): string {
  const workDescription = normalizeDescription(normalizeText(detail.WorkDescription));
  if (workDescription) return workDescription;

  const parts = [
    normalizeText(detail.PermitTypeDescription || search.obj?.PermitType),
    normalizeText(detail.ProposedUseDescription || search.obj?.ProposedUse),
    normalizeText(detail.WorkTypeDescription || search.obj?.WorkType),
    normalizeAddress(normalizeText(detail.Address?.BaseAddress || search.obj?.Address))
  ].filter(Boolean);

  return normalizeDescription(parts.join(' - '));
}

function buildFallbackSearchDescription(search: JacksonvilleSearchItem): string {
  const description = normalizeDescription(normalizeText(search.description));
  if (description) return description;

  return normalizeDescription(
    [
      normalizeText(search.obj?.PermitType),
      normalizeText(search.obj?.ProposedUse),
      normalizeText(search.obj?.WorkType),
      normalizeAddress(normalizeText(search.obj?.Address))
    ]
      .filter(Boolean)
      .join(' - ')
  );
}

function normalizePermitFromSearch(permit: HarvestedSearchPermit): NormalizedPermit | null {
  const search = permit.primaryHit;
  const permitId = normalizeText(search.key);
  const dateIssued = normalizeText(search.obj?.DateIssued || permit.issuedAt);

  if (!permitId || !dateIssued) return null;

  return {
    id: permitId,
    city: 'Jacksonville',
    source: 'JAXEPICS public API',
    address: normalizeAddress(normalizeText(search.obj?.Address)),
    type: [normalizeText(search.obj?.PermitType), normalizeText(search.obj?.WorkType)].filter(Boolean).join(' / ') || 'Permit',
    description: buildFallbackSearchDescription(search),
    value: null,
    dateIssued,
    contact: 'Contact not listed',
    phone: '',
    email: '',
    occupancy: normalizeOccupancy(normalizeText(search.obj?.ProposedUse)),
    permitNumber: normalizeText(search.title),
    status: normalizeText(search.obj?.Status),
    raw: {
      search: {
        matchedTerms: permit.matchedTerms,
        hits: permit.hits
      },
      detail: null
    }
  };
}

function normalizePermit(permit: HarvestedSearchPermit, detail: JacksonvillePermitDetail): NormalizedPermit | null {
  const search = permit.primaryHit;
  const permitId = normalizeText(detail.PermitId || search.key);
  const dateIssued = normalizeText(detail.DateIssued || search.obj?.DateIssued || permit.issuedAt);

  if (!permitId || !dateIssued) return normalizePermitFromSearch(permit);

  const address =
    normalizeAddress(normalizeText(detail.Address?.BaseAddress)) ||
    normalizeAddress(
      normalizeText(detail.Address?.FullAddress)
        .replace(/\s+JACKSONVILLE,?\s+FL\s+\d{5}(?:-\d{4})?$/i, '')
        .replace(/\s+FL\s+\d{5}(?:-\d{4})?$/i, '')
    ) ||
    normalizeAddress(normalizeText(search.obj?.Address));

  return {
    id: permitId,
    city: 'Jacksonville',
    source: 'JAXEPICS public API',
    address,
    type: buildPermitType(detail, search),
    description: buildDescription(detail, search),
    value: getNumber(detail.TotalCost),
    dateIssued,
    contact: getContactName(detail),
    phone: getContactPhone(detail),
    email: getContactEmail(detail),
    occupancy: normalizeOccupancy(normalizeText(detail.ProposedUseDescription || search.obj?.ProposedUse)),
    permitNumber: normalizeText(detail.FullPermitNumber || search.title),
    status: normalizeText(detail.StatusDescription || search.obj?.Status),
    raw: {
      search: {
        matchedTerms: permit.matchedTerms,
        hits: permit.hits
      },
      detail
    }
  };
}

async function searchPermitsPage(term: string, page: number): Promise<JacksonvilleSearchResponse> {
  const params = new URLSearchParams({
    searchTerm: term,
    page: String(page),
    pageSize: String(JACKSONVILLE_SEARCH_PAGE_SIZE),
    sortActive: 'DateIssued',
    sortDirection: 'desc'
  });

  return fetchJson<JacksonvilleSearchResponse>(buildApiUrl('Searches/Permits/AddressSearch', params), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ''
  });
}

async function fetchPermitDetail(id: string): Promise<JacksonvillePermitDetail> {
  return fetchJson<JacksonvillePermitDetail>(buildApiUrl(`Permits/${id}`));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function collectSearchCoverage({
  filters,
  log
}: {
  filters: PermitHarvesterFilters;
  log: SourceLog;
}): Promise<{
  harvestedPermits: HarvestedSearchPermit[];
  coverage: HarvestCoverage;
}> {
  const searchTerms = getJacksonvilleSweepTerms();
  const minIssuedAt = parseBoundary(filters.dateFrom, false);
  const maxIssuedAt = parseBoundary(filters.dateTo, true);
  const permitsById = new Map<string, HarvestedSearchPermit>();
  const termCoverage: HarvestTermCoverage[] = [];
  let rawFetchedCount = 0;
  let rawInCoverageCount = 0;
  let pagesWalked = 0;

  log('info', `Sweeping ${searchTerms.length} Jacksonville search buckets with page size ${JACKSONVILLE_SEARCH_PAGE_SIZE}.`);

  for (const term of searchTerms) {
    let page = 1;
    let stopReason: HarvestStopReason = 'exhausted';
    let termRawFetchedCount = 0;
    let termRawInCoverageCount = 0;
    let termUniquePermitCount = 0;
    let termDuplicateCount = 0;
    let termPagesWalked = 0;
    let totalAvailableCount: number | null = null;
    const termTimestamps: number[] = [];
    let termError: string | null = null;

    while (true) {
      let response: JacksonvilleSearchResponse;

      try {
        response = await searchPermitsPage(term, page);
      } catch (error) {
        stopReason = 'error';
        termError = error instanceof Error ? error.message : 'Unknown search error';
        log('warn', `Search term "${term}" failed on page ${page}: ${termError}`);
        break;
      }

      termPagesWalked += 1;
      pagesWalked += 1;

      if (page === 1) {
        totalAvailableCount = typeof response.count === 'number' ? response.count : null;
      }

      const values = response.values || [];
      if (!values.length) {
        stopReason = page === 1 ? 'noResults' : 'exhausted';
        break;
      }

      let oldestOnPage = Number.POSITIVE_INFINITY;
      let hasValidDateOnPage = false;

      for (const item of values) {
        rawFetchedCount += 1;
        termRawFetchedCount += 1;

        const permitId = normalizeText(item.key);
        const issuedAtText = normalizeText(item.obj?.DateIssued);
        const issuedAtMs = parseTimestamp(issuedAtText);

        if (issuedAtMs) {
          oldestOnPage = Math.min(oldestOnPage, issuedAtMs);
          hasValidDateOnPage = true;
        }

        if (!permitId || !isWithinHarvestWindow(issuedAtMs, minIssuedAt, maxIssuedAt)) {
          continue;
        }

        rawInCoverageCount += 1;
        termRawInCoverageCount += 1;
        termTimestamps.push(issuedAtMs);

        const existing = permitsById.get(permitId);
        if (!existing) {
          permitsById.set(permitId, {
            id: permitId,
            primaryHit: item,
            matchedTerms: [term],
            hits: [item],
            issuedAt: issuedAtText,
            issuedAtMs
          });
          termUniquePermitCount += 1;
          continue;
        }

        termDuplicateCount += 1;
        existing.hits.push(item);
        if (!existing.matchedTerms.includes(term)) {
          existing.matchedTerms.push(term);
        }
        if (issuedAtMs > existing.issuedAtMs) {
          existing.primaryHit = item;
          existing.issuedAt = issuedAtText;
          existing.issuedAtMs = issuedAtMs;
        }
      }

      if (values.length < JACKSONVILLE_SEARCH_PAGE_SIZE) {
        stopReason = 'exhausted';
        break;
      }

      if (minIssuedAt !== null && hasValidDateOnPage && oldestOnPage < minIssuedAt) {
        stopReason = 'dateBoundary';
        break;
      }

      page += 1;
    }

    const termSummary: HarvestTermCoverage = {
      term,
      rawFetchedCount: termRawFetchedCount,
      rawInCoverageCount: termRawInCoverageCount,
      uniquePermitCount: termUniquePermitCount,
      duplicateCount: termDuplicateCount,
      pagesWalked: termPagesWalked,
      totalAvailableCount,
      dateRange: buildDateRangeSummary(termTimestamps),
      stopReason,
      error: termError
    };

    termCoverage.push(termSummary);
    log(
      termError ? 'warn' : 'info',
      `Term "${term}": ${termSummary.rawFetchedCount} raw rows across ${termSummary.pagesWalked} pages, ${termSummary.uniquePermitCount} new unique permits, ${termSummary.duplicateCount} duplicates, stop=${termSummary.stopReason}.`
    );
  }

  const harvestedPermits = Array.from(permitsById.values()).sort((left, right) => right.issuedAtMs - left.issuedAtMs);
  const harvestedDateRange = buildDateRangeSummary(harvestedPermits.map((permit) => permit.issuedAtMs));

  return {
    harvestedPermits,
    coverage: {
      searchTerms,
      termsSearched: searchTerms.length,
      pagesWalked,
      rawFetchedCount,
      rawInCoverageCount,
      uniquePermitCount: harvestedPermits.length,
      duplicatesRemoved: rawInCoverageCount - harvestedPermits.length,
      harvestedDateRange,
      filteredDateRange: {
        earliest: null,
        latest: null
      },
      termCoverage
    }
  };
}

async function fetchJacksonvillePermits({
  filters,
  log
}: {
  filters: PermitHarvesterFilters;
  log: SourceLog;
}): Promise<SourceFetchResult> {
  log('info', 'Jacksonville live pull started against the JAXEPICS public API.');

  const { harvestedPermits, coverage } = await collectSearchCoverage({ filters, log });

  log(
    'info',
    `Coverage sweep fetched ${coverage.rawFetchedCount} raw rows, ${coverage.rawInCoverageCount} rows inside the harvest window, and ${coverage.uniquePermitCount} unique permits after dedupe.`
  );

  if (!harvestedPermits.length) {
    return {
      permits: [],
      coverage,
      notes: [
        'Live pull mode. Data is fetched directly from Jacksonville / Duval County JAXEPICS public endpoints at run time.',
        'Search pagination is walked bucket-by-bucket until the source is exhausted or the sorted results move past the requested harvest date window.'
      ]
    };
  }

  log('info', `Fetching permit detail for ${harvestedPermits.length} unique Jacksonville permits.`);

  const permits = await mapWithConcurrency(harvestedPermits, JACKSONVILLE_DETAIL_CONCURRENCY, async (permit) => {
    try {
      const detail = await fetchPermitDetail(permit.id);
      return normalizePermit(permit, detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown detail error';
      log('warn', `Permit detail ${permit.id} failed, falling back to search payload only: ${message}`);
      return normalizePermitFromSearch(permit);
    }
  });

  const normalizedPermits = permits.filter((permit): permit is NormalizedPermit => Boolean(permit));
  log('info', `Normalized ${normalizedPermits.length} Jacksonville permits after detail enrichment.`);

  return {
    permits: normalizedPermits,
    coverage,
    notes: [
      'Live pull mode. Data is fetched directly from Jacksonville / Duval County JAXEPICS public endpoints at run time.',
      'Search pagination is walked bucket-by-bucket until the source is exhausted or the sorted results move past the requested harvest date window.',
      `Sweep terms: ${coverage.searchTerms.join(', ')}.`
    ]
  };
}

export const jacksonvilleSource: CitySource = {
  id: 'jacksonville-fl',
  cityLabel: 'Jacksonville, Florida / Duval County',
  sourceLabel: 'JAXEPICS public API',
  mode: 'live',
  getDefaultFilters: () => buildDefaultFilters(),
  notes: [
    'Broad harvest and final filters are separated so you can see source coverage even when export-ready results are narrower.',
    'Additional cities can be added by dropping another source module into src/lib/permit-harvester/sources and registering it.'
  ],
  fetchPermits: fetchJacksonvillePermits
};
