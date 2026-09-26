import { redirect } from 'next/navigation';
import { requireAccess } from '@/lib/session';
import { latestDashboard } from '@/lib/dashboards';

// Shortcut: bounce to the newest dashboard (or the archive list if there are none).
export default async function LatestDashboard() {
  await requireAccess(a => a.sales);
  const latest = await latestDashboard();
  redirect(latest ? `/dashboards/${latest.date}` : '/dashboards');
}
