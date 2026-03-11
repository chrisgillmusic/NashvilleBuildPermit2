'use client';

import { useState } from 'react';

type SavedFilter = {
  id: string;
  name: string;
  queryJson: Record<string, string>;
};

export function SavedFilterBar({ filters, currentQuery }: { filters: SavedFilter[]; currentQuery: Record<string, string> }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  async function saveFilter() {
    const res = await fetch('/api/admin/saved-filters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name || 'Custom filter', query: currentQuery })
    });
    setMessage(res.ok ? 'Saved filter.' : 'Save failed.');
    if (res.ok) setName('');
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold">Saved Filters</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {filters.map((filter) => {
          const query = new URLSearchParams(filter.queryJson).toString();
          return (
            <a key={filter.id} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold" href={`/live?${query}`}>
              {filter.name}
            </a>
          );
        })}
        <a className="rounded border border-amber-400 px-2 py-1 text-xs font-semibold text-amber-700" href="/live?subtype=healthcare">
          Show me healthcare only
        </a>
        <a className="rounded border border-amber-400 px-2 py-1 text-xs font-semibold text-amber-700" href="/live?subtype=office+interior">
          Show me office interiors only
        </a>
        <a className="rounded border border-amber-400 px-2 py-1 text-xs font-semibold text-amber-700" href="/live?phase=ON+DECK&min=750000">
          ON DECK over $750k
        </a>
      </div>
      <div className="mt-3 flex gap-2">
        <input className="rounded border border-slate-300 p-2 text-sm" placeholder="name this filter" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white" onClick={saveFilter}>Save Current</button>
      </div>
      {message ? <p className="mt-2 text-xs text-slate-700">{message}</p> : null}
    </section>
  );
}
