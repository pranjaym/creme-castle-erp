import { requireAccess } from '@/lib/session';
import { loadInventory } from '@/lib/inventory';
import { InvHead } from './head';
import { HomeView } from './ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAccess((a) => a.inventory.view);
  const page = await loadInventory();
  return <div className="inv">
    <InvHead title="Inventory: today" page={page} here="/inventory" />
    <HomeView d={page.d} />
  </div>;
}
