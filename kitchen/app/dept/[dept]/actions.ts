'use server';
// Department module writes (Sponges + Liquids first). Append-only, no edits,
// no deletes, every write audited in spine_events. Three movement verbs plus
// the receiver confirmation and the closing count.
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, ymdAddDays, weekdayForYmd } from '@/lib/business-day';
import { revalidatePath } from 'next/cache';
import { getKitchenUser, mayUseDept } from '@/lib/session';

type Action = 'made' | 'issued' | 'wasted';
const FREEZER_CODE = 'FREEZER-CK';
const DISPATCH_CODE = 'CDIS';
const DEPTS_WITH_SCREENS = ['CK-SPONGE', 'CK-LIQUID'];

// Server-side gate on every write: the caller must be signed in with kitchen
// access AND allowed onto this department (a department account only its own).
async function guardDept(deptCode: string): Promise<string | null> {
  const u = await getKitchenUser();
  if (!u) return 'Not signed in. Open /login first.';
  if (!mayUseDept(u, deptCode)) return 'Your account cannot write for this department.';
  return null;
}

export type DeptBatchRow = {
  skuCode: string;
  action: Action;
  qty: number;
  destCode?: string | null;   // issued: department or spoke
  reasonCode?: string | null; // wasted
  requestId?: number | null;  // issued: the request this send fulfils (pull flow)
};

export type ClosingRow = {
  skuCode: string;
  // Age-bucketed like the paper registers. Any bucket may be blank; a plain
  // unsplit total goes in totalOnly instead.
  today?: number | null;      // age 0
  oneDay?: number | null;     // age 1
  twoDay?: number | null;     // age 2
  older?: number | null;      // age 3 (3+ days)
  totalOnly?: number | null;  // unsplit count (age unknown)
};

function dateWindowError(businessDate: string): string | null {
  const today = istCalendarDate(new Date());
  const yesterday = ymdAddDays(today, -1);
  if (businessDate !== today && businessDate !== yesterday) {
    return `Date ${businessDate} is not allowed. Choose today or yesterday.`;
  }
  return null;
}

/** Movement batch for one department: made into the freezer, issued to a
 *  destination, or wasted with a reason. Same rules as the original logbook,
 *  parameterised by department. */
export async function logDeptBatch(
  deptCode: string, rows: DeptBatchRow[], enteredBy: string, businessDate: string,
) {
  const guard = await guardDept(deptCode);
  if (guard) return { ok: false, message: guard };
  const db = spine();
  if (!DEPTS_WITH_SCREENS.includes(deptCode)) return { ok: false, message: `Unknown department ${deptCode}` };
  const clean = rows.filter((r) => r.qty > 0);
  if (!clean.length) return { ok: false, message: 'Nothing to save (all quantities blank)' };
  const winErr = dateWindowError(businessDate);
  if (winErr) return { ok: false, message: winErr };
  const backdated = businessDate !== istCalendarDate(new Date());

  const { data: skus } = await db.from('skus').select('id, code, uom, made_by_location_id');
  const { data: locs } = await db.from('locations').select('id, code, type');
  const skuBy = new Map((skus ?? []).map((s) => [s.code, s]));
  const locBy = new Map((locs ?? []).map((l) => [l.code, l]));
  const dept = locBy.get(deptCode);
  if (!dept) return { ok: false, message: `Department ${deptCode} not in location master` };
  const freezerId = locBy.get(FREEZER_CODE)?.id ?? null;
  const dispatchId = locBy.get(DISPATCH_CODE)?.id ?? null;

  const inserts: any[] = [];
  for (const r of clean) {
    const s = skuBy.get(r.skuCode);
    if (!s) return { ok: false, message: `Unknown item ${r.skuCode}` };
    if (r.action === 'made' && s.made_by_location_id !== dept.id) {
      return { ok: false, message: `${r.skuCode} is not made by this department` };
    }
    let toId: number | null = null;
    let viaId: number | null = null;
    if (r.action === 'made') toId = freezerId;
    else if (r.action === 'issued') {
      const d = r.destCode ? locBy.get(r.destCode) : null;
      if (!d) return { ok: false, message: `Unknown destination ${r.destCode}` };
      if (d.id === dept.id) return { ok: false, message: 'Cannot issue to yourself' };
      toId = d.id;
      if (d.type === 'assembly_spoke') viaId = dispatchId; // cross-dock
    } else if (r.action === 'wasted' && !r.reasonCode) {
      return { ok: false, message: `Reason needed for ${r.skuCode}` };
    }
    inserts.push({
      business_date: businessDate, sku_id: s.id, action: r.action, qty: r.qty, uom: s.uom,
      from_location_id: dept.id, to_location_id: toId, via_location_id: viaId,
      reason_code: r.action === 'wasted' ? r.reasonCode : null, entered_by: enteredBy,
      request_id: r.action === 'issued' ? (r.requestId ?? null) : null,
    });
  }

  const { error } = await db.from('production_log').insert(inserts);
  if (error) return { ok: false, message: error.message };
  await db.from('spine_events').insert({
    entity: 'production_log', action: 'batch_insert', actor: enteredBy,
    data: { dept: deptCode, count: inserts.length, verb: clean[0].action, business_date: businessDate, backdated },
  });
  revalidatePath(`/dept/${deptCode}`);
  revalidatePath('/buffer');
  const dayLabel = `${businessDate} (${weekdayForYmd(businessDate)})`;
  return { ok: true, message: `Saved ${inserts.length} ${clean[0].action} entr${inserts.length === 1 ? 'y' : 'ies'} for ${dayLabel}`, count: inserts.length };
}

