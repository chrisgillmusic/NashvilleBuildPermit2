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
  purpose: string;
  readableSummary: string;
  tradeSummary: string;
  valuation: number;
  issueDate: string;
  issueDateLabel: string;
  mapsUrl: string;
  whyItMatters: string;
  likelyTradesNote: string;
  likelyTrades: string[];
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
};
