'use client';

import { useMemo, useState } from 'react';

type Props = {
  recentSyncs: Array<{
    id: string;
    status: string;
    startedAt: string;
    recordsProcessed: number;
    errorSummary: string | null;
  }>;
  draftIssues: Array<{ id: string; title: string; weekStartDate: string; status: string }>;
  recentProjects: Array<{
    id: string;
    address: string | null;
    permitSubtypeDescription: string | null;
    contactRaw: string | null;
    normalizedContactName: string | null;
    score: number | null;
    scoreOverride: number | null;
    isIncludedInIssue: boolean;
    scoreBreakdown: any;
  }>;
  gcEntities: Array<{ id: string; canonicalName: string }>;
  settings: {
    minCost: number;
    maxCost: number;
    rollingWindowDays: number;
    targetPermitTypes: string[];
    excludedSubtypes: string[];
    excludedKeywords: string[];
    includedZipCodes: string[];
    includedCouncilDistricts: string[];
    includeInstitutionalSubtypes: string[];
  };
  rawRecords: Array<{
    id: string;
    sourceObjectId: number;
    fetchedAt: string;
    hash: string;
    rawJson: any;
  }>;
};

export function AdminDashboard({ recentSyncs, draftIssues, recentProjects, gcEntities, settings, rawRecords }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const [minCost, setMinCost] = useState(settings.minCost);
  const [maxCost, setMaxCost] = useState(settings.maxCost);
  const [rollingWindowDays, setRollingWindowDays] = useState(settings.rollingWindowDays);

  const options = useMemo(() => gcEntities.map((e) => ({ value: e.id, label: e.canonicalName })), [gcEntities]);

  async function postJson(url: string, body: unknown) {
    setBusy(url);
    setMessage('');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Request failed');
      }
      setMessage(`Success: ${url}`);
      location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {message ? <p className="rounded bg-slate-100 p-2 text-xs text-slate-700">{message}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Target Settings</h2>
        <form
          className="mt-3 grid gap-2 sm:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            postJson('/api/admin/settings', {
              ...settings,
              minCost,
              maxCost,
              rollingWindowDays
            });
          }}
        >
          <input className="rounded border border-slate-300 p-2 text-sm" type="number" value={minCost} onChange={(e) => setMinCost(Number(e.target.value))} />
          <input className="rounded border border-slate-300 p-2 text-sm" type="number" value={maxCost} onChange={(e) => setMaxCost(Number(e.target.value))} />
          <input className="rounded border border-slate-300 p-2 text-sm" type="number" value={rollingWindowDays} onChange={(e) => setRollingWindowDays(Number(e.target.value))} />
          <button className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white" type="submit">Save</button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Pipeline Controls</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={busy !== null}
            onClick={() => postJson('/api/admin/sync', { mode: 'full' })}
          >
            Manual Full Sync
          </button>
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-60"
            disabled={busy !== null}
            onClick={() => postJson('/api/admin/sync', { mode: 'incremental-date', sinceDate: new Date(Date.now() - 7 * 86400000) })}
          >
            Incremental 7-Day Sync
          </button>
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-60"
            disabled={busy !== null}
            onClick={() => postJson('/api/admin/issues/generate', {})}
          >
            Generate Weekly Draft
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Sync History</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {recentSyncs.map((s) => (
            <li key={s.id} className="rounded border border-slate-100 p-2">
              <p className="font-semibold">{s.status.toUpperCase()} • {new Date(s.startedAt).toLocaleString()}</p>
              <p>Processed: {s.recordsProcessed}</p>
              {s.errorSummary ? <p className="text-red-700">{s.errorSummary}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Issue Drafts</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {draftIssues.map((issue) => (
            <li key={issue.id} className="flex items-center justify-between rounded border border-slate-100 p-2">
              <span>{issue.title}</span>
              <a className="font-semibold text-amber-700 underline" href={`/admin/issues/${issue.id}`}>
                Edit
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Project Overrides</h2>
        <ul className="mt-3 space-y-3">
          {recentProjects.map((p) => (
            <li key={p.id} className="rounded border border-slate-100 p-3 text-sm">
              <p className="font-semibold">{p.address || 'Address pending'} • {p.permitSubtypeDescription || 'Subtype N/A'}</p>
              <p>Score: {p.score?.toFixed(1) || 'N/A'} • Override: {p.scoreOverride ?? 'none'}</p>
              <p>Raw contact: {p.contactRaw || 'N/A'} • Normalized: {p.normalizedContactName || 'N/A'}</p>
              <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(p.scoreBreakdown || {}, null, 2)}</pre>
              <div className="mt-2 flex gap-2">
                <button className="rounded border border-slate-300 px-2 py-1" onClick={() => postJson(`/api/admin/projects/${p.id}/toggle`, {})}>
                  {p.isIncludedInIssue ? 'Exclude' : 'Include'}
                </button>
                <button className="rounded border border-slate-300 px-2 py-1" onClick={() => postJson(`/api/admin/projects/${p.id}/override`, { scoreOverride: 99 })}>
                  Force Score 99
                </button>
                <button className="rounded border border-slate-300 px-2 py-1" onClick={() => postJson(`/api/admin/projects/${p.id}/override`, { scoreOverride: null })}>
                  Clear Override
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">GC Merge Tool</h2>
        <form
          className="mt-3 grid gap-2 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            postJson('/api/admin/gc/merge', {
              sourceGcEntityId: data.get('sourceGcEntityId'),
              targetGcEntityId: data.get('targetGcEntityId')
            });
          }}
        >
          <select name="sourceGcEntityId" className="rounded border border-slate-300 p-2 text-sm" required>
            <option value="">Source entity</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select name="targetGcEntityId" className="rounded border border-slate-300 p-2 text-sm" required>
            <option value="">Target entity</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white" disabled={busy !== null} type="submit">
            Merge
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">GC Watchlist</h2>
        <form
          className="mt-3 grid gap-2 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            postJson('/api/admin/watchlist', {
              gcEntityId: data.get('gcEntityId'),
              label: data.get('label'),
              notes: data.get('notes')
            });
          }}
        >
          <select className="rounded border border-slate-300 p-2 text-sm" name="gcEntityId" required>
            <option value="">Select GC</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input className="rounded border border-slate-300 p-2 text-sm" name="label" placeholder="Label" />
          <input className="rounded border border-slate-300 p-2 text-sm" name="notes" placeholder="Zip cluster / trade note" />
          <button className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white sm:col-span-3" type="submit">
            Add to Watchlist
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Raw Record Inspector</h2>
        <ul className="mt-3 space-y-3">
          {rawRecords.map((row) => (
            <li key={row.id} className="rounded border border-slate-100 p-2 text-xs">
              <p className="font-semibold">ObjectID {row.sourceObjectId} • {new Date(row.fetchedAt).toLocaleString()}</p>
              <p className="text-slate-600">Hash: {row.hash.slice(0, 14)}...</p>
              <pre className="mt-2 max-h-32 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(row.rawJson, null, 2)}</pre>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
