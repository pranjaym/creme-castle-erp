// The heading every inventory screen shares: title, how fresh the data is, and
// a plain warning when the sync has fallen behind.
import Link from 'next/link';
import { lastSynced, type InventoryPage } from '@/lib/inventory';

const ist = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const TABS: [string, string][] = [['/inventory', 'Today'], ['/inventory/items', 'Projection'], ['/inventory/orders', 'Order plan'], ['/inventory/pos', 'PO tracker'], ['/inventory/health', 'Stock health'], ['/inventory/how', 'How it is worked out']];

export function InvHead({ title, page, here }: { title: string; page: InventoryPage; here: string }) {
  const { at, lines } = lastSynced(page.sync);
  const ageH = at ? (Date.now() - at.getTime()) / 3_600_000 : Infinity;
  const hourIst = (new Date().getUTCHours() + 5.5) % 24;
  const stale = ageH > 3 && hourIst >= 9 && hourIst < 23.5;   // overnight the sync rests, so an old reading is expected
  return <>
    <h1 className="page">{title}</h1>
    <p className="freshline">
      Packaging at the Noida Central Warehouse, from SupplyNote. Stock, movements and purchase orders last synced {at ? ist(at) : 'never'}
      {lines ? `; PO lines ${ist(lines)}` : ''}. Syncs every hour from 08:00 to 23:00.
    </p>
    {stale && <div className="inv-warn">The SupplyNote sync has fallen behind: the last full reading is {at ? `${ageH.toFixed(1)} hours old` : 'missing'}. The numbers below are as of that reading.</div>}
    <nav className="inv-tabs">{TABS.map(([href, label]) => <Link key={href} href={href} className={href === here ? 'on' : ''}>{label}</Link>)}</nav>
  </>;
}
