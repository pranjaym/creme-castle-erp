'use server';
// Build 1a consumer: run the reconciliation for one business day, write the
// three-bucket output. Reads ONLY canonical views (layer 2). Normalisation and
// bucketing come from lib/recon/match-core.mjs so the numbers are reproducible
// and single-sourced. No AI anywhere.
import { spine } from '@/lib/supabase/server';
import { reconcile, summarize } from '@/lib/recon/match-core.mjs';
import { revalidatePath } from 'next/cache';

export async function runRecon(businessDate: string) {
  const db = spine();

  const { data: oms, error: oe } = await db
    .from('v_oms_d2c_orders').select('*').eq('business_date', businessDate);
  if (oe) return { ok: false, message: oe.message };

  const { data: punch, error: pe } = await db
    .from('v_petpooja_punchouts').select('*').eq('business_date', businessDate);
  if (pe) return { ok: false, message: pe.message };

  // Group both sides by canonical store code, reconcile store by store.
  const stores = new Set<string>();
  (oms ?? []).forEach((o: any) => o.location_code && stores.add(o.location_code));
  (punch ?? []).forEach((p: any) => p.location_code && stores.add(p.location_code));

  const allRows: any[] = [];
  for (const code of stores) {
    const omsOrders = (oms ?? []).filter((o: any) => o.location_code === code).map((o: any) => ({
      id: o.oms_order_id, shopify_name: o.shopify_name, order_qty: Number(o.order_qty ?? 0),
      line_count: Number(o.line_count ?? 0), order_total: Number(o.order_total ?? 0),
      status: o.status, bill_void: o.bill_void, location_code: code,
    }));
    const punchouts = (punch ?? []).filter((p: any) => p.location_code === code).map((p: any) => ({
      ref_raw: p.ref_raw, punch_qty: Number(p.punch_qty ?? 0),
      punch_lines: Number(p.punch_lines ?? 0), punch_total: Number(p.punch_total ?? 0),
      location_code: code, source: 'petpooja',
    }));
    allRows.push(...reconcile(omsOrders, punchouts, { location_code: code, business_date: businessDate }));
  }

  const summary = summarize(allRows);
  const { data: run, error: re } = await db
    .from('recon_runs').insert({ business_date: businessDate, created_by: 'app', summary })
    .select('id').single();
  if (re || !run) return { ok: false, message: re?.message ?? 'run insert failed' };

  if (allRows.length) {
    const rows = allRows.map((r) => ({
      run_id: run.id, business_date: businessDate, location_code: r.location_code,
      bucket: r.bucket, reason: r.reason, oms_order_ref: r.oms_order_ref,
      punch_ref_raw: r.punch_ref_raw, oms_qty: r.oms_qty, punch_qty: r.punch_qty,
      oms_lines: r.oms_lines, punch_lines: r.punch_lines,
      oms_total: r.oms_total, punch_total: r.punch_total, oms_status: r.oms_status,
      cancelled_or_void: r.cancelled_or_void ?? false,
    }));
    const { error: ie } = await db.from('d2c_reconciliation').insert(rows);
    if (ie) return { ok: false, message: ie.message };
  }

  revalidatePath('/recon');
  return { ok: true, message: 'Reconciliation done', summary };
}
