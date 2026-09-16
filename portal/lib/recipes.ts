// Reads for the recipe module. Every query goes to the recipes schema through
// lib/db.ts (the pg pool); the arithmetic lives in the database (migrations
// 226/229), this file only asks for it and shapes it for the screens.
import 'server-only';
import { q, one } from '@/lib/db';
import type { EngineModel, EngineLine } from '@/lib/recipes-engine';

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const n0 = (v: unknown): number => Number(v ?? 0);

export type Kind = 'intermediate' | 'finished';

export interface Settings { allowance: number; target: number }
export async function getSettings(): Promise<Settings> {
  const rows = await q<{ key: string; value: string }>('select key, value from recipes.setting');
  const get = (k: string, d: number) => { const r = rows.find(x => x.key === k); return r ? Number(r.value) : d; };
  return { allowance: get('wastage_allowance_pct', 10), target: get('target_food_cost_pct', 30) };
}

export interface IngredientRow {
  id: number; code: string; name: string; sku_type: string; base_unit: string; uom: string; active: boolean; notes: string | null;
  rate_per_base: number | null; rate_source: string | null; rate_as_of: string | null; purchase_unit: string | null;
  purchase_price: number | null; pack_base_units: number | null; used_in: number; sn_code: string | null; sn_name: string | null;
}
const ING_SQL = `
  select s.id, s.code, s.name, s.sku_type::text as sku_type, s.base_unit::text as base_unit, s.uom, s.active, s.notes,
         cr.rate_per_base, cr.source as rate_source, cr.as_of::text as rate_as_of, cr.purchase_unit, cr.purchase_price, cr.pack_base_units,
         coalesce(u.n, 0) as used_in, a.external_code as sn_code, a.external_name as sn_name
  from public.skus s
  left join recipes.current_rate cr on cr.sku_id = s.id
  left join (select ingredient_sku_id, count(distinct used_by_recipe_id) as n from recipes.where_used group by 1) u on u.ingredient_sku_id = s.id
  left join lateral (select external_code, external_name from public.sku_aliases where sku_id = s.id and system = 'supplynote' limit 1) a on true
  where s.sku_type in ('raw_material','packaging')`;
function shapeIng(r: Record<string, unknown>): IngredientRow {
  return { ...(r as unknown as IngredientRow), rate_per_base: num(r.rate_per_base), purchase_price: num(r.purchase_price),
    pack_base_units: num(r.pack_base_units), used_in: n0(r.used_in) };
}
export async function listIngredients(search = ''): Promise<IngredientRow[]> {
  const rows = await q(ING_SQL + (search ? ` and (s.name ilike $1 or s.code ilike $1 or a.external_name ilike $1)` : '') + ` order by used_in desc, s.name`,
    search ? ['%' + search + '%'] : []);
  return rows.map(shapeIng);
}
export async function getIngredient(id: number) {
  const r = await one(ING_SQL + ' and s.id = $1', [id]);
  if (!r) return null;
  const ing = shapeIng(r);
  const used = await q<{ used_by_code: string; used_by_name: string; used_by_kind: string; qty: string; unit: string; role: string }>(
    `select used_by_code, used_by_name, used_by_kind, qty, unit, role from recipes.where_used where ingredient_sku_id = $1 order by used_by_kind, used_by_name`, [id]);
  const history = await q<{ rate_per_base: string; source: string; as_of: string; set_by: string | null; note: string | null; superseded_at: string | null; created_at: string }>(
    `select rate_per_base, source, as_of::text, set_by, note, superseded_at::text, created_at::text from recipes.ingredient_rate where sku_id = $1 order by created_at desc limit 20`, [id]);
  return { ing, used: used.map(u => ({ ...u, qty: Number(u.qty) })), history: history.map(h => ({ ...h, rate_per_base: Number(h.rate_per_base) })) };
}

