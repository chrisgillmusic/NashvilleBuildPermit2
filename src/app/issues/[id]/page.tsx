import { notFound } from 'next/navigation';
import { HotGcs } from '@/components/hot-gcs';
import { ProjectCard } from '@/components/project-card';
import { getIssueWithHotGcs } from '@/lib/issue/generate';

export default async function PublicIssuePage({ params }: { params: { id: string } }) {
  const data = await getIssueWithHotGcs(params.id);
  if (!data || data.issue.status !== 'published') notFound();

  const { issue, snapshots } = data;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{issue.title}</h1>
        <p className="whitespace-pre-line text-sm text-slate-700">{issue.introText}</p>
      </header>

      <p className="text-sm font-semibold text-slate-900">Here’s what’s in play this week.</p>

      {['ON DECK', 'IN MOTION', 'CLOSING OUT'].map((section) => (
        <section key={section} className="space-y-3">
          <h2 className="text-xl font-semibold">{section}</h2>
          <div className="space-y-3">
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

      <footer className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">{issue.outroText}</footer>
    </main>
  );
}
