// Build 3a read-back: current frozen-buffer level per intermediate, plus today's
// entries. Par comparison shows once par_stocks is loaded (no schema change).
import { spine } from '@/lib/supabase/server';
import { businessDay, istWeekday } from '@/lib/business-day';

export const dynamic = 'force-dynamic';

export default async function BufferPage() {
  const db = spine();
  const { data: buffer } = await db
    .from('v_frozen_buffer').select('*').order('sort_order');
  const { data: today } = await db
    .from('v_today_entries').select('*');
  const d = new Date();

  return (
    <main>
      <h1>Frozen buffer</h1>
      <p style={{ color: 'var(--muted)' }}>{businessDay(d)} ({istWeekday(d)})</p>
      <table>
        <thead><tr><th>Item</th><th className="num">On hand</th><th className="num">Par</th><th className="num">vs par</th><th>Behaviour</th></tr></thead>
        <tbody>
          {(buffer ?? []).map((r: any) => (
            <tr key={r.sku_code}>
              <td>{r.sku_name} <span style={{ color: 'var(--muted)' }}>({r.uom})</span></td>
              <td className={`num ${Number(r.on_hand) < 0 ? 'neg' : ''}`}>{r.on_hand}</td>
              <td className="num">{r.par_qty ?? (r.par_type !== 'fixed' ? r.par_type : '-')}</td>
              <td className={`num ${r.vs_par != null && Number(r.vs_par) < 0 ? 'neg' : ''}`}>{r.vs_par ?? '-'}</td>
              <td>{r.buffer_behaviour ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h1 style={{ marginTop: 24 }}>Today's entries</h1>
      <table>
        <thead><tr><th>Time</th><th>Item</th><th>Action</th><th className="num">Qty</th><th>By</th></tr></thead>
        <tbody>
          {(today ?? []).map((r: any) => (
            <tr key={r.id}>
              <td>{new Date(r.entered_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
              <td>{r.sku_name}</td>
              <td>{r.action}{r.dest_code ? ` -> ${r.dest_code}` : ''}{r.reason_code ? ` (${r.reason_code})` : ''}</td>
              <td className="num">{r.qty} {r.uom}</td>
              <td>{r.entered_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
