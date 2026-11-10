import { requireAccess } from '@/lib/session';
import { loadInventory } from '@/lib/inventory';
import { InvHead } from '../head';
import { OrdersView } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAccess((a) => a.inventory.view);
  const sp = await searchParams;
  const page = await loadInventory();
  return <div className="inv">
    <InvHead title="Order plan" page={page} here="/inventory/orders" />
    <OrdersView d={page.d} vendor0={sp.vendor} />
  </div>;
}
