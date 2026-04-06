import 'server-only';

import { differenceInCalendarDays, format, isValid, parseISO, subDays } from 'date-fns';
import { access, readFile } from 'fs/promises';
import path from 'path';
import {
  buildBaseSummaryPromptForDebug,
  clearAiNarrativeCache,
  generateAndStoreBaseSummaries,
  generateAndStoreBaseSummary,
  generateAndStoreTradeNote,
  getStoredBaseSummaries,
  getStoredBaseSummary,
  getAiDebugState,
  getStoredTradeNote,
  getStoredTradeNotes,
  requestBaseSummaryTruth,
  saveBaseSummaryTruth,
  type StoredBaseSummary,
  type StoredTradeNote,
  type TruthStageResult
} from './ai';
import { JACKSONVILLE_SNAPSHOT, type JacksonvilleSnapshotRecord } from './jacksonville-snapshot';
import type { ActiveContact, ApplicableTrade, DashboardFilters, DashboardPayload, MarketPulse, OutreachDraft, PermitProject, SummaryStats } from './types';

const JAX_API_BASE =
  process.env.JAX_PERMITS_API_URL ||
  'https://jaxepicsapi.coj.net/api';

const CACHE_TTL_MS = 1000 * 60 * 10;
const REQUEST_RETRIES = 4;
const CONCURRENCY = 4;
const SUMMARY_BATCH_SIZE = 5;
const SUMMARY_BATCH_CONCURRENCY = 2;
const CONTENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'Version 13 • Summary First';
const JAX_SEARCH_TERMS = ['MAIN', 'ATLANTIC', 'BEACH', 'PHILIPS', 'SAN JOSE', 'BAYMEADOWS', 'UNIVERSITY', 'BLANDING', 'DUNN', 'ROOSEVELT'];
const JAX_SEARCH_PAGE_SIZE = 20;
const JAX_MAX_SOURCE_PROJECTS = 45;
const JACKSONVILLE_MERGED_PATH = path.join(process.cwd(), 'src/data/jacksonville-merged.json');
const JACKSONVILLE_JSON_PATH = path.join(process.cwd(), 'src/data/jacksonville-permits.json');

type JacksonvilleSearchItem = {
  title: string;
  description: string;
  key: string;
  link?: string;
  obj?: {
    Primary?: boolean | null;
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
  sortActive?: string;
  sortDirection?: string;
};

type JacksonvillePermitDetail = Record<string, unknown> & {
  PermitId?: number;
  FullPermitNumber?: string;
  PermitTypeDescription?: string;
  StatusDescription?: string;
  ProposedUseDescription?: string | null;
  StructureTypeDescription?: string | null;
  WorkTypeDescription?: string | null;
  DateIssued?: string | null;
  DateEntered?: string | null;
  TotalCost?: number | null;
  WorkDescription?: string | null;
  PropertyKey?: string | null;
  Address?: {
    FullAddress?: string | null;
    BaseAddress?: string | null;
    City?: string | null;
    State?: string | null;
    ZipCode?: string | null;
    Neighborhood?: string | null;
    Latitude?: number | null;
    Longitude?: number | null;
    CouncilDistrict?: string | number | null;
    CensusTract?: string | null;
    Re?: string | null;
  } | null;
  PropertyOwner?: Record<string, unknown> | null;
  PermitCompanies?: Array<Record<string, unknown>> | null;
  PermitWorkSubTypes?: Array<{ WorkSubTypeDescription?: string | null }> | null;
};

type JacksonvilleJsonRecord = {
  id?: string;
  city?: string;
  source?: string;
  address?: string;
  type?: string;
  description?: string;
  value?: number | string | null;
  dateIssued?: string;
  contact?: string;
  phone?: string | null;
  email?: string | null;
  occupancy?: string;
  permitNumber?: string;
  status?: string;
  raw?: Record<string, unknown>;
};

type JacksonvilleMergedApplicableTrade = {
  trade?: string;
  confidence?: string;
  reason?: string;
};

type JacksonvilleMergedContent = {
  readableSummary?: string;
  tradeSummary?: string;
  whyItMatters?: string;
  applicableTrades?: JacksonvilleMergedApplicableTrade[];
  outreachByTrade?: Record<string, { subject?: string; body?: string }>;
  normalizedTitle?: string;
};

type JacksonvilleMergedRecord = {
  datasetKey?: string;
  permitId?: string;
  rawPermit?: JacksonvilleJsonRecord;
  normalizedPermit?: Partial<JacksonvilleJsonRecord> & {
    permitId?: string;
    permitType?: string;
    likelyTrades?: string[];
    normalizedTitle?: string;
  };
  generatedContent?: JacksonvilleMergedContent;
  contentState?: {
    status?: string;
    contentVersion?: string;
  };
};

type JacksonvilleMergedMarketPulse = {
  generatedAt?: string;
  windowDays?: number;
  overallSummary?: string;
  tradeStatus?: Record<string, { label?: string; message?: string }>;
};

type JacksonvilleMergedDataset = {
  datasetMeta?: {
    marketPulse?: JacksonvilleMergedMarketPulse;
  };
  permits?: JacksonvilleMergedRecord[];
  records?: JacksonvilleMergedRecord[];
  items?: JacksonvilleMergedRecord[];
};

type CacheValue = {
  projects: PermitProject[];
  marketPulse: MarketPulse | null;
  fetchedAt: number;
};

let cache: CacheValue | null = null;
let inflight: Promise<CacheValue> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildApiUrl(path: string, params?: URLSearchParams): string {
  const normalizedBase = JAX_API_BASE.replace(/\/+$/, '');
  return `${normalizedBase}/${path.replace(/^\/+/, '')}${params ? `?${params.toString()}` : ''}`;
}

async function readJacksonvilleJsonRecords(): Promise<JacksonvilleJsonRecord[] | null> {
  try {
    await access(JACKSONVILLE_JSON_PATH);
    const raw = await readFile(JACKSONVILLE_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as JacksonvilleJsonRecord[];
    if (parsed && typeof parsed === 'object') {
      const wrapped = parsed as { permits?: JacksonvilleJsonRecord[]; records?: JacksonvilleJsonRecord[]; items?: JacksonvilleJsonRecord[] };
      if (Array.isArray(wrapped.permits)) return wrapped.permits;
      if (Array.isArray(wrapped.records)) return wrapped.records;
      if (Array.isArray(wrapped.items)) return wrapped.items;
    }
    return null;
  } catch {
    return null;
  }
}

async function readJacksonvilleMergedRecords(): Promise<{ records: JacksonvilleMergedRecord[]; marketPulse: MarketPulse | null } | null> {
  try {
    await access(JACKSONVILLE_MERGED_PATH);
    const raw = await readFile(JACKSONVILLE_MERGED_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        records: parsed as JacksonvilleMergedRecord[],
        marketPulse: null
      };
    }

    if (parsed && typeof parsed === 'object') {
      const dataset = parsed as JacksonvilleMergedDataset;
      const records = Array.isArray(dataset.permits)
        ? dataset.permits
        : Array.isArray(dataset.records)
        ? dataset.records
        : Array.isArray(dataset.items)
        ? dataset.items
        : [];

      return {
        records,
        marketPulse: normalizeMarketPulse(dataset.datasetMeta?.marketPulse)
      };
    }

    return null;
  } catch {
    return null;
  }
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
      throw new Error(`Jacksonville permit request failed with status ${response.status}`);
    }

    await sleep(400 * (attempt + 1));
    return fetchJson<T>(url, init, attempt + 1);
  }

  const data = (await response.json()) as T & { error?: { message?: string } };
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    if (attempt >= REQUEST_RETRIES) {
      throw new Error(data.error.message || 'Jacksonville permit API returned an error');
    }

    await sleep(400 * (attempt + 1));
    return fetchJson<T>(url, init, attempt + 1);
  }

  return data;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
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

function getText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function getNumeric(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIssueDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isCommercialSearchResult(result: JacksonvilleSearchItem): boolean {
  const permitType = getText(result.obj?.PermitType).toLowerCase();
  const proposedUse = getText(result.obj?.ProposedUse).toLowerCase();
  const structureType = getText(result.obj?.StructureType).toLowerCase();
  const workType = getText(result.obj?.WorkType).toLowerCase();
  const description = getText(result.description).toLowerCase();

  if (permitType.includes('right of way')) return false;
  if (proposedUse.includes('residential') && !proposedUse.includes('non-residential')) return false;
  if (proposedUse.includes('non-residential')) return true;

  return ['restaurant', 'retail', 'office', 'warehouse', 'church', 'medical', 'service station', 'industrial', 'school', 'hotel', 'utilities'].some(
    (term) => `${permitType} ${structureType} ${workType} ${description}`.includes(term)
  );
}

function inferNeighborhood(neighborhood: string, zip: string, address: string): string {
  if (neighborhood) return neighborhood;
  if (zip) return `ZIP ${zip}`;
  return address ? 'Jacksonville Corridor' : 'Jacksonville Area';
}

async function searchJacksonvillePermits(term: string): Promise<JacksonvilleSearchItem[]> {
  const params = new URLSearchParams({
    searchTerm: term,
    page: '1',
    pageSize: String(JAX_SEARCH_PAGE_SIZE),
    sortActive: 'DateIssued',
    sortDirection: 'desc'
  });

  const data = await fetchJson<JacksonvilleSearchResponse>(buildApiUrl('Searches/Permits/AddressSearch', params), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ''
  });

  return (data.values || []).filter(isCommercialSearchResult);
}

async function fetchJacksonvillePermitDetail(id: string): Promise<JacksonvillePermitDetail> {
  return fetchJson<JacksonvillePermitDetail>(buildApiUrl(`Permits/${id}`));
}

