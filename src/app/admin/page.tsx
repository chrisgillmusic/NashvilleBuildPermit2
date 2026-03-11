import Link from 'next/link';
import { WeeklyIssueStatus } from '@prisma/client';
import { AdminDashboard } from '@/components/admin/admin-dashboard';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const [recentSyncs, draftIssues, recentProjects, gcEntities, settings, rawRecords] = await Promise.all([
    prisma.syncBatch.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
    prisma.weeklyIssue.findMany({ where: { status: WeeklyIssueStatus.draft }, orderBy: { weekStartDate: 'desc' }, take: 10 }),
    prisma.project.findMany({ orderBy: { updatedAt: 'desc' }, take: 12 }),
    prisma.gcEntity.findMany({ orderBy: { canonicalName: 'asc' }, take: 200 }),
    getSettings(),
    prisma.rawPermit.findMany({ orderBy: { fetchedAt: 'desc' }, take: 6 })
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="text-sm text-slate-700">Sync pipeline, normalization, scoring, issue editorial controls.</p>
        </div>
        <Link className="text-sm font-semibold text-amber-700 underline" href="/live">
          Live View
        </Link>
      </header>
      <AdminDashboard
        recentSyncs={recentSyncs.map((s) => ({
          id: s.id,
          status: s.status,
          startedAt: s.startedAt.toISOString(),
          recordsProcessed: s.recordsProcessed,
          errorSummary: s.errorSummary
        }))}
        draftIssues={draftIssues.map((i) => ({
          id: i.id,
          title: i.title,
          weekStartDate: i.weekStartDate.toISOString(),
          status: i.status
        }))}
        recentProjects={recentProjects.map((p) => ({
          id: p.id,
          address: p.address,
          permitSubtypeDescription: p.permitSubtypeDescription,
          contactRaw: p.contactRaw,
          normalizedContactName: p.normalizedContactName,
          score: p.score,
          scoreOverride: p.scoreOverride,
          isIncludedInIssue: p.isIncludedInIssue,
          scoreBreakdown: p.scoreBreakdown
        }))}
        gcEntities={gcEntities.map((g) => ({ id: g.id, canonicalName: g.canonicalName }))}
        settings={settings}
        rawRecords={rawRecords.map((r) => ({
          id: r.id,
          sourceObjectId: r.sourceObjectId,
          fetchedAt: r.fetchedAt.toISOString(),
          hash: r.hash,
          rawJson: r.rawJson
        }))}
      />
    </main>
  );
}
