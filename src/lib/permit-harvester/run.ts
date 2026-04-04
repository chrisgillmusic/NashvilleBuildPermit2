import { applyPermitFilters, normalizeFilters } from './filters';
import { getCitySource } from './sources';
import type { HarvestCoverage, HarvestLogEntry, HarvestRunResult, NormalizedPermit, PermitDateRangeSummary, PermitHarvesterFilters } from './types';

function appendLog(logs: HarvestLogEntry[], level: 'info' | 'warn' | 'error', message: string): void {
  logs.push({
    timestamp: new Date().toISOString(),
    level,
    message
  });
}

function buildDateRangeSummary(permits: NormalizedPermit[]): PermitDateRangeSummary {
  const timestamps = permits
    .map((permit) => {
      const parsed = new Date(permit.dateIssued);
      return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    })
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  if (!timestamps.length) {
    return {
      earliest: null,
      latest: null
    };
  }

  return {
    earliest: new Date(timestamps[0]).toISOString(),
    latest: new Date(timestamps[timestamps.length - 1]).toISOString()
  };
}

function emptyCoverage(): HarvestCoverage {
  return {
    searchTerms: [],
    termsSearched: 0,
    pagesWalked: 0,
    rawFetchedCount: 0,
    rawInCoverageCount: 0,
    uniquePermitCount: 0,
    duplicatesRemoved: 0,
    harvestedDateRange: {
      earliest: null,
      latest: null
    },
    filteredDateRange: {
      earliest: null,
      latest: null
    },
    termCoverage: []
  };
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
      exportCount: 0,
      coverage: emptyCoverage(),
      availablePermitTypes: [],
      permits: [],
      filteredPermits: [],
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
    const coverage: HarvestCoverage = {
      ...fetched.coverage,
      filteredDateRange: buildDateRangeSummary(filteredPermits)
    };

    appendLog(logs, 'info', `Harvested ${coverage.uniquePermitCount} unique permits from ${coverage.rawFetchedCount} raw source rows.`);
    appendLog(logs, 'info', `Removed ${coverage.duplicatesRemoved} duplicates during sweep merge.`);
    appendLog(logs, 'info', `${filteredPermits.length} permits remain after the current filters.`);
    appendLog(logs, 'info', `${fetched.permits.length} permits are available to export in the full deduped set.`);

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
      exportCount: fetched.permits.length,
      coverage,
      availablePermitTypes,
      permits: fetched.permits,
      filteredPermits,
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
      exportCount: 0,
      coverage: emptyCoverage(),
      availablePermitTypes: [],
      permits: [],
      filteredPermits: [],
      logs,
      pulledAt: new Date().toISOString(),
      notes: source.notes,
      error: message
    };
  }
}