/** The receiver's side of a transfer. Append-only: re-confirming adds a new
 *  row and the latest wins (v_receipt_effective). receivedQty 0 is allowed
 *  (nothing arrived) and is honest data, not an error. */
export async function confirmReceipt(
  deptCode: string, productionLogId: number, receivedQty: number, receivedBy: string, note?: string,
) {
  const guard = await guardDept(deptCode);
  if (guard) return { ok: false, message: guard };
  const db = spine();
  if (!(receivedQty >= 0)) return { ok: false, message: 'Received quantity must be 0 or more' };

  // The row must be a real issued movement addressed to this department.
  const { data: pl, error: plErr } = await db
    .from('production_log')
    .select('id, action, qty, uom, to_location_id')
    .eq('id', productionLogId).single();
  if (plErr || !pl) return { ok: false, message: 'Transfer not found' };
  if (pl.action !== 'issued') return { ok: false, message: 'Not a transfer row' };
  const { data: toLoc } = await db.from('locations').select('code').eq('id', pl.to_location_id).single();
  if (toLoc?.code !== deptCode) return { ok: false, message: 'This transfer is not addressed to your department' };

  const { error } = await db.from('transfer_receipts').insert({
    production_log_id: productionLogId, received_qty: receivedQty, received_by: receivedBy, note: note || null,
  });
  if (error) return { ok: false, message: error.message };
  const mismatch = Number(receivedQty) !== Number(pl.qty);
  await db.from('spine_events').insert({
    entity: 'transfer_receipts', entity_ref: String(productionLogId), action: 'confirm', actor: receivedBy,
    data: { dept: deptCode, sent_qty: pl.qty, received_qty: receivedQty, mismatch },
  });
  revalidatePath(`/dept/${deptCode}`);
  return {
    ok: true,
    message: mismatch
      ? `Recorded: received ${receivedQty} against ${pl.qty} sent. The difference is flagged.`
      : `Received ${receivedQty} ${pl.uom}. Matches what was sent.`,
  };
}

/** The closing count: a physical count per item, age-bucketed like the paper
 *  registers (today / 1 day / 2 days / 3+ days old), or a plain total when the
 *  team does not split. One closing_counts row per filled bucket. */
