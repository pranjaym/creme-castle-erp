// Build 1a morning view: three exception buckets, per store, for a business day.
// Matched rows are the happy path and are omitted; only exceptions (and matched
// but cancelled/void) show.
import { spine } from '@/lib/supabase/server';
import RunButton from './RunButton';
import { requireRoles } from '@/lib/session';

export const dynamic = 'force-dynamic';

const BUCKET_LABEL: Record<string, string> = {
  punch_no_order: 'Punch, no order (leak: call the store)',
  order_no_punch: 'Order, no punch (store forgot)',
  qty_item_mismatch: 'Matched, but total or lines differ',
};

export default async function ReconPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  // management only: department tablets stay on their own screen
  await requireRoles(['exec_chef', 'tech', 'super_admin']);
  const sp = await searchParams;
  const db = spine();
  const { data: latest } = await db
    .from('recon_runs').select('business_date, summary, created_at').order('created_at', { ascending: false }).limit(1);
  const businessDate = sp.d ?? latest?.[0]?.business_date ?? '';

  const { data: rows } = await db
    .from('v_recon_exceptions').select('*').eq('business_date', businessDate);

  return (
    <main>
      <h1>D2C reconciliation</h1>
      <p style={{ color: 'var(--muted)' }}>Business day {businessDate || '(none yet)'}. Four stores: SPJ, FBD, GN, Meerut.</p>
      <RunButton businessDate={businessDate} />
      {latest?.[0]?.summary && (
        <p>
          {Object.entries(latest[0].summary).map(([k, v]) => (
            <span key={k} className="pill" style={{ marginRight: 6 }}>{k}: {String(v)}</span>
          ))}
        </p>
      )}
      <table>
        <thead><tr><th>Store</th><th>Bucket</th><th>OMS order</th><th className="num">OMS units</th><th className="num">Punch units</th><th className="num">Lines</th><th>Note</th></tr></thead>
        <tbody>
          {(rows ?? []).map((r: any, i: number) => (
            <tr key={i}>
              <td>{r.location_code}</td>
              <td>{BUCKET_LABEL[r.bucket] ?? r.bucket}</td>
              <td>{r.oms_order_ref ?? r.punch_ref_raw ?? '-'}</td>
              <td className="num">{r.oms_qty ?? '-'}</td>
              <td className="num">{r.punch_qty ?? '-'}</td>
              <td className="num">{(r.oms_lines ?? '-') + ' / ' + (r.punch_lines ?? '-')}</td>
              <td>{r.cancelled_or_void ? 'CANCELLED/VOID' : (r.reason ?? '')}</td>
            </tr>
          ))}
          {(rows ?? []).length === 0 && (
            <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>No exceptions for this day (or no run yet).</td></tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
