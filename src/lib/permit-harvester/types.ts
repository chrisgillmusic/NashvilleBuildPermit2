export type PermitOccupancy = 'residential' | 'nonResidential' | 'unknown';

export type PermitOccupancyFilter = PermitOccupancy | 'all';

export type PermitHarvesterFilters = {
  minValue: number | null;
  permitType: string;
  dateFrom: string;
  dateTo: string;
  occupancy: PermitOccupancyFilter;
};

export type NormalizedPermit = {
  id: string;
  city: string;
  source: string;
  address: string;
  type: string;
  description: string;
  value: number | null;
  dateIssued: string;
  contact: string;
  phone: string;
  email: string;
  occupancy: PermitOccupancy;
  permitNumber: string;
  status: string;
  raw: {
    search: unknown;
    detail: unknown;
  };
};

export type HarvestLogLevel = 'info' | 'warn' | 'error';

export type HarvestLogEntry = {
  timestamp: string;
  level: HarvestLogLevel;
  message: string;
};

export type PermitDateRangeSummary = {
  earliest: string | null;
  latest: string | null;
};

export type HarvestStopReason = 'noResults' | 'exhausted' | 'dateBoundary' | 'error';

export type HarvestTermCoverage = {
  term: string;
  rawFetchedCount: number;
  rawInCoverageCount: number;
  uniquePermitCount: number;
  duplicateCount: number;
  pagesWalked: number;
  totalAvailableCount: number | null;
  dateRange: PermitDateRangeSummary;
  stopReason: HarvestStopReason;
  error: string | null;
};

export type HarvestCoverage = {
  searchTerms: string[];
  termsSearched: number;
  pagesWalked: number;
  rawFetchedCount: number;
  rawInCoverageCount: number;
  uniquePermitCount: number;
  duplicatesRemoved: number;
  harvestedDateRange: PermitDateRangeSummary;
  filteredDateRange: PermitDateRangeSummary;
  termCoverage: HarvestTermCoverage[];
};

export type CitySourceSummary = {
  id: string;
  cityLabel: string;
  sourceLabel: string;
  mode: 'live' | 'import';
  defaultFilters: PermitHarvesterFilters;
  notes: string[];
};

export type HarvestRunResult = {
  cityId: string;
  cityLabel: string;
  sourceLabel: string;
  mode: 'live' | 'import';
  filters: PermitHarvesterFilters;
  fetchedCount: number;
  filteredCount: number;
  coverage: HarvestCoverage;
  availablePermitTypes: string[];
  permits: NormalizedPermit[];
  logs: HarvestLogEntry[];
  pulledAt: string;
  notes: string[];
  error: string | null;
};
