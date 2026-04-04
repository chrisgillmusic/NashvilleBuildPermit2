export type InterpretationSource = 'ai' | 'fallback';

export type ApplicableTrade = {
  trade: string;
  confidence: string;
  reason: string;
};

export type OutreachDraft = {
  subject: string;
  body: string;
};

export type PermitProject = {
  id: string;
  objectId: number;
  permitNumber: string;
  permitType: string;
  permitSubtype: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  neighborhood: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  rawPurpose: string;
  purpose: string;
  readableSummary: string;
  tradeSummary: string;
  valuation: number;
  issueDate: string;
  issueDateLabel: string;
  mapsUrl: string;
  whyItMatters: string;
  likelyTrades: string[];
  applicableTrades?: ApplicableTrade[];
  outreachByTrade?: Record<string, OutreachDraft>;
  isTradeRelevant: boolean | null;
  summarySource: InterpretationSource;
  tradeSource: InterpretationSource;
  needsSummary?: boolean;
  needsTradeNote?: boolean;
  needsSummaryRefresh?: boolean;
  needsTradeNoteRefresh?: boolean;
  coordinates: {
    lat: number | null;
    lon: number | null;
  };
  rawFields: Record<string, string>;
};

export type DashboardFilters = {
  minBudget: number;
  maxBudget: number;
  dateFrom: string;
  dateTo: string;
  permitType: string;
  neighborhood: string;
  contractorQuery: string;
  sort: 'newest' | 'highest' | 'lowest';
};

export type SummaryStats = {
  totalProjects: number;
  totalValuation: number;
  recentPermits: number;
  activeContacts: number;
};

export type ActiveContact = {
  name: string;
  projectCount: number;
  totalValuation: number;
  mostRecentPermit: string;
  mostRecentPermitAddress?: string;
  mostRecentPermitSummary?: string;
  mostRecentPermitType?: string;
  mostRecentProjectId?: string;
  mostRecentApplicableTrades?: ApplicableTrade[];
  mostRecentOutreachByTrade?: Record<string, OutreachDraft>;
  phone: string | null;
  email: string | null;
};

export type DashboardPayload = {
  filters: DashboardFilters;
  summary: SummaryStats;
  featured: PermitProject[];
  projects: PermitProject[];
  activeContacts: ActiveContact[];
  availablePermitTypes: string[];
  availableNeighborhoods: string[];
  asOf: string;
  debug: {
    aiEnabled: boolean;
    apiKeyPresent: boolean;
    appVersion: string;
    lastAiCallAttempted: boolean;
    lastAiResultSource: InterpretationSource | 'unknown';
    lastAiFailureReason: string;
    lastCacheStatus: string;
    storedAiCount: number;
    needsSummaryCount: number;
    needsTradeNoteCount: number;
    needsRefreshCount: number;
    lastGenerateActionResult: string;
    lastRegenerateActionResult: string;
    lastSummarySource: InterpretationSource | 'unknown';
    lastTradeSource: InterpretationSource | 'unknown';
  };
};
