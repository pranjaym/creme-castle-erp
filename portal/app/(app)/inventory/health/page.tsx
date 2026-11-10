import { requireAccess } from '@/lib/session';
import { loadInventory } from '@/lib/inventory';
import { InvHead } from '../head';
import { HealthView } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAccess((a) => a.inventory.view);
  const page = await loadInventory();
  return <div className="inv">
    <InvHead title="Stock health" page={page} here="/inventory/health" />
    <HealthView d={page.d} />
  </div>;
}
