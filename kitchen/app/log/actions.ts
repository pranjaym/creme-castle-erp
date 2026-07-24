'use server';
// Build 3a logbook writes. Append-only, no edits, no deletes.
// Three verbs: made (into freezer), issued (to a destination), wasted (reason).
// logBatch saves a whole evening's table in one go.
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, ymdAddDays, weekdayForYmd } from '@/lib/business-day';
import { revalidatePath } from 'next/cache';

type Action = 'made' | 'issued' | 'wasted';
const MAKER_CODE = 'CK-SPONGE';
const FREEZER_CODE = 'FREEZER-CK';
const DISPATCH_CODE = 'CDIS';

export type BatchRow = {
  skuCode: string;
  action: Action;
  qty: number;
  destCode?: string | null;   // issued: department or spoke
  reasonCode?: string | null; // wasted
};

export async function logBatch(rows: BatchRow[], enteredBy: string, businessDate: string) {
  const db = spine();
  const clean = rows.filter((r) => r.qty > 0);
  if (!clean.length) return { ok: false, message: 'Nothing to save (all quantities blank)' };

  // Backdating window, re-validated here (never trust the client): the chosen day
  // must be today or yesterday by the plain IST calendar date (the kitchen is 24h,
  // the 04:00 sales rule does not apply). The future is always refused. entered_at
  // below stays the honest wall clock, so a catch-up entry is always distinguishable
  // from a same-day one in the audit (entered_at vs business_date).
  const today = istCalendarDate(new Date());
  const yesterday = ymdAddDays(today, -1);
  if (businessDate !== today && businessDate !== yesterday) {
    return { ok: false, message: `Date ${businessDate} is not allowed. Choose today or yesterday.` };
  }
  const bd = businessDate;
  const backdated = bd !== today;

  // resolve masters once
  const { data: skus } = await db.from('skus').select('id, code, uom');
  const { data: locs } = await db.from('locations').select('id, code, type');
  const skuBy = new Map((skus ?? []).map((s) => [s.code, s]));
  const locBy = new Map((locs ?? []).map((l) => [l.code, l]));
  const fromId = locBy.get(MAKER_CODE)?.id ?? null;
  const freezerId = locBy.get(FREEZER_CODE)?.id ?? null;
  const dispatchId = locBy.get(DISPATCH_CODE)?.id ?? null;

  const inserts: any[] = [];
  for (const r of clean) {
    const s = skuBy.get(r.skuCode);
    if (!s) return { ok: false, message: `Unknown item ${r.skuCode}` };
    let toId: number | null = null;
    let viaId: number | null = null;
    if (r.action === 'made') toId = freezerId;
    else if (r.action === 'issued') {
      const d = r.destCode ? locBy.get(r.destCode) : null;
      if (!d) return { ok: false, message: `Unknown destination ${r.destCode}` };
      toId = d.id;
      if (d.type === 'assembly_spoke') viaId = dispatchId; // cross-dock
    } else if (r.action === 'wasted' && !r.reasonCode) {
      return { ok: false, message: `Reason needed for ${r.skuCode}` };
    }
    inserts.push({
      business_date: bd, sku_id: s.id, action: r.action, qty: r.qty, uom: s.uom,
      from_location_id: fromId, to_location_id: toId, via_location_id: viaId,
      reason_code: r.action === 'wasted' ? r.reasonCode : null, entered_by: enteredBy,
    });
  }

  const { error } = await db.from('production_log').insert(inserts);
  if (error) return { ok: false, message: error.message };
  await db.from('spine_events').insert({
    entity: 'production_log', action: 'batch_insert', actor: enteredBy,
    data: { count: inserts.length, verb: clean[0].action, business_date: bd, backdated },
  });
  revalidatePath('/buffer');
  // Name the saved day back to the chef so a catch-up entry is never double-punched onto today.
  const dayLabel = `${bd} (${weekdayForYmd(bd)})`;
  return { ok: true, message: `Saved ${inserts.length} ${clean[0].action} entries for ${dayLabel}`, count: inserts.length };
}
