import { requireAccess } from '@/lib/session';
import { loadInventory } from '@/lib/inventory';
import { InvHead } from '../head';
import { ItemsView } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAccess((a) => a.inventory.view);
  const sp = await searchParams;
  const page = await loadInventory();
  return <div className="inv">
    <InvHead title="Projection" page={page} here="/inventory/items" />
    <ItemsView d={page.d} g0={sp.g} type0={sp.type} item0={sp.item} />
  </div>;
}
