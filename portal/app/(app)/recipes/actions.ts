'use server';

// Every write in the recipe module. Each action re-checks the caller (a server
// action is directly callable), then calls ONE database function from migration
// 229, which does the work and writes the audit row. The portal never writes a
// recipe table directly; that keeps the rules in the database where the next
// app inherits them (canonical rule 1).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser, recipePerms, type SessionUser } from '@/lib/session';
import { q, one, tx } from '@/lib/db';
import { toBase } from '@/lib/recipes-engine';
import { parseRecipeCsv, type UploadResult } from '@/lib/recipes-upload';
import { pickLists } from '@/lib/recipes';

type Perm = 'view' | 'draft' | 'check' | 'approve';
async function need(perm: Perm): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || !recipePerms(u.role)[perm]) redirect('/');
  return u;
}
const who = (u: SessionUser) => u.fullName ? `${u.fullName} <${u.email}>` : u.email;
function bounce(to: string, msg: string, kind: 'ok' | 'err' = 'ok'): never {
  redirect(`${to}${to.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg)}`);
}
const str = (v: FormDataEntryValue | null): string | null => { const s = typeof v === 'string' ? v.trim() : ''; return s === '' ? null : s; };
const numv = (v: FormDataEntryValue | null): number | null => { const s = str(v); if (s == null) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const plain = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^error: /i, '').split('\n')[0];
};
function refresh() { revalidatePath('/recipes', 'layout'); }

export async function saveSettings(form: FormData) {
  const u = await need('approve');
  const target = numv(form.get('target')); const allowance = numv(form.get('allowance'));
  if (target == null || allowance == null) bounce('/recipes', 'Both settings need a number.', 'err');
  try {
    await q('select recipes.set_setting($1, $2, $3)', ['target_food_cost_pct', target, who(u)]);
    await q('select recipes.set_setting($1, $2, $3)', ['wastage_allowance_pct', allowance, who(u)]);
  } catch (e) { bounce('/recipes', plain(e), 'err'); }
  refresh(); bounce('/recipes', `Saved: target ${target}%, allowance ${allowance}%.`);
}

export async function setRate(form: FormData) {
  const u = await need('check');
  const skuId = numv(form.get('sku_id')); const back = str(form.get('back')) ?? '/recipes/ingredients';
  const display = numv(form.get('rate_display')); const baseUnit = str(form.get('base_unit')) ?? 'gram';
  const asOf = str(form.get('as_of')) ?? new Date().toISOString().slice(0, 10);
  const note = str(form.get('note'));
  if (skuId == null || display == null || display < 0) bounce(back, 'Type the rate as a number.', 'err');
  try {
    await q('select recipes.set_rate($1, $2, $3, $4, $5, $6)', [skuId, toBase(display, baseUnit), 'manual_verified', asOf, who(u), note]);
  } catch (e) { bounce(back, plain(e), 'err'); }
  refresh(); bounce(back, `Rate saved (manual, verified by you, as of ${asOf}).`);
}

export async function setPrice(form: FormData) {
  const u = await need('check');
  const recipeId = numv(form.get('recipe_id')); const back = str(form.get('back')) ?? '/recipes';
  const sp = numv(form.get('selling_price')); const pc = numv(form.get('packaging_charge'));
  const from = str(form.get('effective_from')) ?? new Date().toISOString().slice(0, 10);
  if (recipeId == null) bounce(back, 'No recipe was posted.', 'err');
  try { await q('select recipes.set_price($1, $2, $3, $4, $5, $6, $7)', [recipeId, 'aggregator', sp, pc, from, who(u), str(form.get('note'))]); }
  catch (e) { bounce(back, plain(e), 'err'); }
  refresh(); bounce(back, `Price saved: ${sp ?? 'none'} + packaging charge ${pc ?? 0}, from ${from}.`);
}

export async function startDraft(form: FormData) {
  const u = await need('draft');
  const recipeId = numv(form.get('recipe_id')); const code = str(form.get('code')) ?? '';
  const back = '/recipes/r/' + encodeURIComponent(code);
  if (recipeId == null) bounce('/recipes', 'No recipe was posted.', 'err');
  let vid: number | null = null;
  try {
    const r = await one<{ v: number }>('select recipes.new_draft($1, $2, $3) as v', [recipeId, who(u), str(form.get('note'))]);
    vid = r?.v ?? null;
  } catch (e) { bounce(back, plain(e), 'err'); }
  refresh(); redirect(`${back}/v/${vid}`);
}

