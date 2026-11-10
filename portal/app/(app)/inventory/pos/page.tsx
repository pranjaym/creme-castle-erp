import { requireAccess } from '@/lib/session';
import { loadInventory } from '@/lib/inventory';
import { InvHead } from '../head';
import { PosView } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAccess((a) => a.inventory.view);
  const sp = await searchParams;
  const page = await loadInventory();
  return <div className="inv">
    <InvHead title="PO tracker" page={page} here="/inventory/pos" />
    <PosView d={page.d} b0={sp.b} />
  </div>;
}