export interface RecipeListRow {
  recipe_id: number; code: string; name: string; kind: Kind; book: string | null; status: string; version_id: number | null;
  output_qty: number | null; output_unit: string | null; batch_cost: number | null; unit_cost: number | null; packaging_cost: number | null;
  missing_rates: number; line_count: number; semi_lines: number; input_qty: number | null; used_in: number; pending: string | null; sold_weight_g: number | null;
  selling_price: number | null; packaging_charge: number | null; food_cost_pct: number | null; food_cost_with_packaging_pct: number | null;
}
export async function listRecipes(kind: Kind, search = ''): Promise<RecipeListRow[]> {
  const rows = await q(`
    select lc.*,
           (select count(*) from recipes.recipe_line l where l.version_id = lc.version_id and l.role = 'material') as line_count,
           (select count(*) from recipes.recipe_line l where l.version_id = lc.version_id and l.sub_recipe_id is not null) as semi_lines,
           (select sum(l.qty) from recipes.recipe_line l where l.version_id = lc.version_id and l.role = 'material' and l.unit in ('gram','millilitre')) as input_qty,
           (select count(distinct used_by_recipe_id) from recipes.where_used w where w.sub_recipe_id = lc.recipe_id) as used_in,
           (select string_agg(v.state, ',') from recipes.recipe_version v where v.recipe_id = lc.recipe_id and v.state in ('draft','checked')) as pending,
           (select v.sold_weight_g from recipes.recipe_version v where v.id = lc.version_id) as sold_weight_g,
           cp.selling_price, cp.packaging_charge, fc.food_cost_pct, fc.food_cost_with_packaging_pct
    from recipes.live_cost lc
    left join recipes.current_price cp on cp.recipe_id = lc.recipe_id and cp.channel = 'aggregator'
    left join recipes.food_cost_list fc on fc.recipe_id = lc.recipe_id
    where lc.kind = $1 ${search ? 'and lc.name ilike $2' : ''}
    order by lc.name`, search ? [kind, '%' + search + '%'] : [kind]);
  return rows.map(r => ({ ...(r as unknown as RecipeListRow), output_qty: num(r.output_qty), batch_cost: num(r.batch_cost), unit_cost: num(r.unit_cost),
    packaging_cost: num(r.packaging_cost), missing_rates: n0(r.missing_rates), line_count: n0(r.line_count), semi_lines: n0(r.semi_lines),
    input_qty: num(r.input_qty), used_in: n0(r.used_in), sold_weight_g: num(r.sold_weight_g), selling_price: num(r.selling_price), packaging_charge: num(r.packaging_charge),
    food_cost_pct: num(r.food_cost_pct), food_cost_with_packaging_pct: num(r.food_cost_with_packaging_pct) }));
}

export interface FoodCostRow {
  recipe_id: number; code: string; name: string; book: string | null; status: string; material_per_unit: number | null;
  material_with_allowance: number | null; packaging_per_unit: number | null; selling_price: number | null; packaging_charge: number | null;
  food_cost_pct: number | null; food_cost_with_packaging_pct: number | null; target_pct: number; missing_rates: number; version_id: number;
}
export async function foodCostList(): Promise<FoodCostRow[]> {
  const rows = await q('select * from recipes.food_cost_list order by food_cost_with_packaging_pct desc nulls last, name');
  return rows.map(r => ({ ...(r as unknown as FoodCostRow), material_per_unit: num(r.material_per_unit), material_with_allowance: num(r.material_with_allowance),
    packaging_per_unit: num(r.packaging_per_unit), selling_price: num(r.selling_price), packaging_charge: num(r.packaging_charge),
    food_cost_pct: num(r.food_cost_pct), food_cost_with_packaging_pct: num(r.food_cost_with_packaging_pct), target_pct: n0(r.target_pct), missing_rates: n0(r.missing_rates) }));
}

export interface LineRow {
  id: number; line_no: number; role: 'material' | 'packaging'; ingredient_sku_id: number | null; sub_recipe_id: number | null;
  qty: number; unit: string; note: string | null; ref_name: string; ref_code: string; ref_kind: 'raw' | 'packaging' | 'semi' | 'finished';
  rate: number | null; rate_unit: string; amount: number;
}
const LINES_SQL = `
  select l.id, l.line_no, l.role, l.ingredient_sku_id, l.sub_recipe_id, l.qty, l.unit, l.note,
         coalesce(s.name, r.name) as ref_name, coalesce(s.code, r.code) as ref_code,
         case when s.id is not null then (case when s.sku_type = 'packaging' then 'packaging' else 'raw' end) else r.kind::text end as ref_kind,
         case when s.id is not null then cr.rate_per_base else c.unit_cost end as rate,
         case when s.id is not null then s.base_unit::text else c.output_unit end as rate_unit
  from recipes.recipe_line l
  left join public.skus s on s.id = l.ingredient_sku_id
  left join recipes.current_rate cr on cr.sku_id = s.id
  left join recipes.recipe r on r.id = l.sub_recipe_id
  left join lateral (select unit_cost, output_unit from recipes.cost_of_recipe(r.id)) c on r.id is not null
  where l.version_id = $1 order by l.role, l.line_no`;
