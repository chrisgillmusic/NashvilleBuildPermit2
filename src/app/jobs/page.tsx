import { DashboardShell } from '@/components/dashboard-shell';
import { getDashboardPayload } from '@/lib/permits/live';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const payload = await getDashboardPayload();

  return <DashboardShell initialPayload={payload} initialTab="jobs" />;
}
