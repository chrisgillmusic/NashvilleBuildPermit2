import type { CitySourceSummary } from '../types';
import type { CitySource } from './types';
import { jacksonvilleSource } from './jacksonville';

const SOURCES: CitySource[] = [jacksonvilleSource];

export function getCitySource(id: string): CitySource | undefined {
  return SOURCES.find((source) => source.id === id);
}

export function getCitySourceSummaries(): CitySourceSummary[] {
  return SOURCES.map((source) => ({
    id: source.id,
    cityLabel: source.cityLabel,
    sourceLabel: source.sourceLabel,
    mode: source.mode,
    defaultFilters: source.getDefaultFilters(),
    notes: source.notes
  }));
}

export function getDefaultCityId(): string {
  return SOURCES[0]?.id || 'jacksonville-fl';
}