export async function saveClosing(
  deptCode: string, businessDate: string, rows: ClosingRow[], enteredBy: string,
) {
  const guard = await guardDept(deptCode);
  if (guard) return { ok: false, message: guard };
  const db = spine();
  if (!DEPTS_WITH_SCREENS.includes(deptCode)) return { ok: false, message: `Unknown department ${deptCode}` };
  const winErr = dateWindowError(businessDate);
  if (winErr) return { ok: false, message: winErr };

  const { data: skus } = await db.from('skus').select('id, code, uom');
  const { data: locs } = await db.from('locations').select('id, code');
  const skuBy = new Map((skus ?? []).map((s) => [s.code, s]));
  const dept = (locs ?? []).find((l) => l.code === deptCode);
  if (!dept) return { ok: false, message: `Department ${deptCode} not in location master` };

  const inserts: any[] = [];
  for (const r of rows) {
    const s = skuBy.get(r.skuCode);
    if (!s) return { ok: false, message: `Unknown item ${r.skuCode}` };
    const buckets: Array<[number | null, number | null | undefined]> = [
      [0, r.today], [1, r.oneDay], [2, r.twoDay], [3, r.older], [null, r.totalOnly],
    ];
    for (const [age, v] of buckets) {
      if (v == null || Number.isNaN(Number(v))) continue;
      const qty = Number(v);
      if (qty < 0) return { ok: false, message: `Negative count for ${r.skuCode}` };
      // Zeroes in age buckets are noise; a zero TOTAL is meaningful (counted, none left).
      if (qty === 0 && age !== null) continue;
      inserts.push({
        location_id: dept.id, business_date: businessDate, sku_id: s.id,
        qty, age_days: age, uom: s.uom, entered_by: enteredBy,
      });
    }
  }
  if (!inserts.length) return { ok: false, message: 'Nothing counted yet. Fill at least one item.' };

  const { error } = await db.from('closing_counts').insert(inserts);
  if (error) return { ok: false, message: error.message };
  await db.from('spine_events').insert({
    entity: 'closing_counts', action: 'closing_saved', actor: enteredBy,
    data: { dept: deptCode, business_date: businessDate, rows: inserts.length },
  });
  revalidatePath(`/dept/${deptCode}`);
  const dayLabel = `${businessDate} (${weekdayForYmd(businessDate)})`;
  return { ok: true, message: `Closing saved: ${inserts.length} counts for ${dayLabel}`, count: inserts.length };
}

export type RequestRow = { skuCode: string; qty: number };

/** Raise requests on another department (the pull flow, like an indent/PO).
 *  One dept_requests row per item; fulfilment is derived from the issued
 *  movements that link back via request_id. */
export async function createRequests(
  deptCode: string, askDeptCode: string, rows: RequestRow[], neededBy: string | null,
  note: string | null, enteredBy: string,
) {
  const guard = await guardDept(deptCode);
  if (guard) return { ok: false, message: guard };
  const db = spine();
  if (!DEPTS_WITH_SCREENS.includes(deptCode)) return { ok: false, message: `Unknown department ${deptCode}` };
  if (deptCode === askDeptCode) return { ok: false, message: 'Cannot request from yourself' };
  const clean = rows.filter((r) => r.qty > 0);
  if (!clean.length) return { ok: false, message: 'Nothing requested (all quantities blank)' };
  if (neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(neededBy)) return { ok: false, message: 'Bad needed-by date' };

  const { data: locs } = await db.from('locations').select('id, code, type');
  const locBy = new Map((locs ?? []).map((l) => [l.code, l]));
  const me = locBy.get(deptCode);
  const maker = locBy.get(askDeptCode);
  if (!me || !maker || maker.type !== 'kitchen_department') {
    return { ok: false, message: `Unknown department ${askDeptCode}` };
  }
  const { data: skus } = await db.from('skus').select('id, code, uom, made_by_location_id');
  const skuBy = new Map((skus ?? []).map((s) => [s.code, s]));

  const inserts: any[] = [];
  for (const r of clean) {
    const s = skuBy.get(r.skuCode);
    if (!s) return { ok: false, message: `Unknown item ${r.skuCode}` };
    if (s.made_by_location_id !== maker.id) {
      return { ok: false, message: `${r.skuCode} is not made by ${askDeptCode}` };
    }
    inserts.push({
      requested_by_location_id: me.id, requested_from_location_id: maker.id,
      sku_id: s.id, qty: r.qty, uom: s.uom,
      needed_by: neededBy, note: note || null, entered_by: enteredBy,
    });
  }
  const { error } = await db.from('dept_requests').insert(inserts);
  if (error) return { ok: false, message: error.message };
  await db.from('spine_events').insert({
    entity: 'dept_requests', action: 'requests_raised', actor: enteredBy,
    data: { from: deptCode, to: askDeptCode, count: inserts.length, needed_by: neededBy },
  });
  revalidatePath(`/dept/${deptCode}`);
  revalidatePath(`/dept/${askDeptCode}`);
  return { ok: true, message: `Requested ${inserts.length} item${inserts.length === 1 ? '' : 's'} from ${askDeptCode}. They will see it on their screen.` };
}

/** Cancel (requester withdraws) or decline (maker refuses). Reason required;
 *  the row stays forever with the reason on it. */
