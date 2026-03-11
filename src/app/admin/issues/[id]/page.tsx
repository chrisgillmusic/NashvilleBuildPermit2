import Link from 'next/link';
import { HotGcs } from '@/components/hot-gcs';
import { IssueEditor } from '@/components/admin/issue-editor';
import { ProjectCard } from '@/components/project-card';
import { getIssueWithHotGcs } from '@/lib/issue/generate';

export default async function AdminIssuePage({ params }: { params: { id: string } }) {
  const data = await getIssueWithHotGcs(params.id);
  if (!data) {
    return <main className="p-6">Issue not found.</main>;
  }

  const { issue, snapshots } = data;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{issue.title}</h1>
        <Link className="text-sm font-semibold text-amber-700 underline" href="/admin">
          Back to Admin
        </Link>
      </header>

      <IssueEditor issueId={issue.id} title={issue.title} introText={issue.introText} outroText={issue.outroText} />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="whitespace-pre-line text-sm text-slate-700">{issue.introText}</p>
      </section>

      {['ON DECK', 'IN MOTION', 'CLOSING OUT'].map((section) => (
        <section key={section} className="space-y-3">
          <h2 className="text-xl font-semibold">{section}</h2>
          <div className="grid gap-3">
            {issue.projects
              .filter((row) => row.sectionName === section)
              .map((row) => (
                <ProjectCard
                  key={row.id}
                  project={row.project}
                  scope={row.displayNote}
                  note={row.customTradeNote || row.project.likelyStageNote || ''}
                  contactName={row.project.gcLinks[0]?.gcEntity.canonicalName || row.project.contactRaw}
                />
              ))}
          </div>
        </section>
      ))}

      <section>
        <h2 className="mb-3 text-xl font-semibold">HOT GCs</h2>
        <HotGcs snapshots={snapshots} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-700">{issue.outroText}</p>
      </section>
    </main>
  );
}
