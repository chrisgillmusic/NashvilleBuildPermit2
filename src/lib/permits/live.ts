import 'server-only';

import { format, isValid, parseISO, subDays } from 'date-fns';
import { generateAiNarrative } from './ai';
import type { ActiveContact, DashboardFilters, DashboardPayload, PermitProject, SummaryStats } from './types';

const FEATURE_URL =
  process.env.ARCGIS_FEATURE_URL ||
  'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0/query';

const CACHE_TTL_MS = 1000 * 60 * 10;
const OBJECT_ID_CHUNK = 200;
const REQUEST_RETRIES = 4;
const CONCURRENCY = 6;

type ArcgisFeature = {
  attributes: Record<string, unknown>;
};

type ArcgisIdsResponse = {
  objectIds?: number[];
};

type ArcgisFeatureResponse = {
  features?: ArcgisFeature[];
};

type CacheValue = {
  projects: PermitProject[];
  fetchedAt: number;
};

const NASHVILLE_CITY_TERMS = new Set(['NASHVILLE', 'ANTIOCH', 'MADISON', 'HERMITAGE', 'OLD HICKORY', 'GOODLETTSVILLE']);

const ZIP_NEIGHBORHOODS: Record<string, string> = {
  '37203': 'Midtown',
  '37204': '12 South / Melrose',
  '37205': 'Belle Meade / West End',
  '37206': 'East Nashville',
  '37207': 'North Nashville',
  '37208': 'Germantown / North Gulch',
  '37209': 'The Nations / Charlotte',
  '37210': 'Wedgewood-Houston / Berry Hill',
  '37211': 'South Nashville',
  '37212': 'Hillsboro Village / Belmont',
  '37213': 'Downtown East',
  '37214': 'Donelson',
  '37215': 'Green Hills',
  '37216': 'Inglewood',
  '37217': 'Airport / Una',
  '37218': 'Bordeaux',
  '37219': 'Downtown Core'
};

