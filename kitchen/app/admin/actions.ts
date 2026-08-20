'use server';
// Admin backend writes: the item master and department settings, editable by
// Pranjay and the office team without a developer. Masters may be UPDATED
// (they are reference data, not movements); every change is audited in
// spine_events. Par changes are effective-dated INSERTS (history kept).
// Movements (production_log, closing_counts, transfer_receipts) are never
// touched from here.
import { spine } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getKitchenUser } from '@/lib/session';

// Every master edit requires a tech or super_admin session (server-side; the
// hidden sidebar is a courtesy, this is the door).
async function guardMasters(): Promise<string | null> {
  const u = await getKitchenUser();
  if (!u) return 'Not signed in.';
  if (u.role !== 'tech' && u.role !== 'super_admin') return 'Your role cannot change masters.';
  return null;
}

const FREEZER_CODE = 'FREEZER-CK';
const CATEGORY_PREFIX: Record<string, string> = {
  Sponge: 'INT-SPG', Ganache: 'INT-GAN', 'Sub-component': 'INT-SUB',
};

async function audit(db: any, action: string, actor: string, data: any, ref?: string) {
  await db.from('spine_events').insert({ entity: 'admin', entity_ref: ref ?? null, action, actor, data });
}

function refresh() {
  revalidatePath('/admin');
  revalidatePath('/dept/CK-SPONGE');
  revalidatePath('/dept/CK-LIQUID');
  revalidatePath('/log');
  revalidatePath('/buffer');
}

/** Live / not live. Never a delete: an item switched off keeps all its history. */
export async function setSkuActive(skuCode: string, active: boolean, actor: string) {
  const guard = await guardMasters();
  if (guard) return { ok: false, message: guard };
  const db = spine();
  const { error } = await db.from('skus').update({ active }).eq('code', skuCode);
  if (error) return { ok: false, message: error.message };
  await audit(db, active ? 'sku_activated' : 'sku_deactivated', actor, { sku: skuCode }, skuCode);
  refresh();
  return { ok: true, message: `${skuCode} is now ${active ? 'live' : 'off'}` };
}

/** Move an item to the other making department. */
export async function setSkuDepartment(skuCode: string, deptCode: string, actor: string) {
  const guard = await guardMasters();
  if (guard) return { ok: false, message: guard };
  const db = spine();
  const { data: loc } = await db.from('locations').select('id').eq('code', deptCode).single();
  if (!loc) return { ok: false, message: `Unknown department ${deptCode}` };
  const { error } = await db.from('skus').update({ made_by_location_id: loc.id }).eq('code', skuCode);
  if (error) return { ok: false, message: error.message };
  await audit(db, 'sku_department_changed', actor, { sku: skuCode, dept: deptCode }, skuCode);
  refresh();
  return { ok: true, message: `${skuCode} now made by ${deptCode}` };
}

/** Typical daily quantity (sizes the screens; not a target). */
export async function setSkuTypicalQty(skuCode: string, qty: number | null, actor: string) {
  const guard = await guardMasters();
  if (guard) return { ok: false, message: guard };
  const db = spine();
  const { error } = await db.from('skus').update({ typical_qty_per_day: qty }).eq('code', skuCode);
  if (error) return { ok: false, message: error.message };
  await audit(db, 'sku_typical_qty_changed', actor, { sku: skuCode, qty }, skuCode);
  refresh();
  return { ok: true, message: `Typical/day updated for ${skuCode}` };
}

/** Display order on the team screens. */
export async function setSkuSortOrder(skuCode: string, sortOrder: number, actor: string) {
  const guard = await guardMasters();
  if (guard) return { ok: false, message: guard };
  const db = spine();
  const { error } = await db.from('skus').update({ sort_order: sortOrder }).eq('code', skuCode);
  if (error) return { ok: false, message: error.message };
  await audit(db, 'sku_sort_changed', actor, { sku: skuCode, sort_order: sortOrder }, skuCode);
  refresh();
  return { ok: true, message: `Order updated for ${skuCode}` };
}

/** Par change: a NEW effective-dated row in par_stocks; history is never edited. */
export async function setSkuPar(skuCode: string, parQty: number | null, parType: string, actor: string) {
  const guard = await guardMasters();
  if (guard) return { ok: false, message: guard };
  const db = spine();
  if (!['fixed', 'on_demand', 'ready_made'].includes(parType)) return { ok: false, message: 'Bad par type' };
  if (parType === 'fixed' && (parQty == null || Number.isNaN(parQty) || parQty < 0)) {
    return { ok: false, message: 'A fixed par needs a quantity of 0 or more' };
  }
  const [{ data: sku }, { data: loc }] = await Promise.all([
    db.from('skus').select('id').eq('code', skuCode).single(),
    db.from('locations').select('id').eq('code', FREEZER_CODE).single(),
  ]);
  if (!sku || !loc) return { ok: false, message: 'Item or freezer location not found' };
  const { error } = await db.from('par_stocks').insert({
    sku_id: sku.id, location_id: loc.id,
    par_qty: parType === 'fixed' ? parQty : null, par_type: parType, set_by: actor,
  });
  if (error) return { ok: false, message: error.message };
  await audit(db, 'par_changed', actor, { sku: skuCode, par_qty: parQty, par_type: parType }, skuCode);
  refresh();
  return { ok: true, message: `Par updated for ${skuCode} (new dated row; history kept)` };
}

