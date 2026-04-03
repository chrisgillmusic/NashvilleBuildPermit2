'use client';

import { useState } from 'react';
import type { CitySourceSummary, HarvestLogEntry, HarvestRunResult, NormalizedPermit, PermitHarvesterFilters } from '@/lib/permit-harvester/types';

function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(value: string): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(parsed);
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildExportFileName(cityLabel: string, extension: 'json' | 'csv'): string {
  const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
  return `permit-harvester-${slugify(cityLabel)}-${stamp}.${extension}`;
}

function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function permitsToCsv(permits: NormalizedPermit[]): string {
  const headers = ['id', 'city', 'source', 'address', 'type', 'description', 'value', 'dateIssued', 'contact', 'phone', 'email', 'occupancy', 'permitNumber', 'status'];
  const rows = permits.map((permit) =>
    [
      permit.id,
      permit.city,
      permit.source,
      permit.address,
      permit.type,
      permit.description,
      permit.value === null ? '' : String(permit.value),
      permit.dateIssued,
      permit.contact,
      permit.phone,
      permit.email,
      permit.occupancy,
      permit.permitNumber,
      permit.status
    ]
      .map((value) => escapeCsvValue(value))
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

function downloadFile(fileName: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatLogLine(entry: HarvestLogEntry): string {
  return `${formatDateTime(entry.timestamp)} [${entry.level.toUpperCase()}] ${entry.message}`;
}

type PermitHarvesterAppProps = {
  sources: CitySourceSummary[];
  initialCityId: string;
};

export function PermitHarvesterApp({ sources, initialCityId }: PermitHarvesterAppProps) {
  const initialSource = sources.find((source) => source.id === initialCityId) || sources[0];
  const [cityId, setCityId] = useState(initialSource.id);
  const [filters, setFilters] = useState<PermitHarvesterFilters>(initialSource.defaultFilters);
  const [result, setResult] = useState<HarvestRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [localLogs, setLocalLogs] = useState<HarvestLogEntry[]>([]);

  const currentSource = sources.find((source) => source.id === cityId) || initialSource;
  const permitTypeOptions = result?.availablePermitTypes || [];
  const logLines = [...(result?.logs || []), ...localLogs].map(formatLogLine);

  async function runHarvester(): Promise<void> {
    setIsRunning(true);
    setLocalLogs([]);

    try {
      const response = await fetch('/api/permit-harvester/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cityId,
          filters
        })
      });

      const payload = (await response.json()) as HarvestRunResult;
      setResult(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown client error';
      setResult(null);
      setLocalLogs([
        {
          timestamp: new Date().toISOString(),
          level: 'error',
          message
        }
      ]);
    } finally {
      setIsRunning(false);
    }
  }

  function updateFilter<Key extends keyof PermitHarvesterFilters>(key: Key, value: PermitHarvesterFilters[Key]): void {
    setFilters((current) => ({
      ...current,
      [key]: value
    }));
  }

  function handleCityChange(nextCityId: string): void {
    const nextSource = sources.find((source) => source.id === nextCityId) || initialSource;
    setCityId(nextCityId);
    setFilters(nextSource.defaultFilters);
    setResult(null);
    setLocalLogs([
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `Loaded defaults for ${nextSource.cityLabel}.`
      }
    ]);
  }

  function appendExportLog(fileName: string): void {
    setLocalLogs((current) => [
      ...current,
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `Exported ${result?.permits.length || 0} permits to ${fileName}.`
      }
    ]);
  }

  function exportJson(): void {
    if (!result?.permits.length) return;
    const fileName = buildExportFileName(result.cityLabel, 'json');
    downloadFile(fileName, JSON.stringify(result.permits, null, 2), 'application/json');
    appendExportLog(fileName);
  }

  function exportCsv(): void {
    if (!result?.permits.length) return;
    const fileName = buildExportFileName(result.cityLabel, 'csv');
    downloadFile(fileName, permitsToCsv(result.permits), 'text/csv;charset=utf-8');
    appendExportLog(fileName);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h1 className="text-3xl font-semibold text-white">Permit Harvester</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Pull recent real permit activity, normalize it into one consistent schema, review the results, and export the current filtered set.
          </p>
        </header>

        <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Controls</h2>
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-300">City</span>
                  <select
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    value={cityId}
                    onChange={(event) => handleCityChange(event.target.value)}
                  >
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.cityLabel}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
                  <p className="text-slate-400">Source label</p>
                  <p className="mt-1 font-medium text-slate-100">{currentSource.sourceLabel}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-emerald-300">{currentSource.mode}</p>
                </div>

                <label className="block text-sm">
                  <span className="mb-1 block text-slate-300">Minimum value</span>
                  <input
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    type="number"
                    min="0"
                    step="1000"
                    value={filters.minValue ?? ''}
                    onChange={(event) => updateFilter('minValue', event.target.value === '' ? null : Number(event.target.value))}
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-slate-300">Permit type</span>
                  <select
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    value={filters.permitType}
                    onChange={(event) => updateFilter('permitType', event.target.value)}
                  >
                    <option value="">All permit types</option>
                    {permitTypeOptions.map((permitType) => (
                      <option key={permitType} value={permitType}>
                        {permitType}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-300">Date from</span>
                    <input
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                      type="date"
                      value={filters.dateFrom}
                      onChange={(event) => updateFilter('dateFrom', event.target.value)}
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-300">Date to</span>
                    <input
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                      type="date"
                      value={filters.dateTo}
                      onChange={(event) => updateFilter('dateTo', event.target.value)}
                    />
                  </label>
                </div>

                <label className="block text-sm">
                  <span className="mb-1 block text-slate-300">Occupancy</span>
                  <select
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    value={filters.occupancy}
                    onChange={(event) => updateFilter('occupancy', event.target.value as PermitHarvesterFilters['occupancy'])}
                  >
                    <option value="all">All</option>
                    <option value="nonResidential">Non-residential</option>
                    <option value="residential">Residential</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>

                <button
                  className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                  type="button"
                  disabled={isRunning}
                  onClick={() => void runHarvester()}
                >
                  {isRunning ? 'Running…' : 'Run Import'}
                </button>

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={!result?.permits.length}
                    onClick={exportJson}
                  >
                    Export JSON
                  </button>
                  <button
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={!result?.permits.length}
                    onClick={exportCsv}
                  >
                    Export CSV
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Status</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Fetched</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{result?.fetchedCount ?? 0}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Survived filters</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{result?.filteredCount ?? 0}</p>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
                <p>Last run: {result ? formatDateTime(result.pulledAt) : 'Not run yet'}</p>
                {result?.error ? <p className="mt-2 text-rose-300">Error: {result.error}</p> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Notes</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                {(result?.notes || currentSource.notes).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Results</h2>
                  <p className="mt-1 text-sm text-slate-300">
                    {result ? `Showing ${result.filteredCount} of ${result.fetchedCount} fetched permits.` : 'Run the harvester to load permit records.'}
                  </p>
                </div>
                {result ? <p className="text-xs text-slate-500">Pulled {formatDateTime(result.pulledAt)}</p> : null}
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="border-b border-slate-800 px-3 py-2 font-medium">Issued</th>
                      <th className="border-b border-slate-800 px-3 py-2 font-medium">Address</th>
                      <th className="border-b border-slate-800 px-3 py-2 font-medium">Type</th>
                      <th className="border-b border-slate-800 px-3 py-2 font-medium">Description</th>
                      <th className="border-b border-slate-800 px-3 py-2 font-medium">Value</th>
                      <th className="border-b border-slate-800 px-3 py-2 font-medium">Occupancy</th>
                      <th className="border-b border-slate-800 px-3 py-2 font-medium">Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result?.permits.map((permit) => (
                      <tr key={permit.id} className="align-top text-slate-200">
                        <td className="border-b border-slate-900 px-3 py-3 whitespace-nowrap">{formatDate(permit.dateIssued)}</td>
                        <td className="border-b border-slate-900 px-3 py-3">
                          <div className="font-medium text-white">{permit.address || 'Address not listed'}</div>
                          <div className="mt-1 text-xs text-slate-500">{permit.permitNumber || permit.id}</div>
                        </td>
                        <td className="border-b border-slate-900 px-3 py-3">{permit.type}</td>
                        <td className="border-b border-slate-900 px-3 py-3">
                          <div>{permit.description || 'No description provided'}</div>
                          <div className="mt-1 text-xs text-slate-500">{permit.status || 'Status not listed'}</div>
                        </td>
                        <td className="border-b border-slate-900 px-3 py-3 whitespace-nowrap">{formatCurrency(permit.value)}</td>
                        <td className="border-b border-slate-900 px-3 py-3">{permit.occupancy}</td>
                        <td className="border-b border-slate-900 px-3 py-3">
                          <div>{permit.contact || 'Contact not listed'}</div>
                          <div className="mt-1 text-xs text-slate-500">{permit.phone || 'No phone'}</div>
                          <div className="text-xs text-slate-500">{permit.email || 'No email'}</div>
                        </td>
                      </tr>
                    ))}
                    {!result?.permits.length ? (
                      <tr>
                        <td className="px-3 py-8 text-sm text-slate-500" colSpan={7}>
                          No results loaded yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Log</h2>
              <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-6 text-slate-300">
                {logLines.length ? logLines.join('\n') : 'No activity yet.'}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