let cache: CacheValue | null = null;
let inflight: Promise<CacheValue> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(params: URLSearchParams, attempt = 0): Promise<T> {
  const response = await fetch(`${FEATURE_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) {
    if (attempt >= REQUEST_RETRIES) {
      throw new Error(`ArcGIS request failed with status ${response.status}`);
    }

    await sleep(400 * (attempt + 1));
    return fetchJson<T>(params, attempt + 1);
  }

  const data = (await response.json()) as T & { error?: { message?: string } };
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    if (attempt >= REQUEST_RETRIES) {
      throw new Error(data.error.message || 'ArcGIS returned an error');
    }

    await sleep(400 * (attempt + 1));
    return fetchJson<T>(params, attempt + 1);
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

async function fetchAllFeatures(): Promise<ArcgisFeature[]> {
  const idsParams = new URLSearchParams({
    where: '1=1',
    returnIdsOnly: 'true',
    f: 'json'
  });
  const idsData = await fetchJson<ArcgisIdsResponse>(idsParams);
  const objectIds = (idsData.objectIds || []).sort((left, right) => left - right);
  const chunks = chunk(objectIds, OBJECT_ID_CHUNK);

  const responses = await mapWithConcurrency(
    chunks,
    async (ids) => {
      const params = new URLSearchParams({
        objectIds: ids.join(','),
        outFields: '*',
        returnGeometry: 'false',
        f: 'json'
      });
      const data = await fetchJson<ArcgisFeatureResponse>(params);
      return data.features || [];
    },
    CONCURRENCY
  );

  return responses.flat();
}

function getString(attributes: Record<string, unknown>, key: string): string {
  const value = attributes[key];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function getNumber(attributes: Record<string, unknown>, key: string): number | null {
  const value = attributes[key];
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getIssueDate(attributes: Record<string, unknown>): Date | null {
  const raw = attributes.Date_Issued;
  if (raw === undefined || raw === null || raw === '') return null;

  if (typeof raw === 'number') {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isCommercial(attributes: Record<string, unknown>): boolean {
  const permitType = getString(attributes, 'Permit_Type_Description').toLowerCase();
  const permitSubtype = getString(attributes, 'Permit_Subtype_Description').toLowerCase();
  const purpose = getString(attributes, 'Purpose').toLowerCase();

  if (permitType.includes('residential') || permitSubtype.includes('residential')) return false;
  if (permitType.includes('commercial')) return true;

  return ['office', 'retail', 'restaurant', 'school', 'hospital', 'warehouse', 'industrial', 'medical'].some((term) =>
    `${permitSubtype} ${purpose}`.includes(term)
  );
}

function isNashvilleArea(attributes: Record<string, unknown>): boolean {
  const city = getString(attributes, 'City').toUpperCase();
  if (city && NASHVILLE_CITY_TERMS.has(city)) return true;

  const zip = getString(attributes, 'ZIP');
  return zip in ZIP_NEIGHBORHOODS;
}

function inferNeighborhood(zip: string, address: string, purpose: string): string {
  if (zip && ZIP_NEIGHBORHOODS[zip]) return ZIP_NEIGHBORHOODS[zip];

  const haystack = `${address} ${purpose}`.toLowerCase();
  if (haystack.includes('germantown')) return 'Germantown';
  if (haystack.includes('the nations')) return 'The Nations';
  if (haystack.includes('green hills')) return 'Green Hills';
  if (haystack.includes('donelson')) return 'Donelson';
  if (haystack.includes('east nashville')) return 'East Nashville';

  return zip ? `ZIP ${zip}` : 'Nashville Area';
}

function buildMapsUrl(address: string, city: string, state: string, zip: string): string {
  const query = [address, city, state, zip].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || 'Nashville TN')}`;
}

function dedupeTrades(trades: string[]): string[] {
  return Array.from(new Set(trades));
}

function toSentenceCase(value: string): string {
  if (!value) return value;
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(/\b(sf|hvac|mep|poc)\b/g, (match) => match.toUpperCase())
    .replace(/(^\w|\.\s+\w)/g, (match) => match.toUpperCase());
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

function toProject(feature: ArcgisFeature): PermitProject | null {
  const attributes = feature.attributes;
  if (!isCommercial(attributes) || !isNashvilleArea(attributes)) return null;

  const issueDate = getIssueDate(attributes);
  if (!issueDate) return null;

  const valuation = getNumber(attributes, 'Const_Cost');
  if (!valuation || valuation <= 0) return null;

  const permitType = getString(attributes, 'Permit_Type_Description');
  const permitSubtype = getString(attributes, 'Permit_Subtype_Description');
  const rawPurpose = getString(attributes, 'Purpose');
  const purpose = cleanPurposeText(rawPurpose);
  const address = getString(attributes, 'Address');
  const city = getString(attributes, 'City') || 'Nashville';
  const state = getString(attributes, 'State') || 'TN';
  const zip = getString(attributes, 'ZIP');
  const contactName = getString(attributes, 'Contact') || 'Contact not listed';
  const contactPhone = extractPhone(rawPurpose);
  const contactEmail = extractEmail(rawPurpose);
  const objectId = getNumber(attributes, 'ObjectId');
  const permitNumber = getString(attributes, 'Permit__') || `OBJ-${objectId ?? 'NA'}`;
  const neighborhood = inferNeighborhood(zip, address, purpose);
  const { whyItMatters, likelyTrades } = deriveNotes(permitType, permitSubtype, purpose);
  const readableSummary = buildReadableSummary(permitSubtype || permitType, purpose);
  const lat = getNumber(attributes, 'Lat');
  const lon = getNumber(attributes, 'Lon');

  if (!objectId) return null;

  const rawFields: Record<string, string> = {
    'Permit #': permitNumber,
    'Permit type': permitType || 'N/A',
    'Permit subtype': permitSubtype || 'N/A',
    Address: address || 'N/A',
    City: city || 'N/A',
    State: state || 'N/A',
    ZIP: zip || 'N/A',
    Contact: contactName,
    'Contact phone': contactPhone || 'N/A',
    'Contact email': contactEmail || 'N/A',
    Purpose: purpose || 'N/A',
    'Estimated valuation': valuation.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
    'Issue date': format(issueDate, 'MMM d, yyyy'),
    Parcel: getString(attributes, 'Parcel') || 'N/A',
    'Council district': getString(attributes, 'Council_Dist') || 'N/A',
    'Census tract': getString(attributes, 'Census_Tract') || 'N/A',
    Latitude: lat !== null ? String(lat) : 'N/A',
    Longitude: lon !== null ? String(lon) : 'N/A',
    'Date entered': (() => {
      const entered = attributes.Date_Entered;
      if (typeof entered === 'number') {
        const date = new Date(entered);
        if (!Number.isNaN(date.getTime())) return format(date, 'MMM d, yyyy');
      }
      return 'N/A';
    })(),
    'Subdivision / lot': getString(attributes, 'Subdivision_Lot') || 'N/A'
  };

  return {
    id: String(objectId),
    objectId,
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
    tradeSummary: readableSummary,
    valuation,
    issueDate: issueDate.toISOString(),
    issueDateLabel: format(issueDate, 'MMM d, yyyy'),
    mapsUrl: buildMapsUrl(address, city, state, zip),
    whyItMatters,
    likelyTradesNote: `Likely trades involved: ${likelyTrades.join(', ')}.`,
    likelyTrades,
    coordinates: { lat, lon },
    rawFields,
    aiSource: 'rule'
  };
}

function textsOverlap(left: string, right: string): boolean {
  const a = left.toLowerCase().replace(/[^\w]+/g, ' ').trim();
  const b = right.toLowerCase().replace(/[^\w]+/g, ' ').trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function enrichProjectNarrative(project: PermitProject, trade: string): Promise<PermitProject> {
  const aiNarrative = await generateAiNarrative({
    permitNumber: project.permitNumber,
    permitType: project.permitType,
    permitSubtype: project.permitSubtype,
    purpose: project.purpose || project.rawPurpose,
    valuation: project.valuation,
    trade,
    likelyTrades: project.likelyTrades
  });

  if (!aiNarrative) {
    const fallbackProject: PermitProject = {
      ...project,
      readableSummary: project.readableSummary,
      aiSource: 'rule'
    };
    console.log('FINAL SUMMARY SOURCE: fallback');
    console.log('FINAL SUMMARY:', fallbackProject.readableSummary);
    return fallbackProject;
  }

  const snapshot = aiNarrative.snapshot?.trim() || project.readableSummary;
  const whyItMatters = aiNarrative.whyItMatters && !textsOverlap(aiNarrative.whyItMatters, snapshot) ? aiNarrative.whyItMatters : project.whyItMatters;
  const tradeSummary =
    aiNarrative.tradeNote && !textsOverlap(aiNarrative.tradeNote, whyItMatters || snapshot) ? aiNarrative.tradeNote : project.tradeSummary;

  const enrichedProject: PermitProject = {
    ...project,
    readableSummary: snapshot,
    whyItMatters,
    tradeSummary,
    aiSource: 'ai'
  };
  console.log('FINAL SUMMARY SOURCE: ai');
  console.log('FINAL SUMMARY:', enrichedProject.readableSummary);
  return enrichedProject;
}

async function enrichProjects(projects: PermitProject[], trade = ''): Promise<PermitProject[]> {
  const limit = 40;
  const leading = await Promise.all(projects.slice(0, limit).map((project) => enrichProjectNarrative(project, trade)));
  if (projects.length <= limit) return leading;
  return [...leading, ...projects.slice(limit)];
}

async function loadProjects(): Promise<CacheValue> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const features = await fetchAllFeatures();
    const projects = features
      .map(toProject)
      .filter((project): project is PermitProject => Boolean(project))
      .sort((left, right) => {
        if (left.issueDate === right.issueDate) return right.valuation - left.valuation;
        return right.issueDate.localeCompare(left.issueDate);
      });

    const nextCache = { projects, fetchedAt: Date.now() };
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
    minBudget: 250000,
    maxBudget: 2000000,
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
    maxBudget: input?.maxBudget ?? defaults.maxBudget,
    dateFrom: input?.dateFrom || defaults.dateFrom,
    dateTo: input?.dateTo || defaults.dateTo,
    permitType: input?.permitType || '',
    neighborhood: input?.neighborhood || '',
    contractorQuery: input?.contractorQuery || '',
    sort: input?.sort || defaults.sort
  };
}

function matchesFilters(project: PermitProject, filters: DashboardFilters): boolean {
  if (project.valuation < filters.minBudget || project.valuation > filters.maxBudget) return false;

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
  const recentThreshold = subDays(new Date(), 30);

  return {
    totalProjects: projects.length,
    totalValuation: projects.reduce((sum, project) => sum + project.valuation, 0),
    recentPermits: projects.filter((project) => parseISO(project.issueDate) >= recentThreshold).length,
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
        phone: project.contactPhone,
        email: project.contactEmail
      });
      continue;
    }

    existing.projectCount += 1;
    existing.totalValuation += project.valuation;
    if (project.issueDate > existing.mostRecentPermit) existing.mostRecentPermit = project.issueDate;
    if (!existing.phone && project.contactPhone) existing.phone = project.contactPhone;
    if (!existing.email && project.contactEmail) existing.email = project.contactEmail;
  }

  return [...buckets.values()].sort((left, right) => right.projectCount - left.projectCount || right.totalValuation - left.totalValuation);
}