export async function createRecipe(form: FormData) {
  const u = await need('draft');
  const name = str(form.get('name')); const kind = str(form.get('kind')) === 'finished' ? 'finished' : 'intermediate';
  const book = str(form.get('book')); const outQty = numv(form.get('output_qty')); const outUnit = str(form.get('output_unit')) ?? 'gram';
  if (!name) bounce('/recipes/new', 'Give the recipe a name.', 'err');
  if (outQty == null || outQty <= 0) bounce('/recipes/new', 'Say what one batch makes (a quantity above zero).', 'err');
  let vid: number | null = null; let code = '';
  try {
    const r = await one<{ v: number }>('select recipes.new_recipe($1, $2, $3, $4, $5, $6, $7) as v', [name, kind, book, outQty, outUnit, who(u), str(form.get('note'))]);
    vid = r?.v ?? null;
    const c = await one<{ code: string }>('select r.code from recipes.recipe_version v join recipes.recipe r on r.id = v.recipe_id where v.id = $1', [vid]);
    code = c?.code ?? '';
  } catch (e) { bounce('/recipes/new', plain(e), 'err'); }
  refresh(); redirect(`/recipes/r/${encodeURIComponent(code)}/v/${vid}?ok=${encodeURIComponent('Recipe created. Add the lines, then send it for checking.')}`);
}

export async function saveDraft(form: FormData) {
  const u = await need('draft');
  const vid = numv(form.get('version_id')); const back = str(form.get('back')) ?? '/recipes';
  const outQty = numv(form.get('output_qty')); const outUnit = str(form.get('output_unit')) ?? 'gram';
  const sold = numv(form.get('sold_weight_g'));
  let lines: unknown = [];
  try { lines = JSON.parse(str(form.get('lines')) ?? '[]'); } catch { bounce(back, 'The lines could not be read; reload and try again.', 'err'); }
  if (vid == null) bounce(back, 'No version was posted.', 'err');
  if (outQty == null || outQty <= 0) bounce(back, 'Say what this batch makes (a quantity above zero).', 'err');
  try { await q('select recipes.set_lines($1, $2, $3::jsonb, $4, $5, $6)', [vid, who(u), JSON.stringify(lines), outQty, outUnit, sold]); }
  catch (e) { bounce(back, plain(e), 'err'); }
  refresh();
  if (str(form.get('then')) === 'submit') {
    try { await q('select recipes.submit_for_check($1, $2, $3)', [vid, who(u), str(form.get('note'))]); }
    catch (e) { bounce(back, 'Saved, but could not send for checking: ' + plain(e), 'err'); }
    bounce(back, 'Saved and sent for checking.');
  }
  bounce(back, 'Draft saved. It changes no cost until it is approved.');
}

async function step(fn: string, perm: Perm, form: FormData, okMsg: string) {
  const u = await need(perm);
  const vid = numv(form.get('version_id')); const back = str(form.get('back')) ?? '/recipes/approvals';
  const note = str(form.get('note'));
  if (vid == null) bounce(back, 'No version was posted.', 'err');
  try {
    if (fn === 'approve_version') await q('select recipes.approve_version($1, $2, $3, $4)', [vid, who(u), str(form.get('effective_from')), note]);
    else if (fn === 'send_back' || fn === 'reject_version') {
      if (!note) bounce(back, 'Say why, in a sentence, so the chef knows what to change.', 'err');
      await q(`select recipes.${fn}($1, $2, $3)`, [vid, who(u), note]);
    } else await q(`select recipes.${fn}($1, $2, $3)`, [vid, who(u), note]);
  } catch (e) { bounce(back, plain(e), 'err'); }
  refresh(); bounce(back, okMsg);
}
export async function submitForCheck(form: FormData) { return step('submit_for_check', 'draft', form, 'Sent for checking.'); }
export async function markChecked(form: FormData) { return step('mark_checked', 'check', form, 'Marked as checked. It now waits for approval.'); }
export async function sendBack(form: FormData) { return step('send_back', 'check', form, 'Sent back to the chef as a draft.'); }
export async function rejectVersion(form: FormData) { return step('reject_version', 'check', form, 'Rejected. The live version is unchanged.'); }
export async function approveVersion(form: FormData) { return step('approve_version', 'approve', form, 'Approved. This is now the live version; the previous one is kept as history.'); }

export async function retireRecipe(form: FormData) {
  const u = await need('approve');
  const recipeId = numv(form.get('recipe_id')); const code = str(form.get('code')) ?? ''; const reason = str(form.get('reason'));
  const back = '/recipes/r/' + encodeURIComponent(code);
  if (recipeId == null || !reason) bounce(back, 'Give a reason for retiring it.', 'err');
  try { await q('select recipes.retire_recipe($1, $2, $3)', [recipeId, who(u), reason]); } catch (e) { bounce(back, plain(e), 'err'); }
  refresh(); bounce(back, 'Retired. Nothing is deleted; it no longer counts as live.');
}