function buildMapsUrl(address: string, city: string, state: string, zip: string): string {
  const query = [address, city, state, zip].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || 'Jacksonville FL')}`;
}

function dedupeTrades(trades: string[]): string[] {
  return Array.from(new Set(trades));
}

function normalizeComparableTrade(value: string): string {
  return getText(value).trim().toLowerCase();
}

function comparableTradeCandidates(value: string): string[] {
  const normalized = normalizeComparableTrade(value);
  const candidates = new Set<string>([normalized]);

  if (normalized === 'hvac') candidates.add('mechanical');
  if (normalized === 'mechanical') candidates.add('hvac');
  if (normalized === 'general interiors') candidates.add('general construction');
  if (normalized === 'general construction') candidates.add('general interiors');
  if (normalized === 'framing') candidates.add('general construction');
  if (normalized === 'concrete') candidates.add('sitework');
  if (normalized === 'sitework') candidates.add('concrete');
  if (normalized === 'storefront') candidates.add('glazing');
  if (normalized === 'glazing') candidates.add('storefront');
  if (normalized === 'paint') candidates.add('painting');
  if (normalized === 'painting') candidates.add('paint');

  return [...candidates];
}

function normalizeApplicableTrades(trades: JacksonvilleMergedApplicableTrade[] | undefined, fallbackTrades: string[]): ApplicableTrade[] {
  const seen = new Set<string>();
  const normalized = (trades || [])
    .map((trade) => ({
      trade: getText(trade.trade),
      confidence: getText(trade.confidence) || 'unknown',
      reason: getText(trade.reason)
    }))
    .filter((trade) => {
      const key = normalizeComparableTrade(trade.trade);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (normalized.length) return normalized;

  return dedupeTrades(fallbackTrades)
    .map((trade) => ({
      trade,
      confidence: 'fallback',
      reason: ''
    }))
    .filter((trade) => trade.trade);
}

function normalizeOutreachByTrade(outreachByTrade: JacksonvilleMergedContent['outreachByTrade']): Record<string, OutreachDraft> | undefined {
  if (!outreachByTrade) return undefined;

  const entries = Object.entries(outreachByTrade)
    .map(([trade, draft]) => [
      trade,
      {
        subject: getText(draft?.subject),
        body: getText(draft?.body)
      }
    ] as const)
    .filter(([, draft]) => draft.subject || draft.body);

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeMarketPulse(value: JacksonvilleMergedMarketPulse | undefined): MarketPulse | null {
  if (!value) return null;

  const overallSummary = getText(value.overallSummary);
  const tradeStatusEntries = Object.entries(value.tradeStatus || {})
    .map(([trade, status]) => [
      trade,
      {
        label: getText(status?.label),
        message: getText(status?.message)
      }
    ] as const)
    .filter(([, status]) => status.message);

  if (!overallSummary && !tradeStatusEntries.length) return null;

  return {
    generatedAt: getText(value.generatedAt),
    windowDays: getNumeric(value.windowDays) ?? 7,
    overallSummary,
    tradeStatus: Object.fromEntries(tradeStatusEntries)
  };
}

function toSentenceCase(value: string): string {
  if (!value) return value;
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(/\b(sf|hvac|mep|poc)\b/g, (match) => match.toUpperCase())
    .replace(/(^\w|\.\s+\w)/g, (match) => match.toUpperCase());
}

function toAddressCase(value: string): string {
  const normalized = getText(value);
  if (!normalized) return '';

  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .replace(/\bNw\b/g, 'NW')
    .replace(/\bNe\b/g, 'NE')
    .replace(/\bSw\b/g, 'SW')
    .replace(/\bSe\b/g, 'SE')
    .replace(/\bPo\b/g, 'PO')
    .replace(/\bUs\b/g, 'US');
}

function normalizePermitText(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/…+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function extractPhone(text: string): string | null {
  const match = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  return match ? match[0].replace(/\s+/g, ' ').trim() : null;
}

function extractEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim() : null;
}

function cleanPurposeText(value: string): string {
  const normalized = normalizePermitText(value);
  if (!normalized) return '';

  const withoutContactBlocks = normalized
    .replace(/\bmaster permit\s*#?:?\s*[\w-]+/gi, '')
    .replace(/\bpermit\s*#?:?\s*[\w-]+/gi, '')
    .replace(/\bparent permit\s*#?:?\s*[\w-]+/gi, '')
    .replace(/\bPOC:.*$/i, '')
    .replace(/\bcontact:.*$/i, '')
    .replace(/\bapplicant:.*$/i, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g, '')
    .trim();

  const tightened = withoutContactBlocks
    .replace(/^to conduct\s+/i, '')
    .replace(/^to construct\s+/i, 'Construct ')
    .replace(/^to rehab\s+/i, 'Rehab ')
    .replace(/^to include\s+/i, 'Includes ')
    .replace(/^this permit is for\s+/i, '')
    .replace(/^permit for\s+/i, '')
    .replace(/^to\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = tightened
    .split(/(?<=[.?!])\s+|;\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const deduped = parts.filter((part) => {
    const key = part.toLowerCase().replace(/[^\w]+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return toSentenceCase(deduped.join(' ').replace(/\s+$/, ''));
}

function buildReadableSummary(permitSubtype: string, cleanedPurpose: string): string {
  if (!cleanedPurpose) return permitSubtype || 'Commercial permit activity in motion.';

  const firstSentence = cleanedPurpose.split(/(?<=[.?!])\s+/)[0]?.trim() || cleanedPurpose;
  if (firstSentence.length <= 120) return firstSentence;

  return `${firstSentence.slice(0, 117).trimEnd()}...`;
}

function hasNegativeRoofSignalText(value: string): boolean {
  const descriptor = value.toLowerCase();
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
    'tenant finish',
    'tenant improvement',
    'interior alterations only'
  ].some((term) => descriptor.includes(term));
}

function hasPositiveRoofSignalText(value: string): boolean {
  const descriptor = value.toLowerCase();
  return ['roof replacement', 'reroof', 're-roof', 'roof repair', 'roofing', 'roof deck', 'sheet metal', 'flashing', 'waterproofing', 'siding'].some(
    (term) => descriptor.includes(term)
  );
}

function deriveNotes(permitType: string, permitSubtype: string, purpose: string): { whyItMatters: string; likelyTrades: string[] } {
  const descriptor = `${permitType} ${permitSubtype} ${purpose}`.toLowerCase();
  const trades: string[] = [];
  let whyItMatters = 'Commercial permit with active scope and enough valuation to matter for serious subcontractor follow-up.';
  const suppressRoofing = hasNegativeRoofSignalText(descriptor) && !hasPositiveRoofSignalText(descriptor);

  if (descriptor.includes('tenant finish') || descriptor.includes('build-out') || descriptor.includes('interior')) {
    whyItMatters = 'Interior build-out with active coordination and finish work likely moving quickly.';
    trades.push('drywall', 'electrical', 'HVAC', 'ceilings', 'flooring');
  }
  if (descriptor.includes('office')) {
    whyItMatters = 'Office renovation or fit-out where interiors, power, and comfort systems are usually in play.';
    trades.push('demolition', 'framing', 'electrical', 'HVAC', 'flooring');
  }
  if (descriptor.includes('retail')) {
    whyItMatters = 'Retail scope usually brings fast-turn interiors, storefront work, and coordinated MEP packages.';
    trades.push('storefront', 'electrical', 'HVAC', 'ceilings', 'flooring');
  }
  if (descriptor.includes('restaurant')) {
    whyItMatters = 'Restaurant work often needs dense MEP coordination, kitchen support, and finish trades on a tight schedule.';
    trades.push('plumbing', 'electrical', 'HVAC', 'fire protection', 'tile');
  }
  if (descriptor.includes('medical') || descriptor.includes('clinic') || descriptor.includes('hospital')) {
    whyItMatters = 'Medical upgrade work usually pulls mechanical, electrical, plumbing, and specialty finish scopes together.';
    trades.push('HVAC', 'electrical', 'plumbing', 'doors and hardware', 'specialty finishes');
  }
  if (descriptor.includes('shell') || descriptor.includes('foundation') || descriptor.includes('new')) {
    whyItMatters = 'Early-stage commercial work where core trades and exterior systems can position before the job tightens up.';
    trades.push('concrete', 'steel', 'framing', 'electrical', 'plumbing', 'HVAC');
    if (!suppressRoofing && !descriptor.includes('interior')) trades.push('roofing');
  }
  if (!suppressRoofing && hasPositiveRoofSignalText(descriptor)) {
    whyItMatters = 'Envelope-focused permit with roofing, sheet metal, and exterior repair scopes likely relevant.';
    trades.push('roofing', 'sheet metal', 'waterproofing', 'exterior finishes');
  }
  if (!trades.length) {
    trades.push('electrical', 'HVAC', 'plumbing', 'drywall', 'flooring');
  }

  return { whyItMatters, likelyTrades: dedupeTrades(trades) };
}

function normalizeAddressLine(detail: JacksonvillePermitDetail, fallback: string): string {
  const baseAddress = getText(detail.Address?.BaseAddress);
  if (baseAddress) return toAddressCase(baseAddress);

  const fullAddress = getText(detail.Address?.FullAddress);
  if (fullAddress) {
    return toAddressCase(
      fullAddress
        .replace(/\s+JACKSONVILLE,?\s+FL\s+\d{5}(?:-\d{4})?$/i, '')
        .replace(/\s+FL\s+\d{5}(?:-\d{4})?$/i, '')
        .trim()
    );
  }

  return toAddressCase(fallback);
}

function getPrimaryCompany(detail: JacksonvillePermitDetail): Record<string, unknown> | null {
  const companies = Array.isArray(detail.PermitCompanies) ? detail.PermitCompanies : [];
  return companies.find((company) => company.IsPrimary) || companies[0] || null;
}

function getCompanyName(detail: JacksonvillePermitDetail): string {
  const company = getPrimaryCompany(detail);
  const companyUser = company?.Company as Record<string, unknown> | undefined;
  const contractor = company?.Contractor as Record<string, unknown> | undefined;
  const owner = detail.PropertyOwner as Record<string, unknown> | undefined;

  return (
    getText(companyUser?.BusinessName) ||
    getText(companyUser?.DisplayName) ||
    getText(contractor?.DisplayName) ||
    getText(owner?.DisplayName) ||
    'Contact not listed'
  );
}

function getPhoneFromUser(user?: Record<string, unknown>): string | null {
  const directPhone = getText(user?.Phone);
  if (directPhone && directPhone !== '0') return directPhone;

  const phones = Array.isArray(user?.UserPhoneNumbers) ? user.UserPhoneNumbers : [];
  for (const entry of phones) {
    const number = getText((entry as Record<string, unknown>)?.PhoneNumber && (entry as { PhoneNumber?: Record<string, unknown> }).PhoneNumber?.Number);
    if (number) return number;
  }

  return null;
}

function getCompanyPhone(detail: JacksonvillePermitDetail): string | null {
  const company = getPrimaryCompany(detail);
  const companyUser = company?.Company as Record<string, unknown> | undefined;
  const contractor = company?.Contractor as Record<string, unknown> | undefined;
  const owner = detail.PropertyOwner as Record<string, unknown> | undefined;

  return getPhoneFromUser(companyUser) || getPhoneFromUser(contractor) || getPhoneFromUser(owner);
}

function getCompanyEmail(detail: JacksonvillePermitDetail): string | null {
  const company = getPrimaryCompany(detail);
  const companyUser = company?.Company as Record<string, unknown> | undefined;
  const contractor = company?.Contractor as Record<string, unknown> | undefined;
  const owner = detail.PropertyOwner as Record<string, unknown> | undefined;

  return getText(companyUser?.Email) || getText(contractor?.Email) || getText(owner?.Email) || null;
}

function buildJacksonvillePurpose(detail: JacksonvillePermitDetail, result: JacksonvilleSearchItem): string {
  const rawWorkDescription = getText(detail.WorkDescription);
  if (rawWorkDescription) return rawWorkDescription;

  const permitType = getText(detail.PermitTypeDescription || result.obj?.PermitType);
  const workType = getText(detail.WorkTypeDescription || result.obj?.WorkType);
  const structureType = getText(detail.StructureTypeDescription || result.obj?.StructureType);
  const proposedUse = getText(detail.ProposedUseDescription || result.obj?.ProposedUse);
  const address = normalizeAddressLine(detail, getText(result.obj?.Address));

  return [permitType, proposedUse, workType, structureType ? `for ${structureType}` : '', address ? `at ${address}` : '']
    .filter(Boolean)
    .join(' ');
}

function projectFromSnapshot(record: JacksonvilleSnapshotRecord): PermitProject {
  const purpose = cleanPurposeText(record.purpose) || record.purpose;
  const readableSummary = buildReadableSummary(record.permitSubtype || record.permitType, purpose);
  const { whyItMatters, likelyTrades } = deriveNotes(record.permitType, record.permitSubtype, purpose);

  return {
    id: record.id,
    objectId: Number(record.id),
    permitNumber: record.permitNumber,
    permitType: record.permitType,
    permitSubtype: record.permitSubtype,
    address: toAddressCase(record.address),
    city: record.city,
    state: record.state,
    zip: record.zip,
    neighborhood: record.neighborhood,
    contactName: record.contactName || 'Contact not listed',
    contactPhone: record.contactPhone,
    contactEmail: record.contactEmail,
    rawPurpose: record.purpose,
    purpose,
    readableSummary,
    tradeSummary: '',
    valuation: record.valuation,
    issueDate: record.issueDate,
    issueDateLabel: format(parseISO(record.issueDate), 'MMM d, yyyy'),
    mapsUrl: buildMapsUrl(record.address, record.city, record.state, record.zip),
    whyItMatters,
    likelyTrades,
    isTradeRelevant: null,
    summarySource: 'fallback',
    tradeSource: 'fallback',
    coordinates: {
      lat: record.lat,
      lon: record.lon
    },
    rawFields: {
      'Permit #': record.permitNumber,
      'Permit type': record.permitType || 'N/A',
      'Permit subtype': record.permitSubtype || 'N/A',
      Address: record.address || 'N/A',
      City: record.city || 'N/A',
      State: record.state || 'N/A',
      ZIP: record.zip || 'N/A',
      Neighborhood: record.neighborhood || 'N/A',
      Contact: record.contactName || 'N/A',
      'Contact phone': record.contactPhone || 'N/A',
      'Contact email': record.contactEmail || 'N/A',
      Purpose: purpose || 'N/A',
      'Estimated valuation': record.valuation
        ? record.valuation.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
        : 'N/A',
      'Issue date': format(parseISO(record.issueDate), 'MMM d, yyyy'),
      Latitude: String(record.lat),
      Longitude: String(record.lon)
    }
  };
}

function inferPermitType(type: string): string {
  const parts = type.split('/').map((part) => part.trim()).filter(Boolean);
  return parts[0] || 'Permit';
}

function inferPermitSubtype(type: string): string {
  const parts = type.split('/').map((part) => part.trim()).filter(Boolean);
  return parts.slice(1).join(', ');
}

function inferNeighborhoodFromJson(record: JacksonvilleJsonRecord): string {
  const rawDetail = (record.raw?.detail as { Address?: { Neighborhood?: string | null } } | undefined)?.Address;
  return getText(rawDetail?.Neighborhood) || 'Jacksonville Area';
}

function inferZipFromJson(record: JacksonvilleJsonRecord): string {
  const rawDetail = (record.raw?.detail as { Address?: { ZipCode?: string | null } } | undefined)?.Address;
  return getText(rawDetail?.ZipCode);
}

function inferCoordinatesFromJson(record: JacksonvilleJsonRecord): { lat: number | null; lon: number | null } {
  const rawDetail =
    (record.raw?.detail as { Address?: { Latitude?: number | null; Longitude?: number | null } } | undefined)?.Address;

  return {
    lat: getNumeric(rawDetail?.Latitude),
    lon: getNumeric(rawDetail?.Longitude)
  };
}

function projectFromJsonRecord(record: JacksonvilleJsonRecord): PermitProject | null {
  const id = getText(record.id);
  const issueDate = parseIssueDate(record.dateIssued);
  if (!id || !issueDate) return null;

  const permitType = inferPermitType(getText(record.type));
  const permitSubtype = inferPermitSubtype(getText(record.type));
  const rawPurpose = getText(record.description);
  const purpose = cleanPurposeText(rawPurpose) || rawPurpose;
  const readableSummary = buildReadableSummary(permitSubtype || permitType, purpose);
  const { whyItMatters, likelyTrades } = deriveNotes(permitType, permitSubtype, purpose);
  const address = toAddressCase(getText(record.address));
  const city = getText(record.city) || 'Jacksonville';
  const state = 'FL';
  const zip = inferZipFromJson(record);
  const neighborhood = inferNeighborhoodFromJson(record);
  const valuation = getNumeric(record.value) ?? 0;
  const coordinates = inferCoordinatesFromJson(record);
  const permitNumber = getText(record.permitNumber) || `JAX-${id}`;

  return {
    id,
    objectId: Number(id),
    permitNumber,
    permitType,
    permitSubtype,
    address,
    city,
    state,
    zip,
    neighborhood,
    contactName: getText(record.contact) || 'Contact not listed',
    contactPhone: getText(record.phone) || null,
    contactEmail: getText(record.email) || null,
    rawPurpose,
    purpose,
    readableSummary,
    tradeSummary: '',
    valuation,
    issueDate: issueDate.toISOString(),
    issueDateLabel: format(issueDate, 'MMM d, yyyy'),
    mapsUrl: buildMapsUrl(address, city, state, zip),
    whyItMatters,
    likelyTrades,
    isTradeRelevant: null,
    summarySource: 'fallback',
    tradeSource: 'fallback',
    coordinates,
    rawFields: {
      'Permit #': permitNumber,
      'Permit type': permitType || 'N/A',
      'Permit subtype': permitSubtype || 'N/A',
      Address: address || 'N/A',
      City: city || 'N/A',
      State: state,
      ZIP: zip || 'N/A',
      Neighborhood: neighborhood || 'N/A',
      Contact: getText(record.contact) || 'N/A',
      'Contact phone': getText(record.phone) || 'N/A',
      'Contact email': getText(record.email) || 'N/A',
      Purpose: purpose || 'N/A',
      'Estimated valuation': valuation
        ? valuation.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
        : 'N/A',
      'Issue date': format(issueDate, 'MMM d, yyyy')
    }
  };
}

function projectFromMergedRecord(record: JacksonvilleMergedRecord): PermitProject | null {
  const normalized = record.normalizedPermit || {};
  const raw = record.rawPermit || {};
  const permitId = getText(normalized.permitId || raw.id || record.permitId);
  const issueDate = parseIssueDate(normalized.dateIssued || raw.dateIssued);
  if (!permitId || !issueDate) return null;

  const permitTypeText = getText(normalized.permitType || raw.type);
  const permitType = inferPermitType(permitTypeText);
  const permitSubtype = inferPermitSubtype(permitTypeText);
  const rawPurpose = getText(normalized.description || raw.description);
  const purpose = cleanPurposeText(rawPurpose) || rawPurpose;
  const fallbackNotes = deriveNotes(permitType, permitSubtype, purpose);
  const generated = record.generatedContent || {};
  const contentStatus = getText(record.contentState?.status).toLowerCase();
  const summaryReady = contentStatus === 'ready' && getText(generated.readableSummary).length > 0;
  const applicableTrades = normalizeApplicableTrades(generated.applicableTrades, normalized.likelyTrades || fallbackNotes.likelyTrades);
  const outreachByTrade = normalizeOutreachByTrade(generated.outreachByTrade);
  const address = toAddressCase(getText(normalized.address || raw.address));
  const city = getText(normalized.city || raw.city) || 'Jacksonville';
  const state = 'FL';
  const zip = inferZipFromJson(raw);
  const neighborhood = inferNeighborhoodFromJson(raw);
  const valuation = getNumeric(normalized.value ?? raw.value) ?? 0;
  const coordinates = inferCoordinatesFromJson(raw);
  const permitNumber = getText(normalized.permitNumber || raw.permitNumber) || `JAX-${permitId}`;
  const readableSummary = getText(generated.readableSummary) || buildReadableSummary(permitSubtype || permitType, purpose);
  const tradeSummary = getText(generated.tradeSummary);
  const whyItMatters = getText(generated.whyItMatters) || fallbackNotes.whyItMatters;
  const likelyTrades = dedupeTrades(applicableTrades.map((trade) => trade.trade).filter(Boolean).concat(normalized.likelyTrades || fallbackNotes.likelyTrades));

  return {
    id: permitId,
    objectId: Number(permitId),
    permitNumber,
    permitType,
    permitSubtype,
    address,
    city,
    state,
    zip,
    neighborhood,
    contactName: getText(raw.contact) || 'Contact not listed',
    contactPhone: getText(raw.phone) || null,
    contactEmail: getText(raw.email) || null,
    rawPurpose,
    purpose,
    readableSummary,
    tradeSummary,
    valuation,
    issueDate: issueDate.toISOString(),
    issueDateLabel: format(issueDate, 'MMM d, yyyy'),
    mapsUrl: buildMapsUrl(address, city, state, zip),
    whyItMatters,
    likelyTrades,
    applicableTrades,
    outreachByTrade,
    isTradeRelevant: null,
    summarySource: summaryReady ? 'ai' : 'fallback',
    tradeSource: applicableTrades.length || tradeSummary ? 'ai' : 'fallback',
    needsSummary: !summaryReady,
    needsTradeNote: false,
    needsSummaryRefresh: false,
    needsTradeNoteRefresh: false,
    coordinates,
    rawFields: {
      'Permit #': permitNumber,
      'Permit type': permitType || 'N/A',
      'Permit subtype': permitSubtype || 'N/A',
      Address: address || 'N/A',
      City: city || 'N/A',
      State: state,
      ZIP: zip || 'N/A',
      Neighborhood: neighborhood || 'N/A',
      Contact: getText(raw.contact) || 'N/A',
      'Contact phone': getText(raw.phone) || 'N/A',
      'Contact email': getText(raw.email) || 'N/A',
      Purpose: purpose || 'N/A',
      'Estimated valuation': valuation
        ? valuation.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
        : 'N/A',
      'Issue date': format(issueDate, 'MMM d, yyyy'),
      'Content status': getText(record.contentState?.status) || 'N/A',
      'Content version': getText(record.contentState?.contentVersion) || 'N/A'
    }
  };
}

function toProject(detail: JacksonvillePermitDetail, result: JacksonvilleSearchItem): PermitProject | null {
  const issueDate = parseIssueDate(detail.DateIssued || result.obj?.DateIssued);
  if (!issueDate) return null;

  const permitId = getNumeric(detail.PermitId ?? result.key);
  if (!permitId) return null;

  const permitType = getText(detail.PermitTypeDescription || result.obj?.PermitType);
  const permitSubtype =
    (Array.isArray(detail.PermitWorkSubTypes)
      ? detail.PermitWorkSubTypes.map((item) => getText(item.WorkSubTypeDescription)).filter(Boolean).join(', ')
      : '') ||
    getText(detail.WorkTypeDescription || result.obj?.WorkType);
  const rawPurpose = buildJacksonvillePurpose(detail, result);
  const purpose = cleanPurposeText(rawPurpose) || toSentenceCase(getText(result.description));
  const address = normalizeAddressLine(detail, getText(result.obj?.Address));
  const city = getText(detail.Address?.City) || 'Jacksonville';
  const state = getText(detail.Address?.State) || 'FL';
  const zip = getText(detail.Address?.ZipCode);
  const neighborhood = inferNeighborhood(getText(detail.Address?.Neighborhood), zip, address);
  const contactName = getCompanyName(detail);
  const contactPhone = getCompanyPhone(detail);
  const contactEmail = getCompanyEmail(detail);
  const valuation = getNumeric(detail.TotalCost) ?? 0;
  const { whyItMatters, likelyTrades } = deriveNotes(permitType, permitSubtype, purpose);
  const readableSummary = buildReadableSummary(permitSubtype || permitType, purpose);
  const lat = getNumeric(detail.Address?.Latitude);
  const lon = getNumeric(detail.Address?.Longitude);
  const permitNumber = getText(detail.FullPermitNumber || result.title) || `JAX-${permitId}`;

  const rawFields: Record<string, string> = {
    'Permit #': permitNumber,
    'Permit type': permitType || 'N/A',
    'Permit subtype': permitSubtype || 'N/A',
    Address: address || 'N/A',
    City: city || 'N/A',
    State: state || 'N/A',
    ZIP: zip || 'N/A',
    Neighborhood: neighborhood || 'N/A',
    Contact: contactName || 'N/A',
    'Contact phone': contactPhone || 'N/A',
    'Contact email': contactEmail || 'N/A',
    Purpose: purpose || 'N/A',
    'Estimated valuation': valuation ? valuation.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'N/A',
    'Issue date': format(issueDate, 'MMM d, yyyy'),
    'Property key': getText(detail.PropertyKey || detail.Address?.Re || result.obj?.PropertyKey) || 'N/A',
    'Council district': getText(detail.Address?.CouncilDistrict) || 'N/A',
    'Census tract': getText(detail.Address?.CensusTract) || 'N/A',
    Latitude: lat !== null ? String(lat) : 'N/A',
    Longitude: lon !== null ? String(lon) : 'N/A',
    'Date entered': (() => {
      const entered = parseIssueDate(detail.DateEntered);
      return entered ? format(entered, 'MMM d, yyyy') : 'N/A';
    })()
  };

  return {
    id: String(permitId),
    objectId: permitId,
    permitNumber,
    permitType,
    permitSubtype,
    address,
    city,
    state,
    zip,
    neighborhood,
    contactName,
    contactPhone,
    contactEmail,
    rawPurpose,
    purpose,
    readableSummary,
    tradeSummary: '',
    valuation,
    issueDate: issueDate.toISOString(),
    issueDateLabel: format(issueDate, 'MMM d, yyyy'),
    mapsUrl: buildMapsUrl(address, city, state, zip),
    whyItMatters,
    likelyTrades,
    isTradeRelevant: null,
    summarySource: 'fallback',
    tradeSource: 'fallback',
    coordinates: { lat, lon },
    rawFields
  };
}

function textsOverlap(left: string, right: string): boolean {
  const a = left.toLowerCase().replace(/[^\w]+/g, ' ').trim();
  const b = right.toLowerCase().replace(/[^\w]+/g, ' ').trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function findApplicableTrade(project: PermitProject, trade: string): ApplicableTrade | null {
  if (!trade.trim() || !project.applicableTrades?.length) return null;

  const candidates = comparableTradeCandidates(trade);
  for (const applicableTrade of project.applicableTrades) {
    const normalizedApplicable = normalizeComparableTrade(applicableTrade.trade);
    if (!normalizedApplicable) continue;
    if (
      candidates.some(
        (candidate) =>
          normalizedApplicable === candidate ||
          normalizedApplicable.includes(candidate) ||
          candidate.includes(normalizedApplicable)
      )
    ) {
      return applicableTrade;
    }
  }

  return null;
}

function hasEmbeddedGeneratedContent(project: PermitProject): boolean {
  return Boolean(project.summarySource === 'ai' || project.applicableTrades?.length || project.outreachByTrade);
}

function fallbackTradeDecision(project: PermitProject, trade: string): { isTradeRelevant: boolean | null; tradeReason: string } {
  if (!trade) return { isTradeRelevant: null, tradeReason: '' };

  const haystack = `${project.rawPurpose} ${project.purpose} ${project.permitType} ${project.permitSubtype} ${project.whyItMatters} ${project.likelyTrades.join(' ')}`.toLowerCase();
  const normalized = trade.trim().toLowerCase();

  if (normalized === 'roofing') {
    const negative = hasNegativeRoofSignalText(haystack);
    const positive = hasPositiveRoofSignalText(haystack);
    if (negative && !positive) {
      return { isTradeRelevant: false, tradeReason: '' };
    }
    return {
      isTradeRelevant: positive || haystack.includes('new construction') || haystack.includes('shell'),
      tradeReason: positive ? 'Roof or exterior scope appears to be part of this permit.' : ''
    };
  }

  const keywords: Record<string, string[]> = {
    plumbing: ['plumbing', 'fixture', 'restaurant', 'water', 'sewer'],
    electrical: ['electrical', 'power', 'lighting', 'panel'],
    hvac: ['hvac', 'mechanical', 'duct', 'air'],
    drywall: ['drywall', 'partition', 'framing', 'ceiling', 'interior'],
    flooring: ['flooring', 'tile', 'finish', 'interior'],
    concrete: ['concrete', 'foundation', 'slab', 'structural'],
    framing: ['framing', 'stud', 'partition', 'shell'],
    'fire protection': ['fire protection', 'sprinkler', 'life safety'],
    paint: ['paint', 'painting', 'finish', 'interior'],
    storefront: ['storefront', 'glazing', 'glass', 'façade', 'exterior'],
    'general interiors': ['interior', 'tenant', 'build-out', 'finish']
  };

  const matches = (keywords[normalized] || []).some((keyword) => haystack.includes(keyword));
  return { isTradeRelevant: matches, tradeReason: '' };
}

function buildBaseSummaryInput(project: PermitProject) {
  return {
    projectId: project.id,
    permitType: project.permitType,
    permitSubtype: project.permitSubtype,
    purpose: project.purpose || project.rawPurpose,
    valuation: project.valuation,
    location: project.address || project.neighborhood
  };
}

function buildTradeNoteInput(project: PermitProject, trade: string, summary: string) {
  return {
    projectId: project.id,
    permitType: project.permitType,
    permitSubtype: project.permitSubtype,
    purpose: project.purpose || project.rawPurpose,
    selectedTrade: trade,
    baseSummary: summary
  };
}

function applyNarrative(
  project: PermitProject,
  trade: string,
  storedBaseSummary?: StoredBaseSummary | null,
  storedTradeNote?: StoredTradeNote | null
): PermitProject {
  const fallbackTrade = fallbackTradeDecision(project, trade);
  const summary = storedBaseSummary?.summary?.trim() || project.readableSummary;
  const tradeSummary =
    storedTradeNote?.tradeNote && !textsOverlap(storedTradeNote.tradeNote, summary) && !textsOverlap(storedTradeNote.tradeNote, project.whyItMatters)
      ? storedTradeNote.tradeNote
      : fallbackTrade.tradeReason;
  const isTradeRelevant = trade
    ? storedTradeNote
      ? storedTradeNote.isTradeRelevant
      : fallbackTrade.isTradeRelevant
    : null;

  const enrichedProject: PermitProject = {
    ...project,
    readableSummary: summary,
    tradeSummary,
    isTradeRelevant,
    summarySource: storedBaseSummary ? 'ai' : 'fallback',
    tradeSource: trade ? (storedTradeNote ? 'ai' : 'fallback') : 'fallback',
    needsSummary: !storedBaseSummary,
    needsTradeNote: Boolean(trade) && !storedTradeNote,
    needsSummaryRefresh: Boolean(storedBaseSummary && storedBaseSummary.version !== CONTENT_VERSION),
    needsTradeNoteRefresh: Boolean(trade && storedTradeNote && storedTradeNote.version !== CONTENT_VERSION)
  };
  console.log(`FINAL SUMMARY SOURCE: ${enrichedProject.summarySource}`);
  console.log(`FINAL TRADE SOURCE: ${enrichedProject.tradeSource}`);
  console.log('FINAL SUMMARY:', enrichedProject.readableSummary);
  console.log('FINAL TRADE DECISION:', enrichedProject.isTradeRelevant ? 'relevant' : 'not relevant');
  return enrichedProject;
}

function applyEmbeddedNarrative(project: PermitProject, trade: string): PermitProject {
  const fallbackTrade = fallbackTradeDecision(project, trade);
  const applicableTrade = findApplicableTrade(project, trade);
  const summary = project.readableSummary;
  const tradeReasonFromContent = getText(applicableTrade?.reason || project.tradeSummary);
  const tradeSummary =
    tradeReasonFromContent && !textsOverlap(tradeReasonFromContent, summary) && !textsOverlap(tradeReasonFromContent, project.whyItMatters)
      ? tradeReasonFromContent
      : fallbackTrade.tradeReason;
  const isTradeRelevant = trade ? (applicableTrade ? true : fallbackTrade.isTradeRelevant) : null;

  const enrichedProject: PermitProject = {
    ...project,
    tradeSummary,
    isTradeRelevant,
    summarySource: project.summarySource,
    tradeSource: trade ? (project.applicableTrades?.length || project.tradeSummary ? 'ai' : 'fallback') : project.tradeSource,
    needsSummary: project.summarySource !== 'ai',
    needsTradeNote: false,
    needsSummaryRefresh: false,
    needsTradeNoteRefresh: false
  };
  console.log(`FINAL SUMMARY SOURCE: ${enrichedProject.summarySource}`);
  console.log(`FINAL TRADE SOURCE: ${enrichedProject.tradeSource}`);
  console.log('FINAL SUMMARY:', enrichedProject.readableSummary);
  console.log('FINAL TRADE DECISION:', enrichedProject.isTradeRelevant ? 'relevant' : 'not relevant');
  return enrichedProject;
}

async function enrichProjectNarrative(project: PermitProject, trade: string): Promise<PermitProject> {
  if (hasEmbeddedGeneratedContent(project)) {
    return applyEmbeddedNarrative(project, trade);
  }

  const storedSummary = await getStoredBaseSummary(buildBaseSummaryInput(project));
  const summary = storedSummary.summary?.summary || null;
  const storedTrade = trade ? await getStoredTradeNote(buildTradeNoteInput(project, trade, summary || project.readableSummary)) : null;
  console.log('AI CACHE STATUS:', storedTrade?.cacheStatus || storedSummary.cacheStatus);
  return applyNarrative(project, trade, storedSummary.summary, storedTrade?.tradeNote || null);
}

async function enrichProjects(projects: PermitProject[], trade = ''): Promise<PermitProject[]> {
  if (!projects.length) return [];

  const embeddedIds = new Set(projects.filter(hasEmbeddedGeneratedContent).map((project) => project.id));
  const fallbackProjects = projects.filter((project) => !embeddedIds.has(project.id));

  if (!fallbackProjects.length) {
    return projects.map((project) => applyEmbeddedNarrative(project, trade));
  }

  const summaryLookups = await getStoredBaseSummaries(fallbackProjects.map((project) => buildBaseSummaryInput(project)));
  const tradeInputs = trade
    ? fallbackProjects.map((project) => {
        const summary = summaryLookups.get(project.id)?.summary?.summary || project.readableSummary;
        return buildTradeNoteInput(project, trade, summary);
      })
    : [];
  const tradeLookups = trade ? await getStoredTradeNotes(tradeInputs) : new Map();

  return projects.map((project) => {
    if (embeddedIds.has(project.id)) {
      return applyEmbeddedNarrative(project, trade);
    }
    const summary = summaryLookups.get(project.id)?.summary || null;
    const tradeNote = trade ? tradeLookups.get(project.id)?.tradeNote || null : null;
    return applyNarrative(project, trade, summary, tradeNote);
  });
}

async function loadProjects(): Promise<CacheValue> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const mergedRecords = await readJacksonvilleMergedRecords();
    const jsonRecords = await readJacksonvilleJsonRecords();
    const projects = (mergedRecords?.records.length
      ? mergedRecords.records.map(projectFromMergedRecord).filter((project): project is PermitProject => Boolean(project))
      : jsonRecords?.length
      ? jsonRecords.map(projectFromJsonRecord).filter((project): project is PermitProject => Boolean(project))
      : JACKSONVILLE_SNAPSHOT.map(projectFromSnapshot))
      .sort((left, right) => {
        if (left.issueDate === right.issueDate) return right.valuation - left.valuation;
        return right.issueDate.localeCompare(left.issueDate);
      });

    const nextCache = { projects, marketPulse: mergedRecords?.marketPulse || null, fetchedAt: Date.now() };
    cache = nextCache;
    inflight = null;
    return nextCache;
  })().catch((error) => {
    inflight = null;
    throw error;
  });

  return inflight;
}

export function getDefaultFilters(): DashboardFilters {
  const today = new Date();
  return {
    minBudget: 50000,
    maxBudget: 25000000,
    dateFrom: format(subDays(today, 365), 'yyyy-MM-dd'),
    dateTo: format(today, 'yyyy-MM-dd'),
    permitType: '',
    neighborhood: '',
    contractorQuery: '',
    sort: 'newest'
  };
}

function sanitizeFilters(input?: Partial<DashboardFilters>): DashboardFilters {
  const defaults = getDefaultFilters();
  return {
    minBudget: input?.minBudget ?? defaults.minBudget,
    maxBudget: defaults.maxBudget,
    dateFrom: input?.dateFrom || defaults.dateFrom,
    dateTo: input?.dateTo || defaults.dateTo,
    permitType: input?.permitType || '',
    neighborhood: input?.neighborhood || '',
    contractorQuery: input?.contractorQuery || '',
    sort: input?.sort || defaults.sort
  };
}

function matchesFilters(project: PermitProject, filters: DashboardFilters): boolean {
  if (project.valuation < filters.minBudget) return false;

  const issueDate = parseISO(project.issueDate);
  const from = filters.dateFrom ? parseISO(`${filters.dateFrom}T00:00:00.000Z`) : null;
  const to = filters.dateTo ? parseISO(`${filters.dateTo}T23:59:59.999Z`) : null;

  if (from && isValid(from) && issueDate < from) return false;
  if (to && isValid(to) && issueDate > to) return false;

  if (filters.permitType) {
    const selected = filters.permitType.toLowerCase();
    const haystack = `${project.permitType} ${project.permitSubtype}`.toLowerCase();
    if (!haystack.includes(selected)) return false;
  }

  if (filters.neighborhood) {
    const query = filters.neighborhood.trim().toLowerCase();
    const locationHaystack = `${project.neighborhood} ${project.address} ${project.zip} ${project.purpose}`.toLowerCase();
    if (!locationHaystack.includes(query)) return false;
  }

  if (filters.contractorQuery) {
    const query = filters.contractorQuery.trim().toLowerCase();
    if (!project.contactName.toLowerCase().includes(query)) return false;
  }

  return true;
}

function sortProjects(projects: PermitProject[], sort: DashboardFilters['sort']): PermitProject[] {
  const next = [...projects];

  if (sort === 'highest') {
    next.sort((left, right) => right.valuation - left.valuation || right.issueDate.localeCompare(left.issueDate));
    return next;
  }

  if (sort === 'lowest') {
    next.sort((left, right) => left.valuation - right.valuation || right.issueDate.localeCompare(left.issueDate));
    return next;
  }

  next.sort((left, right) => right.issueDate.localeCompare(left.issueDate) || right.valuation - left.valuation);
  return next;
}

function summarize(projects: PermitProject[]): SummaryStats {
  const today = new Date();

  return {
    totalProjects: projects.length,
    totalValuation: projects.reduce((sum, project) => sum + project.valuation, 0),
    recentPermits: projects.filter((project) => {
      const issued = parseISO(project.issueDate);
      return isValid(issued) && differenceInCalendarDays(today, issued) <= 30;
    }).length,
    activeContacts: new Set(projects.map((project) => project.contactName).filter((name) => name && name !== 'Contact not listed')).size
  };
}

function buildActiveContacts(projects: PermitProject[]): ActiveContact[] {
  const buckets = new Map<string, ActiveContact>();

  for (const project of projects) {
    if (!project.contactName || project.contactName === 'Contact not listed') continue;

    const existing = buckets.get(project.contactName);
    if (!existing) {
      buckets.set(project.contactName, {
        name: project.contactName,
        projectCount: 1,
        totalValuation: project.valuation,
        mostRecentPermit: project.issueDate,
        mostRecentPermitAddress: project.address,
        mostRecentPermitSummary: project.readableSummary,
        mostRecentPermitType: project.permitSubtype || project.permitType,
        mostRecentProjectId: project.id,
        mostRecentApplicableTrades: project.applicableTrades,
        mostRecentOutreachByTrade: project.outreachByTrade,
        phone: project.contactPhone,
        email: project.contactEmail
      });
      continue;
    }

    existing.projectCount += 1;
    existing.totalValuation += project.valuation;
    if (project.issueDate > existing.mostRecentPermit) {
      existing.mostRecentPermit = project.issueDate;
      existing.mostRecentPermitAddress = project.address;
      existing.mostRecentPermitSummary = project.readableSummary;
      existing.mostRecentPermitType = project.permitSubtype || project.permitType;
      existing.mostRecentProjectId = project.id;
      existing.mostRecentApplicableTrades = project.applicableTrades;
      existing.mostRecentOutreachByTrade = project.outreachByTrade;
    }
    if (!existing.phone && project.contactPhone) existing.phone = project.contactPhone;
    if (!existing.email && project.contactEmail) existing.email = project.contactEmail;
  }

  return [...buckets.values()].sort((left, right) => right.mostRecentPermit.localeCompare(left.mostRecentPermit) || right.projectCount - left.projectCount || right.totalValuation - left.totalValuation);
}

function safePreview(value: string, max = 320): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max).trimEnd()}...`;
}

