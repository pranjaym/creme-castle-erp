import { requireAccess } from '@/lib/session';
import { loadInventory } from '@/lib/inventory';
import { STATUS_LABEL, statusMeaning, type Status } from '@/lib/inventory-engine';
import { InvHead } from '../head';

export const dynamic = 'force-dynamic';
const ORDER: Status[] = ['OUT', 'OUT_PO', 'ORDER', 'CHASE', 'OK', 'IDLE'];
const PILL: Record<Status, string> = { OUT: 'inv-p-out', OUT_PO: 'inv-p-out', ORDER: 'inv-p-order', CHASE: 'inv-p-chase', OK: 'inv-p-ok', IDLE: 'inv-p-idle' };

export default async function Page() {
  await requireAccess((a) => a.inventory.view);
  const page = await loadInventory(); const S = page.d.settings;
  const types = [...new Set(page.d.items.map((i) => i.type))].sort();
  return <div className="inv">
    <InvHead title="How it is worked out" page={page} here="/inventory/how" />
    <div className="card"><h2>What each label means</h2><p className="inv-sub">Every item carries exactly one of these.</p>
      <div className="inv-lg">{ORDER.map((s) => [<span key={s}><span className={`inv-pill ${PILL[s]}`}>{STATUS_LABEL[s]}</span></span>, <span key={s + 'm'}>{statusMeaning(s, S.usage_days)}</span>])}</div></div>
    <div className="card"><h2>How every number is worked out</h2><p className="inv-sub">Plain arithmetic on SupplyNote data. Estimates are labelled.</p>
      <ul className="inv-rules">
        <li><b>The one sum behind every screen:</b> stock today, minus what we use each day, plus what is really coming, compared with how long a new order takes.</li>
        <li><b>Stock</b> is SupplyNote's stock for the Noida Central Warehouse at the last sync. It does not see stock already sent to the kitchen departments.</li>
        <li><b>Used a day</b> = quantity sent out from the warehouse on transfer bills over the last {S.usage_days} complete days, divided by {S.usage_days} (or by the days since the item first appeared, if it is newer).</li>
        <li><b>Days in hand</b> = stock divided by used a day.</li>
        <li><b>On order</b> = ordered minus cancelled minus received, on purchase orders that are not void or closed and not more than {S.past_due_cutoff_days} days past due.</li>
        <li><b>Old POs</b> are more than {S.past_due_cutoff_days} days past due. They are shown and never counted. Setting: {S.past_due_cutoff_days} days (Pranjay, 10 Nov 2026), changeable.</li>
        <li><b>Finishes</b>: each day, yesterday's balance minus one day's use; a PO lands at the end of its due day (a late PO inside the {S.past_due_cutoff_days} days is assumed to land today). The date is the first day the balance reaches zero.</li>
        <li><b>Days needed</b> = lead time + buffer. Lead time is the item's own figure if one is set, else the vendor's usual figure from the August 2026 lead time sheet, else an estimate from how often the item is delivered, else {S.default_lead_days} days. The buffer equals the lead time, up to {S.buffer_max_days} days. Estimates; the buffer rule is a proposal.</li>
        <li><b>Order quantity</b> = used a day x (days needed + {S.order_cover_days} days) - stock - on order, raised to the minimum order where one is on record. The {S.order_cover_days} days is a proposal.</li>
        <li><b>Rough</b> tag: sent out on fewer than 3 days in {S.usage_days}, usually one large lot to the kitchen. The daily figure is rough and the kitchen may still hold stock SupplyNote cannot see.</li>
        <li><b>Below zero</b> tag: SupplyNote shows negative stock, which means a delivery was used before it was entered.</li>
        <li><b>Type</b> groups the items so they are easier to scan: {types.join(', ')}. Items marked ? are the doubtful ones, to be confirmed.</li>
        <li><b>Scope:</b> packaging only (SupplyNote categories "packaging" and "boxes and bags"). Raw materials need their own planning and are not here.</li>
      </ul></div>
  </div>;
}
