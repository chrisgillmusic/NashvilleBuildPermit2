import { applyPermitFilters, normalizeFilters } from './filters';
import { getCitySource } from './sources';
import type { HarvestLogEntry, HarvestRunResult, PermitHarvesterFilters } from './types';

function appendLog(logs: HarvestLogEntry[], level: 'info' | 'warn' | 'error', message: string): void {
  logs.push({
    timestamp: new Date().toISOString(),
    level,
    message
  });
}

export async function runPermitHarvester(cityId: string, rawFilters?: Partial<PermitHarvesterFilters>): Promise<HarvestRunResult> {
  const source = getCitySource(cityId);
  const filters = normalizeFilters(rawFilters);
  const logs: HarvestLogEntry[] = [];

  if (!source) {
    return {
      cityId,
      cityLabel: cityId,
      sourceLabel: 'Unknown source',
      mode: 'import',
      filters,
      fetchedCount: 0,
      filteredCount: 0,
      availablePermitTypes: [],
      permits: [],
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: 'error',
          message: `Unknown city source "${cityId}".`
        }
      ],
      pulledAt: new Date().toISOString(),
      notes: [],
      error: `Unknown city source "${cityId}".`
    };
  }

  appendLog(logs, 'info', `Starting ${source.cityLabel} ${source.mode} run.`);

  try {
    const fetched = await source.fetchPermits({
      filters,
      log: (level, message) => appendLog(logs, level, message)
    });

    const filteredPermits = applyPermitFilters(fetched.permits, filters);
    appendLog(logs, 'info', `Fetched ${fetched.permits.length} normalized permits.`);
    appendLog(logs, 'info', `${filteredPermits.length} permits remain after the current filters.`);

    const availablePermitTypes = Array.from(new Set(fetched.permits.map((permit) => permit.type).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right)
    );

    return {
      cityId: source.id,
      cityLabel: source.cityLabel,
      sourceLabel: source.sourceLabel,
      mode: source.mode,
      filters,
      fetchedCount: fetched.permits.length,
      filteredCount: filteredPermits.length,
      availablePermitTypes,
      permits: filteredPermits,
      logs,
      pulledAt: new Date().toISOString(),
      notes: [...source.notes, ...(fetched.notes || [])],
      error: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown run failure';
    appendLog(logs, 'error', message);

    return {
      cityId: source.id,
      cityLabel: source.cityLabel,
      sourceLabel: source.sourceLabel,
      mode: source.mode,
      filters,
      fetchedCount: 0,
      filteredCount: 0,
      availablePermitTypes: [],
      permits: [],
      logs,
      pulledAt: new Date().toISOString(),
      notes: source.notes,
      error: message
    };
  }
}