function buildDebugPayload(
  summarySource: DashboardPayload['debug']['lastSummarySource'],
  tradeSource: DashboardPayload['debug']['lastTradeSource'],
  options?: {
    storedAiCount?: number;
    needsSummaryCount?: number;
    needsTradeNoteCount?: number;
    needsRefreshCount?: number;
    lastGenerateActionResult?: string;
    lastRegenerateActionResult?: string;
  }
) {
  const aiDebug = getAiDebugState();
  return {
    ...aiDebug,
    lastCacheStatus: aiDebug.lastCacheStatus,
    storedAiCount: options?.storedAiCount ?? 0,
    needsSummaryCount: options?.needsSummaryCount ?? 0,
    needsTradeNoteCount: options?.needsTradeNoteCount ?? 0,
    needsRefreshCount: options?.needsRefreshCount ?? 0,
    lastGenerateActionResult: options?.lastGenerateActionResult || '',
    lastRegenerateActionResult: options?.lastRegenerateActionResult || '',
    lastSummarySource: summarySource,
    lastTradeSource: tradeSource
  };
}

export async function getDashboardPayload(input?: Partial<DashboardFilters>, trade = ''): Promise<DashboardPayload> {
  const { projects, marketPulse, fetchedAt } = await loadProjects();
  const filters = sanitizeFilters(input);
  const filteredProjects = sortProjects(projects.filter((project) => matchesFilters(project, filters)), filters.sort);
  const visibleProjects = filteredProjects.slice(0, 120);
  const enrichedProjects = await enrichProjects(visibleProjects, trade);
  const lastProject = enrichedProjects[0];
  const storedAiCount = enrichedProjects.filter((project) => project.summarySource === 'ai').length;
  const needsSummaryCount = enrichedProjects.filter((project) => project.needsSummary).length;
  const needsTradeNoteCount = enrichedProjects.filter((project) => project.needsTradeNote).length;
  const needsRefreshCount = enrichedProjects.filter((project) => project.needsSummaryRefresh || project.needsTradeNoteRefresh).length;
  const featuredProjects = enrichedProjects.slice(0, 5);

  console.log('BIDHAMMER JOBS DIAGNOSTICS', {
    totalPermitsLoaded: projects.length,
    totalPermitsAfterTopLevelFilter: filteredProjects.length,
    featuredPermitId: featuredProjects[0]?.id || null,
    permitsRemainingAfterFeaturedExclusion: Math.max(enrichedProjects.length - featuredProjects.length, 0),
    jobsInProgressCount: enrichedProjects.filter((project) => {
      const issued = parseISO(project.issueDate);
      return isValid(issued) && differenceInCalendarDays(new Date(), issued) > 7 && differenceInCalendarDays(new Date(), issued) <= 30;
    }).length,
    earlierJobsCount: enrichedProjects.filter((project) => {
      const issued = parseISO(project.issueDate);
      return isValid(issued) && differenceInCalendarDays(new Date(), issued) > 30;
    }).length,
    sampleResolvedDates: enrichedProjects.slice(0, 5).map((project) => ({
      id: project.id,
      issueDate: project.issueDate,
      parsedIssueDate: parseISO(project.issueDate).toISOString()
    })),
    invalidDatePermitIds: enrichedProjects.filter((project) => !isValid(parseISO(project.issueDate))).map((project) => project.id).slice(0, 20)
  });

  return {
    filters,
    summary: summarize(filteredProjects),
    marketPulse,
    featured: featuredProjects,
    projects: enrichedProjects,
    activeContacts: buildActiveContacts(filteredProjects),
    availablePermitTypes: Array.from(new Set(projects.map((project) => project.permitSubtype || project.permitType).filter(Boolean))).sort(),
    availableNeighborhoods: Array.from(new Set(projects.map((project) => project.neighborhood).filter(Boolean))).sort(),
    asOf: new Date(fetchedAt).toISOString(),
    debug: buildDebugPayload(lastProject?.summarySource || 'unknown', lastProject?.tradeSource || 'unknown', {
      storedAiCount,
      needsSummaryCount,
      needsTradeNoteCount,
      needsRefreshCount
    })
  };
}

