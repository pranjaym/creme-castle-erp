// Admin · Activity: the append-only audit trail (spine_events), readable at
// last. Every write in this module lands here: entries, receipts, closings,
// requests, master edits. Filterable by area; newest first.
import { spine } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const AREAS = [
  { key: 'all', label: 'Everything' },
  { key: 'production_log', label: 'Entries (made/sent/waste)' },
  { key: 'transfer_receipts', label: 'Receipts' },
  { key: 'closing_counts', label: 'Closings' },
  { key: 'dept_requests', label: 'Requests' },
  { key: 'admin', label: 'Master edits' },
] as const;

const clock = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', day: 'numeric', month: 'short' });

// Compact, human line out of the event payload: keys worth reading, in order.
function describe(data: any): string {
  if (!data || typeof data !== 'object') return '';
  const parts: string[] = [];
  const keys = ['dept', 'verb', 'count', 'business_date', 'sent_qty', 'received_qty', 'mismatch',
    'rows', 'from', 'to', 'needed_by', 'role', 'reason', 'sku', 'qty', 'par_qty', 'par_type',
    'sort_order', 'day_start', 'closing_before', 'backdated', 'code', 'name', 'category', 'uom'];
  for (const k of keys) {
    if (data[k] === undefined || data[k] === null || data[k] === false) continue;
    parts.push(`${k.replace(/_/g, ' ')}: ${data[k] === true ? 'yes' : data[k]}`);
  }
  return parts.join(' · ');
}

export default async function AdminActivityPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const area = AREAS.some((a) => a.key === one(sp.area)) ? one(sp.area) : 'all';

  const db = spine();
  let q = db.from('spine_events').select('id, entity, entity_ref, action, actor, data, at')
    .order('at', { ascending: false }).limit(200);
  if (area !== 'all') q = q.eq('entity', area);
  const { data: events } = await q;

  return (
    <>
      <div className="adminhead">
        <span className="title">Activity</span>
        <span className="blurb">the append-only audit trail · every write in this module, newest first · nothing here can be edited or deleted</span>
      </div>
      <div className="adminbody">
        <form method="get" className="filterbar">
          <label>Area
            <select name="area" defaultValue={area} style={{ minWidth: 220 }}>
              {AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
          <button className="ghostbtn" type="submit">Apply</button>
        </form>

        <div className="tablewrap admincard">
          <table className="sheet slim" style={{ border: 'none' }}>
            <thead><tr><th>When</th><th>Area</th><th>What</th><th>Who</th><th>Detail</th></tr></thead>
            <tbody>
              {(events ?? []).length === 0 && (
                <tr><td colSpan={5} className="unit" style={{ padding: 16 }}>No activity in this area yet.</td></tr>
              )}
              {(events ?? []).map((e: any) => (
                <tr key={e.id}>
                  <td className="unit" style={{ whiteSpace: 'nowrap' }}>{clock(e.at)}</td>
                  <td className="unit">{AREAS.find((a) => a.key === e.entity)?.label ?? e.entity}{e.entity_ref ? ` #${e.entity_ref}` : ''}</td>
                  <td className="name">{String(e.action).replace(/_/g, ' ')}</td>
                  <td className="unit">{e.actor ?? ''}</td>
                  <td className="unit">{describe(e.data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
