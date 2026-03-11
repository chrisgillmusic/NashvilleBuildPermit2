'use client';

import { useState } from 'react';

type Props = {
  issueId: string;
  title: string;
  introText: string;
  outroText: string;
};

export function IssueEditor({ issueId, title: initialTitle, introText: initialIntro, outroText: initialOutro }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [introText, setIntroText] = useState(initialIntro);
  const [outroText, setOutroText] = useState(initialOutro);
  const [message, setMessage] = useState('');

  async function saveText() {
    const res = await fetch(`/api/admin/issues/${issueId}/update-text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, introText, outroText })
    });
    setMessage(res.ok ? 'Saved intro/outro.' : 'Save failed.');
  }

  async function publish() {
    const res = await fetch(`/api/admin/issues/${issueId}/publish`, { method: 'POST' });
    setMessage(res.ok ? 'Published issue.' : 'Publish failed.');
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Weekly Issue Editor</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-sm font-semibold">Title</label>
        <input className="w-full rounded border border-slate-300 p-2" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="block text-sm font-semibold">Intro</label>
        <textarea className="h-48 w-full rounded border border-slate-300 p-2" value={introText} onChange={(e) => setIntroText(e.target.value)} />
        <label className="block text-sm font-semibold">Outro</label>
        <textarea className="h-24 w-full rounded border border-slate-300 p-2" value={outroText} onChange={(e) => setOutroText(e.target.value)} />
      </div>
      <div className="mt-3 flex gap-2">
        <button className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white" onClick={saveText}>Save</button>
        <button className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white" onClick={publish}>Publish</button>
        <a className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold" href={`/api/admin/issues/${issueId}/export?format=text`}>
          Export Text
        </a>
        <a className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold" href={`/api/admin/issues/${issueId}/export?format=html`}>
          Export HTML
        </a>
      </div>
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}