export async function versionLines(versionId: number): Promise<LineRow[]> {
  const rows = await q(LINES_SQL, [versionId]);
  return rows.map(r => { const qty = n0(r.qty); const rate = num(r.rate); return { ...(r as unknown as LineRow), qty, rate, amount: qty * (rate ?? 0) }; });
}

export interface VersionRow {
  version_id: number; recipe_id: number; code: string; name: string; kind: Kind; version_no: number; state: string; output_qty: number; output_unit: string;
  sold_weight_g: number | null; drafted_by: string | null; drafted_at: string | null; checked_by: string | null; checked_at: string | null;
  approved_by: string | null; approved_at: string | null; effective_from: string | null; superseded_at: string | null; chef_note: string | null;
  checker_note: string | null; rejected_reason: string | null; source: string | null; line_count: number; unit_cost_at_approval: number | null;
}
function shapeVersion(r: Record<string, unknown>): VersionRow {
  return { ...(r as unknown as VersionRow), output_qty: n0(r.output_qty), sold_weight_g: num(r.sold_weight_g), line_count: n0(r.line_count), unit_cost_at_approval: num(r.unit_cost_at_approval) };
}
export async function getVersion(versionId: number): Promise<VersionRow | null> {
  const r = await one(`select vh.*, r.kind from recipes.version_history vh join recipes.recipe r on r.id = vh.recipe_id where vh.version_id = $1`, [versionId]);
  return r ? shapeVersion(r) : null;
}
export interface VersionCost { batch_cost: number; unit_cost: number; packaging_cost: number; missing_rates: number }
export async function costOfVersion(versionId: number): Promise<VersionCost | null> {
  const r = await one('select * from recipes.cost_of_version($1)', [versionId]);
  return r ? { batch_cost: n0(r.batch_cost), unit_cost: n0(r.unit_cost), packaging_cost: n0(r.packaging_cost), missing_rates: n0(r.missing_rates) } : null;
}

export interface RecipeDetail {
  recipe: { id: number; code: string; name: string; kind: Kind; book: string | null; status: string; note: string | null; retired_at: string | null; retired_reason: string | null; sku_id: number | null };
  live: VersionRow | null;
  lines: LineRow[];
  cost: VersionCost | null;
  price: { selling_price: number | null; packaging_charge: number | null; effective_from: string | null } | null;
  explode: { sku_id: number; code: string; name: string; base_unit: string; qty: number; cost: number }[];
  usedIn: { used_by_code: string; used_by_name: string; used_by_kind: string; qty: number; unit: string }[];
  versions: VersionRow[];
  aliases: { system: string; external_name: string }[];
  snapshots: { snapshot_kind: string; as_of: string; unit_cost: number | null; packaging_cost: number | null }[];
  events: { action: string; actor: string | null; at: string; data: Record<string, unknown> | null }[];
}
export async function getRecipe(code: string): Promise<RecipeDetail | null> {
  const recipe = await one<RecipeDetail['recipe']>('select id, code, name, kind, book, status, note, retired_at::text, retired_reason, sku_id from recipes.recipe where code = $1', [code]);
  if (!recipe) return null;
  const versions = (await q(`select vh.*, r.kind from recipes.version_history vh join recipes.recipe r on r.id = vh.recipe_id where vh.recipe_id = $1 order by vh.version_no desc`, [recipe.id])).map(shapeVersion);
  const live = versions.find(v => v.state === 'approved') ?? null;
  const [lines, cost, price, explode, usedIn, aliases, snapshots, events] = await Promise.all([
    live ? versionLines(live.version_id) : Promise.resolve([]),
    live ? costOfVersion(live.version_id) : Promise.resolve(null),
    one(`select selling_price, packaging_charge, effective_from::text from recipes.current_price where recipe_id = $1 and channel = 'aggregator'`, [recipe.id]),
    q(`select e.sku_id, s.code, s.name, s.base_unit::text as base_unit, e.qty, e.cost from recipes.explode($1) e join public.skus s on s.id = e.sku_id order by e.cost desc`, [recipe.id]),
    q(`select used_by_code, used_by_name, used_by_kind, qty, unit from recipes.where_used where sub_recipe_id = $1 order by used_by_kind, used_by_name`, [recipe.id]),
    q(`select system, external_name from recipes.recipe_alias where recipe_id = $1 order by system`, [recipe.id]),
    q(`select s.snapshot_kind, s.as_of::text, s.unit_cost, s.packaging_cost from recipes.cost_snapshot s join recipes.recipe_version v on v.id = s.version_id where v.recipe_id = $1 order by s.as_of desc, s.id desc limit 24`, [recipe.id]),
    q(`select action, actor, at::text, data from recipes.event where (entity = 'recipe' and entity_id = $1) or (entity = 'version' and entity_id in (select id from recipes.recipe_version where recipe_id = $1)) or (entity = 'price' and entity_id = $1) order by at desc limit 40`, [recipe.id]),
  ]);
  return {
    recipe, live, lines, cost,
    price: price ? { selling_price: num(price.selling_price), packaging_charge: num(price.packaging_charge), effective_from: price.effective_from as string | null } : null,
    explode: explode.map(e => ({ ...(e as unknown as RecipeDetail['explode'][number]), qty: n0(e.qty), cost: n0(e.cost) })),
    usedIn: usedIn.map(u => ({ ...(u as unknown as RecipeDetail['usedIn'][number]), qty: n0(u.qty) })),
    versions, aliases: aliases as RecipeDetail['aliases'],
    snapshots: snapshots.map(s => ({ ...(s as unknown as RecipeDetail['snapshots'][number]), unit_cost: num(s.unit_cost), packaging_cost: num(s.packaging_cost) })),
    events: events as RecipeDetail['events'],
  };
}