export async function getProjectById(id: string, trade = ''): Promise<PermitProject | null> {
  const { projects } = await loadProjects();
  const project = projects.find((project) => project.id === id) || null;
  if (!project) return null;
  return enrichProjectNarrative(project, trade);
}

export async function getProjectsByContact(name: string, filters?: Partial<DashboardFilters>, trade = ''): Promise<DashboardPayload & { contactName: string }> {
  const { projects: allProjects, marketPulse, fetchedAt } = await loadProjects();
  const nextFilters = sanitizeFilters(filters);
  const projects = allProjects.filter(
    (project) => project.contactName.toLowerCase() === name.toLowerCase() && matchesFilters(project, nextFilters)
  );
  const sorted = sortProjects(projects, nextFilters.sort);
  const enrichedProjects = await enrichProjects(sorted, trade);
  const lastProject = enrichedProjects[0];
  const storedAiCount = enrichedProjects.filter((project) => project.summarySource === 'ai').length;
  const needsSummaryCount = enrichedProjects.filter((project) => project.needsSummary).length;
  const needsTradeNoteCount = enrichedProjects.filter((project) => project.needsTradeNote).length;
  const needsRefreshCount = enrichedProjects.filter((project) => project.needsSummaryRefresh || project.needsTradeNoteRefresh).length;

  return {
    filters: nextFilters,
    contactName: name,
    summary: summarize(sorted),
    marketPulse,
    featured: enrichedProjects.slice(0, 5),
    projects: enrichedProjects,
    activeContacts: buildActiveContacts(sorted),
    availablePermitTypes: Array.from(new Set(allProjects.map((project) => project.permitSubtype || project.permitType).filter(Boolean))).sort(),
    availableNeighborhoods: Array.from(new Set(allProjects.map((project) => project.neighborhood).filter(Boolean))).sort(),
    asOf: new Date(fetchedAt).toISOString(),
    debug: buildDebugPayload(lastProject?.summarySource || 'unknown', lastProject?.tradeSource || 'unknown', {
      storedAiCount,
      needsSummaryCount,
      needsTradeNoteCount,
      needsRefreshCount
    })
  };
}