export async function cancelRequest(
  deptCode: string, requestId: number, reason: string, enteredBy: string,
) {
  const guard = await guardDept(deptCode);
  if (guard) return { ok: false, message: guard };
  const db = spine();
  if (!reason.trim()) return { ok: false, message: 'A reason is required' };
  const { data: req } = await db.from('dept_requests')
    .select('id, status, requested_by_location_id, requested_from_location_id')
    .eq('id', requestId).single();
  if (!req) return { ok: false, message: 'Request not found' };
  if (req.status === 'cancelled') return { ok: false, message: 'Already cancelled' };
  const { data: me } = await db.from('locations').select('id').eq('code', deptCode).single();
  if (!me || (me.id !== req.requested_by_location_id && me.id !== req.requested_from_location_id)) {
    return { ok: false, message: 'This request does not involve your department' };
  }
  const role = me.id === req.requested_by_location_id ? 'withdrawn by requester' : 'declined by maker';
  const { error } = await db.from('dept_requests').update({
    status: 'cancelled', cancel_reason: `${role}: ${reason.trim()}`,
    cancelled_by: enteredBy, cancelled_at: new Date().toISOString(),
  }).eq('id', requestId);
  if (error) return { ok: false, message: error.message };
  await db.from('spine_events').insert({
    entity: 'dept_requests', entity_ref: String(requestId), action: 'request_cancelled',
    actor: enteredBy, data: { dept: deptCode, role, reason: reason.trim() },
  });
  revalidatePath(`/dept/${deptCode}`);
  return { ok: true, message: 'Request closed with the reason recorded' };
}

export type PlanSaveRow = { skuCode: string; planned: number };

/** Save the production plan for one department and day. The chef's number is
 *  FINAL and may differ from the suggestion (Pranjay, 20 Aug 2026); the
 *  suggestion and all its inputs are recomputed server-side and snapshotted on
 *  the row so every number stays reproducible. Re-planning appends; the latest
 *  row per item wins (nothing edited or deleted). */
export async function savePlan(
  deptCode: string, planDate: string, rows: PlanSaveRow[], enteredBy: string,
) {
  const guard = await guardDept(deptCode);
  if (guard) return { ok: false, message: guard };
  const today = istCalendarDate(new Date());
  const tomorrow = ymdAddDays(today, 1);
  if (planDate !== today && planDate !== tomorrow) {
    return { ok: false, message: `Plans are for today or tomorrow, not ${planDate}` };
  }
  const clean = rows.filter((r) => Number.isFinite(r.planned) && r.planned >= 0);
  if (!clean.length) return { ok: false, message: 'Nothing planned yet. Fill at least one item.' };

  // one source of truth: recompute inputs and suggestion server-side
  const { getPlanData } = await import('./plan-data');
  const data = await getPlanData(deptCode, planDate);
  if (!data) return { ok: false, message: `Unknown department ${deptCode}` };
  const byCode = new Map(data.rows.map((r) => [r.skuCode, r]));

  const db = spine();
  const { data: dept } = await db.from('locations').select('id').eq('code', deptCode).single();
  const { data: skus } = await db.from('skus').select('id, code');
  const skuIdByCode = new Map((skus ?? []).map((s) => [s.code, s.id]));

  const inserts: any[] = [];
  for (const r of clean) {
    const p = byCode.get(r.skuCode);
    const skuId = skuIdByCode.get(r.skuCode);
    if (!p || !skuId) return { ok: false, message: `${r.skuCode} is not plannable for this department` };
    inserts.push({
      location_id: dept!.id, business_date: planDate, sku_id: skuId,
      par_qty: p.parQty, par_type: p.parType, on_hand_qty: p.onHand,
      requested_qty: p.requestedQty, suggested_qty: p.suggested,
      planned_qty: r.planned, uom: p.uom, entered_by: enteredBy,
    });
  }
  const { error } = await db.from('production_plans').insert(inserts);
  if (error) return { ok: false, message: error.message };
  await db.from('spine_events').insert({
    entity: 'production_plans', action: 'plan_saved', actor: enteredBy,
    data: { dept: deptCode, business_date: planDate, rows: inserts.length },
  });
  revalidatePath(`/dept/${deptCode}`);
  const dayLabel = `${planDate} (${weekdayForYmd(planDate)})`;
  return { ok: true, message: `Plan saved: ${inserts.length} item${inserts.length === 1 ? '' : 's'} for ${dayLabel}` };
}