// Everything the browser engine needs: live recipes with their lines, and the price list.
export async function engineModel(): Promise<EngineModel> {
  const ings = await q<{ id: number; code: string; name: string; base_unit: string; rate: string | null }>(
    `select s.id, s.code, s.name, s.base_unit::text as base_unit, cr.rate_per_base as rate from public.skus s left join recipes.current_rate cr on cr.sku_id = s.id where s.sku_type in ('raw_material','packaging')`);
  const recs = await q<{ id: number; code: string; name: string; kind: Kind; output_qty: string; output_unit: string }>(
    `select r.id, r.code, r.name, r.kind, v.output_qty, v.output_unit from recipes.recipe r join recipes.recipe_version v on v.recipe_id = r.id and v.state = 'approved' where r.retired_at is null`);
  const lines = await q<{ recipe_id: number; role: 'material' | 'packaging'; ingredient_sku_id: number | null; sub_recipe_id: number | null; qty: string; unit: string }>(
    `select v.recipe_id, l.role, l.ingredient_sku_id, l.sub_recipe_id, l.qty, l.unit from recipes.recipe_line l join recipes.recipe_version v on v.id = l.version_id and v.state = 'approved'`);
  const model: EngineModel = { ingredients: {}, recipes: {} };
  for (const i of ings) model.ingredients[i.id] = { id: i.id, code: i.code, name: i.name, base_unit: i.base_unit, rate: i.rate == null ? null : Number(i.rate) };
  for (const r of recs) model.recipes[r.id] = { id: r.id, code: r.code, name: r.name, kind: r.kind, output_qty: Number(r.output_qty), output_unit: r.output_unit, lines: [] };
  for (const l of lines) { const r = model.recipes[l.recipe_id]; if (r) r.lines.push({ role: l.role, ingredient_sku_id: l.ingredient_sku_id, sub_recipe_id: l.sub_recipe_id, qty: Number(l.qty), unit: l.unit } as EngineLine); }
  return model;
}

// Versions waiting on someone, with the live cost beside the proposed cost.
export interface PendingRow extends VersionRow { live_version_id: number | null; live_unit_cost: number | null; new_unit_cost: number | null; new_missing: number }
export async function pendingVersions(): Promise<PendingRow[]> {
  const rows = await q(`
    select vh.*, r.kind,
           lv.id as live_version_id,
           (select c.unit_cost from recipes.cost_of_version(lv.id) c) as live_unit_cost,
           nc.unit_cost as new_unit_cost, nc.missing_rates as new_missing
    from recipes.version_history vh
    join recipes.recipe r on r.id = vh.recipe_id
    left join recipes.recipe_version lv on lv.recipe_id = vh.recipe_id and lv.state = 'approved'
    left join lateral (select unit_cost, missing_rates from recipes.cost_of_version(vh.version_id)) nc on true
    where vh.state in ('draft','checked')
    order by vh.state desc, vh.drafted_at`);
  return rows.map(r => ({ ...shapeVersion(r), live_version_id: (r.live_version_id as number | null), live_unit_cost: num(r.live_unit_cost), new_unit_cost: num(r.new_unit_cost), new_missing: n0(r.new_missing) }));
}