export async function regenerateProjectInterpretation(id: string, trade = '', options?: { bypassCache?: boolean }) {
  const { projects } = await loadProjects();
  const baseProject = projects.find((project) => project.id === id) || null;
  if (!baseProject) {
    return {
      project: null,
      debug: buildDebugPayload('unknown', 'unknown')
    };
  }

  const result = await generateAndStoreBaseSummary(buildBaseSummaryInput(baseProject), { bypassCache: options?.bypassCache ?? true });
  const project = await enrichProjectNarrative(baseProject, trade);

  return {
    project,
    debug: {
      ...buildDebugPayload(project?.summarySource || 'unknown', project?.tradeSource || 'unknown', {
        storedAiCount: project?.summarySource === 'ai' ? 1 : 0,
        needsSummaryCount: project?.needsSummary ? 1 : 0,
        needsTradeNoteCount: project?.needsTradeNote ? 1 : 0,
        needsRefreshCount: project?.needsSummaryRefresh || project?.needsTradeNoteRefresh ? 1 : 0,
        lastGenerateActionResult: result.resultSource === 'ai' ? `Stored summary for project ${id}.` : `Summary generation fell back for project ${id}.`
      }),
      lastCacheStatus: result.cacheStatus
    }
  };
}

export async function testProjectAiInterpretation(id: string, trade = '') {
  const { projects } = await loadProjects();
  const project = projects.find((candidate) => candidate.id === id) || null;
  if (!project) {
    return {
      project: null,
      debug: buildDebugPayload('unknown', 'unknown'),
      test: {
        attempted: false,
        resultSource: 'fallback' as const,
        failureReason: 'project not found',
        rawResponseText: '',
        rawResponseShape: '',
        cacheStatus: 'miss',
        cachedBefore: 'miss',
        parsedSummary: '',
        parsedTradeReason: '',
        parsedIsTradeRelevant: null
      }
    };
  }

  const cached = await getStoredBaseSummary(buildBaseSummaryInput(project));
  const summaryResult = await generateAndStoreBaseSummary(buildBaseSummaryInput(project), { bypassCache: true });
  const tradeResult =
    trade && summaryResult.parsedSummary
      ? await generateAndStoreTradeNote(buildTradeNoteInput(project, trade, summaryResult.parsedSummary), { bypassCache: true })
      : null;

  return {
    project,
    debug: buildDebugPayload('unknown', 'unknown'),
    test: {
      attempted: summaryResult.attempted || Boolean(tradeResult?.attempted),
      resultSource: tradeResult?.resultSource || summaryResult.resultSource,
      failureReason: tradeResult?.failureReason && tradeResult.failureReason !== 'success' ? tradeResult.failureReason : summaryResult.failureReason,
      rawResponseText: [summaryResult.rawResponseText, tradeResult?.rawResponseText || ''].filter(Boolean).join('\n---\n'),
      rawResponseShape: [summaryResult.rawResponseShape, tradeResult?.rawResponseShape || ''].filter(Boolean).join('\n---\n'),
      cacheStatus: tradeResult?.cacheStatus || summaryResult.cacheStatus,
      cachedBefore: cached.cacheStatus,
      parsedSummary: summaryResult.parsedSummary || '',
      parsedTradeReason: tradeResult?.parsedTradeNote || '',
      parsedIsTradeRelevant: tradeResult?.parsedIsTradeRelevant ?? null
    }
  };
}

