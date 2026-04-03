import type { PermitHarvesterFilters, NormalizedPermit } from '../types';

export type SourceLog = (level: 'info' | 'warn' | 'error', message: string) => void;

export type SourceFetchResult = {
  permits: NormalizedPermit[];
  notes?: string[];
};

export type CitySource = {
  id: string;
  cityLabel: string;
  sourceLabel: string;
  mode: 'live' | 'import';
  getDefaultFilters: () => PermitHarvesterFilters;
  notes: string[];
  fetchPermits: (args: { filters: PermitHarvesterFilters; log: SourceLog }) => Promise<SourceFetchResult>;
};