export interface LineDiff { ref_name: string; ref_kind: string; role: string; before: number | null; after: number | null; unit: string }
export function diffLines(before: LineRow[], after: LineRow[]): LineDiff[] {
  const key = (l: LineRow) => l.role + '|' + (l.ingredient_sku_id != null ? 'i' + l.ingredient_sku_id : 'r' + l.sub_recipe_id);
  const map = new Map<string, LineDiff>();
  for (const l of before) map.set(key(l), { ref_name: l.ref_name, ref_kind: l.ref_kind, role: l.role, before: l.qty, after: null, unit: l.unit });
  for (const l of after) { const k = key(l); const d = map.get(k); if (d) d.after = l.qty; else map.set(k, { ref_name: l.ref_name, ref_kind: l.ref_kind, role: l.role, before: null, after: l.qty, unit: l.unit }); }
  return [...map.values()].filter(d => d.before !== d.after);
}

// Pick lists for the editor and the upload.
export async function pickLists() {
  const ingredients = await q<{ id: number; code: string; name: string; base_unit: string; rate: string | null; sku_type: string }>(
    `select s.id, s.code, s.name, s.base_unit::text as base_unit, cr.rate_per_base as rate, s.sku_type::text as sku_type from public.skus s left join recipes.current_rate cr on cr.sku_id = s.id where s.sku_type in ('raw_material','packaging') order by s.name`);
  const recipes = await q<{ id: number; code: string; name: string; kind: Kind; output_unit: string; unit_cost: string | null }>(
    `select r.id, r.code, r.name, r.kind, v.output_unit, c.unit_cost from recipes.recipe r join recipes.recipe_version v on v.recipe_id = r.id and v.state = 'approved' left join lateral (select unit_cost from recipes.cost_of_recipe(r.id)) c on true where r.retired_at is null order by r.name`);
  return {
    ingredients: ingredients.map(i => ({ ...i, rate: i.rate == null ? null : Number(i.rate) })),
    recipes: recipes.map(r => ({ ...r, unit_cost: r.unit_cost == null ? null : Number(r.unit_cost) })),
  };
}

export async function homeCounts() {
  const r = await one(`
    select (select count(*) from recipes.recipe where kind = 'finished' and status = 'active' and retired_at is null) as fg_active,
           (select count(*) from recipes.recipe where kind = 'intermediate' and retired_at is null) as semi,
           (select count(*) from public.skus where sku_type in ('raw_material','packaging')) as ingredients,
           (select count(*) from public.skus s where s.sku_type in ('raw_material','packaging') and s.id in (select ingredient_sku_id from recipes.where_used) and not exists (select 1 from recipes.current_rate cr where cr.sku_id = s.id)) as used_without_rate,
           (select count(*) from recipes.food_cost_list where status = 'active' and food_cost_with_packaging_pct > target_pct) as above_target,
           (select count(*) from recipes.food_cost_list where status = 'active' and coalesce(selling_price, 0) = 0) as no_price,
           (select count(*) from recipes.recipe_version where state = 'draft') as drafts,
           (select count(*) from recipes.recipe_version where state = 'checked' and checked_by is null) as to_check,
           (select count(*) from recipes.recipe_version where state = 'checked' and checked_by is not null) as to_approve,
           (select count(*) from recipes.event where entity = 'rate' and at > now() - interval '7 days') as rate_changes_7d,
           (select max(as_of)::text from recipes.ingredient_rate where superseded_at is null) as newest_rate`);
  const o: Record<string, number | string | null> = {};
  for (const k in r ?? {}) o[k] = k === 'newest_rate' ? (r![k] as string | null) : n0(r![k]);
  return o as { fg_active: number; semi: number; ingredients: number; used_without_rate: number; above_target: number; no_price: number; drafts: number; to_check: number; to_approve: number; rate_changes_7d: number; newest_rate: string | null };
}

export async function recentEvents(limit = 25) {
  return q<{ entity: string; entity_id: number | null; action: string; actor: string | null; at: string; data: Record<string, unknown> | null; name: string | null; code: string | null }>(`
    select e.entity, e.entity_id, e.action, e.actor, e.at::text, e.data,
           coalesce(r.name, r2.name, s.name) as name, coalesce(r.code, r2.code) as code
    from recipes.event e
    left join recipes.recipe r on e.entity = 'recipe' and r.id = e.entity_id
    left join recipes.recipe_version v on e.entity = 'version' and v.id = e.entity_id
    left join recipes.recipe r2 on r2.id = v.recipe_id
    left join public.skus s on e.entity = 'rate' and s.id = e.entity_id
    order by e.at desc limit $1`, [limit]);
}

export const csvEscape = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
