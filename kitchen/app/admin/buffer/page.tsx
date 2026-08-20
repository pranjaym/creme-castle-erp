// Admin · Frozen buffer: what is actually in the freezer per intermediate,
// against its par. Lives inside the console shell like every other management
// screen. Levels come from the movement ledger, so they follow the module mode
// (trial rows are excluded once the real run starts).
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, weekdayForYmd } from '@/lib/business-day';
import { requireRoles } from '@/lib/session';

export const dynamic = 'force-dynamic';

const fmt = (n: number | null) => (n == null ? '' : Number.isInteger(n) ? String(n) : Number(n).toFixed(2).replace(/\.?0+$/, ''));

export default async function AdminBufferPage() {
  await requireRoles(['exec_chef', 'tech', 'super_admin']);
  const db = spine();
  const { data: buffer } = await db.from('v_frozen_buffer').select('*').order('sort_order');
  const today = istCalendarDate(new Date());

  const rows = buffer ?? [];
  const below = rows.filter((r: any) => r.vs_par != null && Number(r.vs_par) < 0).length;
  const negative = rows.filter((r: any) => Number(r.on_hand) < 0).length;

  return (
    <>
      <div className="adminhead">
        <span className="title">Frozen buffer</span>
        <span className="blurb">on hand against par, per intermediate · {weekdayForYmd(today)} {today}</span>
      </div>
      <div className="adminbody">
        <div className="statgrid">
          <div className="statcard"><div className="k">Items tracked</div><div className="v">{rows.length}</div><div className="s">live intermediates</div></div>
          <div className="statcard"><div className="k">Below par</div><div className="v">{below}</div><div className="s">under the target level</div></div>
          <div className="statcard"><div className="k">Negative</div><div className="v">{negative}</div><div className="s">more issued than made: a logging gap</div></div>
        </div>

        <div className="tablewrap admincard">
          <table className="sheet slim" style={{ border: 'none' }}>
            <thead><tr>
              <th>Item</th><th className="num">On hand</th><th className="num">Par</th><th className="num">vs par</th><th>Behaviour</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="unit" style={{ padding: 16 }}>No levels yet: nothing has been made or counted.</td></tr>
              )}
              {rows.map((r: any) => (
                <tr key={r.sku_code}>
                  <td className="name">{r.sku_name} <small className="unit">{r.uom}</small></td>
                  <td className={`num ${Number(r.on_hand) < 0 ? 'neg' : ''}`}>{fmt(Number(r.on_hand))}</td>
                  <td className="num">{r.par_qty != null ? fmt(Number(r.par_qty)) : (r.par_type !== 'fixed' ? String(r.par_type).replace('_', ' ') : '')}</td>
                  <td className={`num ${r.vs_par != null && Number(r.vs_par) < 0 ? 'neg' : ''}`}>{r.vs_par != null ? fmt(Number(r.vs_par)) : ''}</td>
                  <td className="unit">{r.buffer_behaviour ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          A negative level means more has been issued than was ever recorded as made, which is a logging gap
          rather than real stock. Entries themselves are in Activity, and per day in the Day ledger.
        </p>
      </div>
    </>
  );
}