/** New item. The code is generated deterministically: category prefix + next number. */
export async function addSku(input: {
  name: string; category: string; deptCode: string; uom: string;
  typicalQty?: number | null; parQty?: number | null; parType?: string;
}, actor: string) {
  const guard = await guardMasters();
  if (guard) return { ok: false, message: guard };
  const db = spine();
  const name = input.name.trim();
  if (!name) return { ok: false, message: 'Name is required' };
  const prefix = CATEGORY_PREFIX[input.category];
  if (!prefix) return { ok: false, message: `Unknown category ${input.category}` };
  if (!['Pieces', 'Trays', 'Kg', 'Litre'].includes(input.uom)) return { ok: false, message: `Unknown unit ${input.uom}` };

  const { data: dept } = await db.from('locations').select('id').eq('code', input.deptCode).single();
  if (!dept) return { ok: false, message: `Unknown department ${input.deptCode}` };

  const { data: dup } = await db.from('skus').select('code').ilike('name', name).limit(1);
  if (dup && dup.length) return { ok: false, message: `An item named "${name}" already exists (${dup[0].code})` };

  const { data: peers } = await db.from('skus').select('code').like('code', `${prefix}-%`);
  const maxN = Math.max(0, ...(peers ?? []).map((p) => Number(p.code.slice(prefix.length + 1)) || 0));
  const code = `${prefix}-${String(maxN + 1).padStart(3, '0')}`;

  const { data: maxSort } = await db.from('skus').select('sort_order').eq('category', input.category)
    .order('sort_order', { ascending: false }).limit(1);
  const sortOrder = ((maxSort?.[0]?.sort_order as number | undefined) ?? 0) + 1;

  const { data: created, error } = await db.from('skus').insert({
    code, name, sku_type: 'intermediate', category: input.category, uom: input.uom,
    typical_qty_per_day: input.typicalQty ?? null, sort_order: sortOrder,
    made_by_location_id: dept.id, active: true,
  }).select('id').single();
  if (error) return { ok: false, message: error.message };

  const parType = input.parType ?? 'fixed';
  if (input.parQty != null || parType !== 'fixed') {
    const { data: frz } = await db.from('locations').select('id').eq('code', FREEZER_CODE).single();
    if (frz) {
      await db.from('par_stocks').insert({
        sku_id: created!.id, location_id: frz.id,
        par_qty: parType === 'fixed' ? input.parQty : null, par_type: parType, set_by: actor,
      });
    }
  }
  await audit(db, 'sku_added', actor, { code, ...input }, code);
  refresh();
  return { ok: true, message: `Added ${name} as ${code}. It is live on the ${input.deptCode} screen now.` };
}

/** Department day times (day start and count-by). IST, HH:MM. */
export async function setDeptTimes(deptCode: string, dayStart: string, closingBefore: string, actor: string) {
  const guard = await guardMasters();
  if (guard) return { ok: false, message: guard };
  const db = spine();
  const hhmm = /^([01]?\d|2[0-3]):[0-5]\d$/;
  if (!hhmm.test(dayStart) || !hhmm.test(closingBefore)) return { ok: false, message: 'Times must be HH:MM (24h)' };
  const { data: loc } = await db.from('locations').select('id').eq('code', deptCode).single();
  if (!loc) return { ok: false, message: `Unknown department ${deptCode}` };
  const { error } = await db.from('department_settings')
    .update({ day_start_time: dayStart, closing_before: closingBefore, updated_at: new Date().toISOString() })
    .eq('location_id', loc.id);
  if (error) return { ok: false, message: error.message };
  await audit(db, 'dept_times_changed', actor, { dept: deptCode, day_start: dayStart, closing_before: closingBefore }, deptCode);
  refresh();
  return { ok: true, message: `${deptCode}: day starts ${dayStart}, count by ${closingBefore}` };
}

/** The clean slate. Flipping trial to live hides every trial row from every
 *  screen and report in one instant; nothing is deleted (canonical rule 6) and
 *  the switch is reversible. Super admin only, and audited twice: by the SQL
 *  function itself and here. */
export async function setKitchenMode(newMode: 'trial' | 'live', why: string) {
  const u = await getKitchenUser();
  if (!u) return { ok: false, message: 'Not signed in.' };
  if (u.role !== 'super_admin') return { ok: false, message: 'Only a super admin can switch the module mode.' };
  if (newMode !== 'trial' && newMode !== 'live') return { ok: false, message: 'Unknown mode' };
  if (!why.trim()) return { ok: false, message: 'Write one line saying why, it goes on the record.' };

  const db = spine();
  const { error } = await db.rpc('set_kitchen_mode', {
    new_mode: newMode, actor: u.email, why: why.trim(),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath('/', 'layout');
  return {
    ok: true,
    message: newMode === 'live'
      ? 'Now LIVE. Every screen starts empty; the trial entries stay on record but are hidden.'
      : 'Back in TRIAL mode. Trial entries are visible again.',
  };
}
