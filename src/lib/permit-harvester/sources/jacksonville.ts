import { buildDefaultFilters } from '../filters';
import type { NormalizedPermit, PermitHarvesterFilters, PermitOccupancy } from '../types';
import type { CitySource, SourceFetchResult, SourceLog } from './types';

const API_BASE = process.env.JAX_PERMITS_API_URL || 'https://jaxepicsapi.coj.net/api';
const REQUEST_RETRIES = 3;
const SEARCH_TERMS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const SEARCH_PAGE_SIZE = 40;
const MAX_DETAIL_FETCHES = 120;
const DETAIL_CONCURRENCY = 6;

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
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function normalizeOccupancy(value: string): PermitOccupancy {
  const normalized = value.toLowerCase();
  if (normalized.includes('non-residential')) return 'nonResidential';
  if (normalized.includes('residential')) return 'residential';
  return 'unknown';
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

function normalizePermit(search: JacksonvilleSearchItem, detail: JacksonvillePermitDetail): NormalizedPermit | null {
  const permitId = normalizeText(detail.PermitId || search.key);
  const dateIssued = normalizeText(detail.DateIssued || search.obj?.DateIssued);

  if (!permitId || !dateIssued) return null;

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
      search,
      detail
    }
  };
}

function searchItemMatchesHints(search: JacksonvilleSearchItem, filters: PermitHarvesterFilters): boolean {
  const permitType = normalizeText(search.obj?.PermitType);
  const issuedAt = normalizeText(search.obj?.DateIssued);
  const occupancy = normalizeOccupancy(normalizeText(search.obj?.ProposedUse));

  if (permitType.toLowerCase().includes('right of way')) return false;
  if (filters.permitType && permitType.toLowerCase() !== filters.permitType.toLowerCase()) return false;
  if (filters.occupancy !== 'all' && occupancy !== 'unknown' && occupancy !== filters.occupancy) return false;

  if (filters.dateFrom || filters.dateTo) {
    const issuedTime = parseTimestamp(issuedAt);
    const minTime = filters.dateFrom ? parseTimestamp(`${filters.dateFrom}T00:00:00`) : 0;
    const maxTime = filters.dateTo ? parseTimestamp(`${filters.dateTo}T23:59:59`) : Number.MAX_SAFE_INTEGER;

    if (issuedTime && (issuedTime < minTime || issuedTime > maxTime)) return false;
  }

  return true;
}

async function searchByTerm(term: string): Promise<JacksonvilleSearchItem[]> {
  const params = new URLSearchParams({
    searchTerm: term,
    page: '1',
    pageSize: String(SEARCH_PAGE_SIZE),
    sortActive: 'DateIssued',
    sortDirection: 'desc'
  });

  const response = await fetchJson<JacksonvilleSearchResponse>(buildApiUrl('Searches/Permits/AddressSearch', params), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ''
  });

  return response.values || [];
}

async function fetchPermitDetail(id: string): Promise<JacksonvillePermitDetail> {
  return fetchJson<JacksonvillePermitDetail>(buildApiUrl(`Permits/${id}`));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function fetchJacksonvillePermits({
  filters,
  log
}: {
  filters: PermitHarvesterFilters;
  log: SourceLog;
}): Promise<SourceFetchResult> {
  log('info', 'Jacksonville live pull started against the JAXEPICS public API.');
  log('info', `Running ${SEARCH_TERMS.length} seeded address-search queries (0-9) to collect recent public permit hits.`);

  const searchBatches = await Promise.all(
    SEARCH_TERMS.map(async (term) => {
      try {
        const values = await searchByTerm(term);
        return values;
      } catch (error) {
        log('warn', `Search term "${term}" failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return [];
      }
    })
  );

  const rawSearchHits = searchBatches.flat();
  log('info', `Received ${rawSearchHits.length} raw search hits from JAXEPICS.`);

  const deduped = new Map<string, JacksonvilleSearchItem>();
  for (const item of rawSearchHits) {
    const id = normalizeText(item.key);
    if (!id || deduped.has(id)) continue;
    if (!searchItemMatchesHints(item, filters)) continue;
    deduped.set(id, item);
  }

  const recentCandidates = Array.from(deduped.values())
    .sort((left, right) => parseTimestamp(normalizeText(right.obj?.DateIssued)) - parseTimestamp(normalizeText(left.obj?.DateIssued)))
    .slice(0, MAX_DETAIL_FETCHES);

  log('info', `${recentCandidates.length} unique recent permits remain after source-side hinting and deduping.`);

  const detailResults = await mapWithConcurrency(recentCandidates, DETAIL_CONCURRENCY, async (item) => {
    const permitId = normalizeText(item.key);

    try {
      const detail = await fetchPermitDetail(permitId);
      return normalizePermit(item, detail);
    } catch (error) {
      log('warn', `Permit detail ${permitId} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  });

  const permits = detailResults
    .filter((permit): permit is NormalizedPermit => Boolean(permit))
    .sort((left, right) => parseTimestamp(right.dateIssued) - parseTimestamp(left.dateIssued));

  log('info', `Normalized ${permits.length} Jacksonville permits from live JAXEPICS detail records.`);

  return {
    permits,
    notes: [
      'Live pull mode. Data is fetched directly from Jacksonville / Duval County JAXEPICS public endpoints at run time.',
      'Coverage is assembled from recent JAXEPICS AddressSearch seed queries (0-9) and then expanded with per-permit detail lookups.'
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
    'Designed to bias toward commercial opportunities by default with a $25k minimum and non-residential occupancy.',
    'Additional cities can be added by dropping another source module into src/lib/permit-harvester/sources and registering it.'
  ],
  fetchPermits: fetchJacksonvillePermits
};
