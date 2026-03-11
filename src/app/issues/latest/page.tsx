import { redirect } from 'next/navigation';
import { latestPublishedIssue } from '@/lib/issue/generate';

export const dynamic = 'force-dynamic';

export default async function LatestIssuePage() {
  const latest = await latestPublishedIssue();
  if (!latest) {
    return <main className="p-6 text-sm">No published issue yet. Generate and publish from admin.</main>;
  }
  redirect(`/issues/${latest.id}`);
}