export async function generateSummariesForProjects(
  ids: string[],
  trade = '',
  options?: { bypassCache?: boolean; regenerateTradeNotes?: boolean }
) {
  const { projects } = await loadProjects();
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  const selected = uniqueIds
    .map((id) => projects.find((project) => project.id === id) || null)
    .filter((project): project is PermitProject => Boolean(project));

  const results: Array<{ id: string; summarySource: 'ai' | 'fallback'; cacheStatus: string; failureReason: string; stored: boolean }> = [];
  for (const selectedChunk of chunk(selected, SUMMARY_BATCH_SIZE)) {
    const chunkResults = await generateAndStoreBaseSummaries(
      selectedChunk.map((project) => buildBaseSummaryInput(project)),
      {
        bypassCache: options?.bypassCache ?? false,
        concurrency: SUMMARY_BATCH_CONCURRENCY
      }
    );
    results.push(...chunkResults);

    if (options?.regenerateTradeNotes && trade) {
      await mapWithConcurrency(
        selectedChunk,
        async (project) => {
          const refreshedSummary = await getStoredBaseSummary(buildBaseSummaryInput(project));
          const summary = refreshedSummary.summary?.summary || project.readableSummary;
          await generateAndStoreTradeNote(buildTradeNoteInput(project, trade, summary), {
            bypassCache: options?.bypassCache ?? false
          });
        },
        SUMMARY_BATCH_CONCURRENCY
      );
    }
  }

  const refreshedProjects = await enrichProjects(selected, trade);
  const storedAiCount = refreshedProjects.filter((project) => project.summarySource === 'ai').length;
  const needsSummaryCount = refreshedProjects.filter((project) => project.needsSummary).length;
  const needsTradeNoteCount = refreshedProjects.filter((project) => project.needsTradeNote).length;
  const needsRefreshCount = refreshedProjects.filter((project) => project.needsSummaryRefresh || project.needsTradeNoteRefresh).length;
  const generatedCount = results.filter((result) => result.summarySource === 'ai').length;
  const failedCount = results.filter((result) => result.summarySource !== 'ai').length;

  return {
    results,
    projects: refreshedProjects,
    stats: {
      requested: selected.length,
      generated: generatedCount,
      failed: failedCount,
      batchSize: SUMMARY_BATCH_SIZE,
      concurrency: SUMMARY_BATCH_CONCURRENCY
    },
    debug: buildDebugPayload(
      refreshedProjects[0]?.summarySource || 'unknown',
      refreshedProjects[0]?.tradeSource || 'unknown',
      {
        storedAiCount,
        needsSummaryCount,
        needsTradeNoteCount,
        needsRefreshCount,
        lastGenerateActionResult: `Generated summaries for ${generatedCount} of ${selected.length} requested jobs. ${failedCount ? `${failedCount} failed and were left in fallback.` : 'No failures in this run.'}`,
        lastRegenerateActionResult: options?.bypassCache
          ? `Regenerated content for ${generatedCount} of ${selected.length} requested jobs.${failedCount ? ` ${failedCount} stayed on fallback.` : ''}`
          : ''
      }
    )
  };
}

