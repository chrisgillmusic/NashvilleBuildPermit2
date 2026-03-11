import { DashboardShell } from '@/components/dashboard-shell';
import { getDashboardPayload } from '@/lib/permits/live';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const payload = await getDashboardPayload();

  return <DashboardShell initialPayload={payload} />;
}