export async function getDashboardPayload(input?: Partial<DashboardFilters>, trade = ''): Promise<DashboardPayload> {
  const { projects, fetchedAt } = await loadProjects();
  const filters = sanitizeFilters(input);
  const filteredProjects = sortProjects(projects.filter((project) => matchesFilters(project, filters)), filters.sort);
  const enrichedProjects = await enrichProjects(filteredProjects.slice(0, 120), trade);

  return {
    filters,
    summary: summarize(filteredProjects),
    featured: enrichedProjects.slice(0, 5),
    projects: enrichedProjects,
    activeContacts: buildActiveContacts(filteredProjects),
    availablePermitTypes: Array.from(new Set(projects.map((project) => project.permitSubtype || project.permitType).filter(Boolean))).sort(),
    availableNeighborhoods: Array.from(new Set(projects.map((project) => project.neighborhood).filter(Boolean))).sort(),
    asOf: new Date(fetchedAt).toISOString()
  };
}

export async function getProjectById(id: string, trade = ''): Promise<PermitProject | null> {
  const { projects } = await loadProjects();
  const project = projects.find((project) => project.id === id) || null;
  if (!project) return null;
  return enrichProjectNarrative(project, trade);
}

export async function getProjectsByContact(name: string, filters?: Partial<DashboardFilters>, trade = ''): Promise<DashboardPayload & { contactName: string }> {
  const { projects: allProjects, fetchedAt } = await loadProjects();
  const nextFilters = sanitizeFilters(filters);
  const projects = allProjects.filter(
    (project) => project.contactName.toLowerCase() === name.toLowerCase() && matchesFilters(project, nextFilters)
  );
  const sorted = sortProjects(projects, nextFilters.sort);
  const enrichedProjects = await enrichProjects(sorted, trade);

  return {
    filters: nextFilters,
    contactName: name,
    summary: summarize(sorted),
    featured: enrichedProjects.slice(0, 5),
    projects: enrichedProjects,
    activeContacts: buildActiveContacts(sorted),
    availablePermitTypes: Array.from(new Set(allProjects.map((project) => project.permitSubtype || project.permitType).filter(Boolean))).sort(),
    availableNeighborhoods: Array.from(new Set(allProjects.map((project) => project.neighborhood).filter(Boolean))).sort(),
    asOf: new Date(fetchedAt).toISOString()
  };
}