export async function generateTradeNoteForProject(id: string, trade = '', options?: { bypassCache?: boolean }) {
  const { projects } = await loadProjects();
  const project = projects.find((candidate) => candidate.id === id) || null;
  if (!project) {
    return {
      project: null,
      debug: buildDebugPayload('unknown', 'unknown')
    };
  }

  const enriched = await enrichProjectNarrative(project, trade);
  const summary = enriched.readableSummary || project.readableSummary;
  const result = await generateAndStoreTradeNote(buildTradeNoteInput(project, trade, summary), {
    bypassCache: options?.bypassCache ?? true
  });
  const refreshed = await enrichProjectNarrative(project, trade);

  return {
    project: refreshed,
    debug: {
      ...buildDebugPayload(refreshed.summarySource, refreshed.tradeSource, {
        storedAiCount: refreshed.summarySource === 'ai' ? 1 : 0,
        needsSummaryCount: refreshed.needsSummary ? 1 : 0,
        needsTradeNoteCount: refreshed.needsTradeNote ? 1 : 0,
        needsRefreshCount: refreshed.needsSummaryRefresh || refreshed.needsTradeNoteRefresh ? 1 : 0,
        lastGenerateActionResult: result.resultSource === 'ai' ? `Stored trade note for project ${id}.` : `Trade note generation fell back for project ${id}.`
      }),
      lastCacheStatus: result.cacheStatus
    }
  };
}

export async function generateTradeNotesForProjects(ids: string[], trade = '', options?: { bypassCache?: boolean }) {
  if (!trade.trim()) {
    return {
      results: [] as Array<{ id: string; tradeSource: 'ai' | 'fallback'; cacheStatus: string; failureReason: string; stored: boolean }>,
      projects: [] as PermitProject[],
      debug: buildDebugPayload('unknown', 'unknown', {
        lastGenerateActionResult: 'Trade is required to generate visible trade notes.'
      })
    };
  }

  const { projects } = await loadProjects();
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  const selected = uniqueIds
    .map((id) => projects.find((project) => project.id === id) || null)
    .filter((project): project is PermitProject => Boolean(project));

  const results: Array<{ id: string; tradeSource: 'ai' | 'fallback'; cacheStatus: string; failureReason: string; stored: boolean }> = [];

  for (const selectedChunk of chunk(selected, SUMMARY_BATCH_SIZE)) {
    const chunkResults = await mapWithConcurrency(
      selectedChunk,
      async (project) => {
        const storedSummary = await getStoredBaseSummary(buildBaseSummaryInput(project));
        const summary = storedSummary.summary?.summary || project.readableSummary;
        const result = await generateAndStoreTradeNote(buildTradeNoteInput(project, trade, summary), {
          bypassCache: options?.bypassCache ?? false
        });

        return {
          id: project.id,
          tradeSource: result.resultSource,
          cacheStatus: result.cacheStatus,
          failureReason: result.failureReason,
          stored: result.stored
        };
      },
      SUMMARY_BATCH_CONCURRENCY
    );

    results.push(...chunkResults);
  }

  const refreshedProjects = await enrichProjects(selected, trade);
  const storedAiCount = refreshedProjects.filter((project) => project.summarySource === 'ai').length;
  const needsSummaryCount = refreshedProjects.filter((project) => project.needsSummary).length;
  const needsTradeNoteCount = refreshedProjects.filter((project) => project.needsTradeNote).length;
  const needsRefreshCount = refreshedProjects.filter((project) => project.needsSummaryRefresh || project.needsTradeNoteRefresh).length;
  const generatedCount = results.filter((result) => result.tradeSource === 'ai').length;
  const failedCount = results.filter((result) => result.tradeSource !== 'ai').length;

  return {
    results,
    projects: refreshedProjects,
    stats: {
      requested: selected.length,
      generated: generatedCount,
      failed: failedCount,
      batchSize: SUMMARY_BATCH_SIZE,
      concurrency: SUMMARY_BATCH_CONCURRENCY
    },
    debug: buildDebugPayload(refreshedProjects[0]?.summarySource || 'unknown', refreshedProjects[0]?.tradeSource || 'unknown', {
      storedAiCount,
      needsSummaryCount,
      needsTradeNoteCount,
      needsRefreshCount,
      lastGenerateActionResult: `Generated trade notes for ${generatedCount} of ${selected.length} requested jobs.${failedCount ? ` ${failedCount} stayed on fallback.` : ''}`
    })
  };
}