// Bulk upload: one CSV in the template's shape becomes one DRAFT per recipe that differs
// from its live version (or a new recipe). Nothing goes live here; approval is the same
// path as a change typed on the screen. The result is kept as an event so the page can show it.
export async function uploadRecipes(form: FormData) {
  const u = await need('draft');
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) bounce('/recipes/upload', 'Choose a CSV file first.', 'err');
  if (file.size > 5_000_000) bounce('/recipes/upload', 'That file is over 5 MB; split it.', 'err');
  const text = await file.text();
  const picks = await pickLists();
  const parsed = parseRecipeCsv(text, picks);
  const result: UploadResult = { file: file.name, recipes: [], errors: parsed.errors, created: 0, unchanged: 0, skipped: 0 };
  const asDraft = str(form.get('mode')) !== 'check';
  for (const rec of parsed.recipes) {
    try {
      await tx(async (c) => {
        let recipeId = rec.recipe_id; let vid: number;
        if (recipeId == null) {
          const r = await c.q<{ v: number }>('select recipes.new_recipe($1, $2, $3, $4, $5, $6, $7) as v', [rec.name, rec.kind, rec.book, rec.output_qty, rec.output_unit, who(u), 'bulk upload ' + file.name]);
          vid = r[0].v; result.created += 1;
          const rr = await c.q<{ recipe_id: number }>('select recipe_id from recipes.recipe_version where id = $1', [vid]); recipeId = rr[0].recipe_id;
        } else {
          // skip when identical to the live version
          const live = await c.q<{ id: number; output_qty: string; output_unit: string }>(`select id, output_qty, output_unit from recipes.recipe_version where recipe_id = $1 and state = 'approved'`, [recipeId]);
          if (live.length) {
            const ll = await c.q<{ role: string; ingredient_sku_id: number | null; sub_recipe_id: number | null; qty: string; unit: string }>('select role, ingredient_sku_id, sub_recipe_id, qty, unit from recipes.recipe_line where version_id = $1 order by line_no', [live[0].id]);
            const same = Number(live[0].output_qty) === rec.output_qty && live[0].output_unit === rec.output_unit && ll.length === rec.lines.length &&
              rec.lines.every(l => ll.some(x => x.role === l.role && x.ingredient_sku_id === l.ingredient_sku_id && x.sub_recipe_id === l.sub_recipe_id && Number(x.qty) === l.qty && x.unit === l.unit));
            if (same) { result.unchanged += 1; result.recipes.push({ name: rec.name, outcome: 'unchanged' }); return; }
          }
          const r = await c.q<{ v: number }>('select recipes.new_draft($1, $2, $3) as v', [recipeId, who(u), 'bulk upload ' + file.name]);
          vid = r[0].v;
        }
        await c.q('select recipes.set_lines($1, $2, $3::jsonb, $4, $5, $6)', [vid, who(u), JSON.stringify(rec.lines), rec.output_qty, rec.output_unit, rec.sold_weight_g]);
        await c.q(`update recipes.recipe_version set source = 'bulk upload' where id = $1`, [vid]);
        if (!asDraft) await c.q('select recipes.submit_for_check($1, $2, $3)', [vid, who(u), 'bulk upload ' + file.name]);
        result.recipes.push({ name: rec.name, outcome: rec.recipe_id == null ? 'new recipe, draft created' : (asDraft ? 'draft created' : 'draft created and sent for check'), version_id: vid });
      });
    } catch (e) {
      result.skipped += 1; result.recipes.push({ name: rec.name, outcome: 'skipped: ' + plain(e) });
    }
  }
  const ev = await one<{ id: number }>(`insert into recipes.event (entity, action, actor, data) values ('upload', 'file uploaded', $1, $2) returning id`, [who(u), JSON.stringify(result)]);
  refresh(); redirect('/recipes/upload?result=' + (ev?.id ?? ''));
}

// SupplyNote proposals accepted by a person: one set_rate per ticked row.
export async function applySupplyNoteRates(form: FormData) {
  const u = await need('check');
  const ids = form.getAll('accept').map(v => String(v));
  let n = 0; const errs: string[] = [];
  for (const id of ids) {
    const skuId = Number(id); const rate = numv(form.get('rate_' + id)); const asOf = str(form.get('asof_' + id)); const note = str(form.get('note_' + id));
    if (!Number.isFinite(skuId) || rate == null || !asOf) continue;
    try { await q('select recipes.set_rate($1, $2, $3, $4, $5, $6)', [skuId, rate, 'supplynote_last_purchase', asOf, who(u), note]); n += 1; }
    catch (e) { errs.push(plain(e)); }
  }
  refresh();
  if (errs.length) bounce('/recipes/ingredients/supplynote', `${n} rates saved; ${errs.length} failed: ${errs[0]}`, 'err');
  bounce('/recipes/ingredients', `${n} rate${n === 1 ? '' : 's'} updated from SupplyNote's last purchase price.`);
}
