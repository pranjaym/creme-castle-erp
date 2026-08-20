// The production plan's inputs and suggestion, computed in ONE place so the
// screen and the save action can never disagree. Pure arithmetic (rule 4):
//   fixed par   : suggested = max(0, par - on hand + open requests)
//   on_demand   : suggested = open requests
//   ready_made  : not planned (excluded)
// On hand = the closing total of the day before the planned day. If no closing
// exists for that day the suggestion treats on hand as 0 and says so.
import 'server-only';
import { spine } from '@/lib/supabase/server';
import { ymdAddDays } from '@/lib/business-day';

export type PlanRow = {
  skuCode: string; name: string; category: string; uom: string;
  parQty: number | null; parType: string;
  onHand: number | null;          // null = no closing count for the base day
  requestedQty: number;
  suggested: number;
  existingPlanned: number | null; // an already-saved plan for this day (editing replaces)
};

export type PlanData = {
  planDate: string;
  closingDate: string;      // the day whose closing feeds on-hand (planDate - 1)
  closingExists: boolean;
  rows: PlanRow[];
};

export async function getPlanData(deptCode: string, planDate: string): Promise<PlanData | null> {
  const db = spine();
  const { data: dept } = await db.from('locations').select('id').eq('code', deptCode).single();
  if (!dept) return null;
  const closingDate = ymdAddDays(planDate, -1);

  const [{ data: skus }, { data: frz }] = await Promise.all([
    db.from('skus').select('id, code, name, category, uom')
      .eq('made_by_location_id', dept.id).eq('active', true).order('sort_order'),
    db.from('locations').select('id').eq('code', 'FREEZER-CK').single(),
  ]);

  const [{ data: pars }, { data: closings }, { data: reqs }, { data: existing }] = await Promise.all([
    db.from('par_stocks').select('sku_id, par_qty, par_type, effective_from, created_at')
      .eq('location_id', frz?.id ?? -1)
      .order('effective_from', { ascending: false }).order('created_at', { ascending: false }),
    db.from('v_closing_totals').select('sku_id, closing_qty')
      .eq('location_id', dept.id).eq('business_date', closingDate),
    db.from('v_request_status').select('sku_code, remaining_qty')
      .eq('maker_code', deptCode).in('state', ['open', 'partial']),
    db.from('v_plan_effective').select('sku_id, planned_qty')
      .eq('location_id', dept.id).eq('business_date', planDate),
  ]);

  const latestPar = new Map<number, { qty: number | null; type: string }>();
  for (const p of pars ?? []) {
    if (!latestPar.has(p.sku_id)) latestPar.set(p.sku_id, { qty: p.par_qty != null ? Number(p.par_qty) : null, type: p.par_type });
  }
  const closingBySku = new Map((closings ?? []).map((c) => [c.sku_id, Number(c.closing_qty)]));
  const reqBySkuCode = new Map<string, number>();
  for (const r of reqs ?? []) {
    reqBySkuCode.set(r.sku_code, (reqBySkuCode.get(r.sku_code) ?? 0) + Number(r.remaining_qty));
  }
  const existingBySku = new Map((existing ?? []).map((e) => [e.sku_id, Number(e.planned_qty)]));
  const closingExists = (closings ?? []).length > 0;

  const rows: PlanRow[] = [];
  for (const s of skus ?? []) {
    const par = latestPar.get(s.id) ?? { qty: null, type: 'fixed' };
    if (par.type === 'ready_made') continue;      // bought/ready items are not planned
    const onHand = closingExists ? (closingBySku.get(s.id) ?? 0) : null;
    const asked = reqBySkuCode.get(s.code) ?? 0;
    const suggested = par.type === 'on_demand'
      ? asked
      : Math.max(0, (par.qty ?? 0) - (onHand ?? 0) + asked);
    rows.push({
      skuCode: s.code, name: s.name, category: s.category ?? '', uom: s.uom,
      parQty: par.qty, parType: par.type, onHand, requestedQty: asked,
      suggested, existingPlanned: existingBySku.get(s.id) ?? null,
    });
  }
  return { planDate, closingDate, closingExists, rows };
}