export async function runTruthModeTestForProject(id: string, trade = '') {
  const stages: TruthStageResult[] = [];
  const startedAt = Date.now();
  const { projects } = await loadProjects();

  const fetchStarted = Date.now();
  const project = projects.find((candidate) => candidate.id === id) || null;
  stages.push({
    stage: 'fetch_permit',
    success: Boolean(project),
    durationMs: Date.now() - fetchStarted,
    error: project ? undefined : 'project not found',
    preview: project ? safePreview(`${project.address} | ${project.permitSubtype || project.permitType}`) : undefined
  });

  if (!project) {
    return {
      projectId: id,
      selectedTrade: trade || '',
      stageResults: stages,
      finalResultSource: 'fallback' as const,
      finalVisibleSummary: '',
      rawResponsePreview: '',
      parsedSummary: '',
      parsedTradeNote: '',
      dbSaveResult: { success: false, reason: 'project not found' },
      dbReadBackResult: { success: false, reason: 'project not found' },
      uiVisibleFieldUpdated: false,
      failingStage: 'fetch_permit',
      openaiErrorMessage: '',
      openaiErrorName: '',
      openaiStatusCode: null,
      requestDurationMs: 0,
      apiKeyDetected: getAiDebugState().apiKeyPresent,
      clientInitialized: getAiDebugState().aiEnabled,
      dbErrorMessage: '',
      dbErrorName: '',
      dbErrorCode: ''
    };
  }

  const input = buildBaseSummaryInput(project);

  const promptStarted = Date.now();
  const prompt = buildBaseSummaryPromptForDebug(input);
  stages.push({
    stage: 'build_prompt',
    success: Boolean(prompt),
    durationMs: Date.now() - promptStarted,
    preview: safePreview(prompt, 220)
  });

  const aiResult = await requestBaseSummaryTruth(input);

  stages.push({
    stage: 'openai_request',
    success:
      aiResult.attempted &&
      !aiResult.failureReason.startsWith('request failed') &&
      aiResult.failureReason !== 'timeout' &&
      aiResult.failureReason !== 'missing key' &&
      aiResult.failureReason !== 'client init failed',
    durationMs: aiResult.requestDurationMs,
    error: aiResult.failureReason === 'success' || aiResult.failureReason === 'empty output' || aiResult.failureReason.startsWith('invalid JSON') || aiResult.failureReason === 'missing summary field'
      ? undefined
      : aiResult.failureReason
  });
  stages.push({
    stage: 'openai_response',
    success: Boolean(aiResult.rawResponseText),
    durationMs: 0,
    error: aiResult.rawResponseText ? undefined : aiResult.failureReason,
    preview: aiResult.rawResponseText ? safePreview(aiResult.rawResponseText) : aiResult.rawResponseShape
  });
  stages.push({
    stage: 'parse_response',
    success: Boolean(aiResult.parsedSummary),
    durationMs: 0,
    error: aiResult.parsedSummary ? undefined : aiResult.failureReason,
    preview: aiResult.parsedSummary ? aiResult.parsedSummary : undefined
  });

  let dbSaveResult = { success: false, reason: 'parse failed', cacheKey: '', storageKey: '', dbErrorMessage: '', dbErrorName: '', dbErrorCode: '' };
  let dbReadBackResult = { success: false, reason: 'parse failed', summary: '' };
  let uiVisibleFieldUpdated = false;
  let finalVisibleSummary = '';
  let finalResultSource: 'ai' | 'fallback' = 'fallback';
  let dbErrorMessage = '';
  let dbErrorName = '';
  let dbErrorCode = '';

  if (aiResult.parsedSummary) {
    const saveStarted = Date.now();
    const saved = await saveBaseSummaryTruth(input, aiResult.parsedSummary);
    dbSaveResult = {
      success: saved.stored,
      reason: saved.stored ? 'saved' : 'save failed',
      dbErrorMessage: saved.errorMessage,
      dbErrorName: saved.errorName,
      dbErrorCode: saved.errorCode,
      cacheKey: saved.cacheKey,
      storageKey: saved.storageKey
    };
    dbErrorMessage = saved.errorMessage;
    dbErrorName = saved.errorName;
    dbErrorCode = saved.errorCode;
    stages.push({
      stage: 'save_db',
      success: saved.stored,
      durationMs: Date.now() - saveStarted,
      error: saved.stored ? undefined : saved.errorMessage || 'database write failed',
      preview: saved.storageKey
    });

    stages.push({
      stage: 'read_back_db',
      success: Boolean(saved.readBack?.summary),
      durationMs: 0,
      error: saved.readBack?.summary ? undefined : 'read-back failed',
      preview: saved.readBack?.summary ? safePreview(saved.readBack.summary) : undefined
    });

    dbReadBackResult = {
      success: Boolean(saved.readBack?.summary),
      reason: saved.readBack?.summary ? 'read back' : 'read-back failed',
      summary: saved.readBack?.summary || ''
    };

    clearAiNarrativeCache(saved.cacheKey);
    const uiStarted = Date.now();
    const enriched = await enrichProjectNarrative(project, trade);
    finalVisibleSummary = enriched.readableSummary;
    finalResultSource = enriched.summarySource;
    uiVisibleFieldUpdated = enriched.summarySource === 'ai' && enriched.readableSummary === (saved.readBack?.summary || aiResult.parsedSummary);
    stages.push({
      stage: 'ui_source_check',
      success: uiVisibleFieldUpdated,
      durationMs: Date.now() - uiStarted,
      error: uiVisibleFieldUpdated ? undefined : `ui visible summary came from ${enriched.summarySource}`,
      preview: safePreview(enriched.readableSummary)
    });
  } else {
    stages.push({ stage: 'save_db', success: false, durationMs: 0, error: 'skipped because parse failed' });
    stages.push({ stage: 'read_back_db', success: false, durationMs: 0, error: 'skipped because parse failed' });
    stages.push({ stage: 'ui_source_check', success: false, durationMs: 0, error: 'skipped because parse failed' });
  }

  stages.push({
    stage: 'complete',
    success: Boolean(aiResult.parsedSummary && dbSaveResult.success && dbReadBackResult.success && uiVisibleFieldUpdated),
    durationMs: Date.now() - startedAt,
    error: aiResult.parsedSummary && dbSaveResult.success && dbReadBackResult.success && uiVisibleFieldUpdated ? undefined : 'pipeline incomplete'
  });

  const failingStage = stages.find((stage) => !stage.success)?.stage || null;

  return {
    projectId: project.id,
    selectedTrade: trade || '',
    stageResults: stages,
    finalResultSource,
    finalVisibleSummary,
    rawResponsePreview: safePreview(aiResult.rawResponseText || aiResult.rawResponseShape || ''),
    parsedSummary: aiResult.parsedSummary,
    parsedTradeNote: '',
    dbSaveResult,
    dbReadBackResult,
    uiVisibleFieldUpdated,
    failingStage,
    openaiErrorMessage: aiResult.openaiErrorMessage,
    openaiErrorName: aiResult.openaiErrorName,
    openaiStatusCode: aiResult.openaiStatusCode,
    requestDurationMs: aiResult.requestDurationMs,
    apiKeyDetected: aiResult.apiKeyDetected,
    clientInitialized: aiResult.clientInitialized,
    dbErrorMessage,
    dbErrorName,
    dbErrorCode,
    uiSourceCheck: {
      summaryField: 'project.readableSummary',
      wouldDisplayAi: finalResultSource === 'ai'
    }
  };
}

export async function runTruthModeDbWriteTestForProject(id: string, trade = '') {
  const testSummary = `TEST SUMMARY: AI write path is working for permit ${id}.`;
  const stages: TruthStageResult[] = [];
  const { projects } = await loadProjects();
  const fetchStarted = Date.now();
  const project = projects.find((candidate) => candidate.id === id) || null;

  stages.push({
    stage: 'fetch_permit',
    success: Boolean(project),
    durationMs: Date.now() - fetchStarted,
    error: project ? undefined : 'project not found'
  });

  if (!project) {
    return {
      projectId: id,
      selectedTrade: trade || '',
      testSummary,
      stageResults: stages,
      dbSaveResult: { success: false, reason: 'project not found', dbErrorMessage: 'project not found', dbErrorName: 'ProjectNotFound', dbErrorCode: '', cacheKey: '', storageKey: '' },
      dbReadBackResult: { success: false, reason: 'project not found' },
      uiVisibleFieldUpdated: false,
      visibleSummary: '',
      failingStage: 'fetch_permit',
      dbErrorMessage: 'project not found',
      dbErrorName: 'ProjectNotFound',
      dbErrorCode: ''
    };
  }

  const input = buildBaseSummaryInput(project);
  const saveStarted = Date.now();
  const saved = await saveBaseSummaryTruth(input, testSummary);
  stages.push({
    stage: 'save_db',
    success: saved.stored,
    durationMs: Date.now() - saveStarted,
    error: saved.stored ? undefined : saved.errorMessage || 'database write failed',
    preview: saved.storageKey
  });
  stages.push({
    stage: 'read_back_db',
    success: Boolean(saved.readBack?.summary),
    durationMs: 0,
    error: saved.readBack?.summary ? undefined : 'read-back failed',
    preview: saved.readBack?.summary ? safePreview(saved.readBack.summary) : undefined
  });

  clearAiNarrativeCache(saved.cacheKey);
  const uiStarted = Date.now();
  const enriched = await enrichProjectNarrative(project, trade);
  const uiVisibleFieldUpdated = enriched.summarySource === 'ai' && enriched.readableSummary === testSummary;
  stages.push({
    stage: 'ui_source_check',
    success: uiVisibleFieldUpdated,
    durationMs: Date.now() - uiStarted,
    error: uiVisibleFieldUpdated ? undefined : `ui visible summary came from ${enriched.summarySource}`,
    preview: safePreview(enriched.readableSummary)
  });
  stages.push({
    stage: 'complete',
    success: Boolean(saved.stored && saved.readBack?.summary && uiVisibleFieldUpdated),
    durationMs: 0,
    error: saved.stored && saved.readBack?.summary && uiVisibleFieldUpdated ? undefined : 'db write path incomplete'
  });

  return {
    projectId: project.id,
    selectedTrade: trade || '',
    testSummary,
    stageResults: stages,
    dbSaveResult: {
      success: saved.stored,
      dbErrorMessage: saved.errorMessage,
      dbErrorName: saved.errorName,
      dbErrorCode: saved.errorCode,
      cacheKey: saved.cacheKey,
      storageKey: saved.storageKey
    },
    dbReadBackResult: {
      success: Boolean(saved.readBack?.summary),
      summary: saved.readBack?.summary || ''
    },
    uiVisibleFieldUpdated,
    visibleSummary: enriched.readableSummary,
    failingStage: stages.find((stage) => !stage.success)?.stage || null,
    dbErrorMessage: saved.errorMessage,
    dbErrorName: saved.errorName,
    dbErrorCode: saved.errorCode
  };
}

export async function prewarmProjectInterpretations(ids: string[], trade = '') {
  return {
    ...(await generateSummariesForProjects(ids, trade)),
    alias: 'prewarm-ai'
  };
}
