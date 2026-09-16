// CSV downloads for the recipe module (every table downloads, two-audience rule).
// ?what=ingredients | semi | finished | foodcost | template
// "template" is the bulk-upload file: the live book in exactly the shape the upload reads.
import { NextResponse } from 'next/server';
import { requireUser, recipePerms } from '@/lib/session';
import { listIngredients, listRecipes, foodCostList, csvEscape } from '@/lib/recipes';
import { q } from '@/lib/db';
import { fromBase } from '@/lib/recipes-engine';

export const dynamic = 'force-dynamic';

const U: Record<string, string> = { gram: 'g', millilitre: 'ml', piece: 'pc', set: 'set' };

export async function GET(req: Request) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) return new NextResponse('Not allowed for this role.', { status: 403 });
  const what = new URL(req.url).searchParams.get('what') ?? '';
  let header: string[] = []; let rows: unknown[][] = []; let name = 'recipes';
  if (what === 'ingredients') {
    const r = await listIngredients();
    header = ['code', 'name', 'supplynote_name', 'bought_as', 'purchase_price', 'pack_base_units', 'base_unit', 'rate_per_kg_L_or_pc', 'rate_source', 'rate_as_of', 'used_in'];
    rows = r.map(i => [i.code, i.name, i.sn_name, i.purchase_unit ?? i.uom, i.purchase_price, i.pack_base_units, i.base_unit, i.rate_per_base != null ? fromBase(i.rate_per_base, i.base_unit).toFixed(4) : '', i.rate_source, i.rate_as_of, i.used_in]);
    name = 'cc_ingredient_price_list';
  } else if (what === 'semi' || what === 'finished') {
    const r = await listRecipes(what === 'semi' ? 'intermediate' : 'finished');
    header = ['code', 'name', 'status', 'lines', 'batch_makes', 'unit', 'batch_cost', 'unit_cost', 'selling_price', 'packaging_charge', 'food_cost_with_packaging_pct', 'used_in'];
    rows = r.map(x => [x.code, x.name, x.status, x.line_count, x.output_qty, x.output_unit, x.batch_cost?.toFixed(2), x.unit_cost?.toFixed(4), x.selling_price, x.packaging_charge, x.food_cost_with_packaging_pct != null ? (x.food_cost_with_packaging_pct * 100).toFixed(1) : '', x.used_in]);
    name = what === 'semi' ? 'cc_semi_finished_recipes' : 'cc_finished_goods';
  } else if (what === 'foodcost') {
    if (!perms.money) return new NextResponse('Not allowed for this role.', { status: 403 });
    const r = await foodCostList();
    header = ['code', 'name', 'status', 'material_per_unit', 'material_with_allowance', 'packaging_per_unit', 'selling_price', 'packaging_charge', 'food_cost_pct', 'food_cost_with_packaging_pct', 'target_pct', 'lines_without_rate'];
    rows = r.map(x => [x.code, x.name, x.status, x.material_per_unit?.toFixed(2), x.material_with_allowance?.toFixed(2), x.packaging_per_unit?.toFixed(2), x.selling_price, x.packaging_charge, x.food_cost_pct != null ? (x.food_cost_pct * 100).toFixed(1) : '', x.food_cost_with_packaging_pct != null ? (x.food_cost_with_packaging_pct * 100).toFixed(1) : '', (x.target_pct * 100).toFixed(1), x.missing_rates]);
    name = 'cc_food_cost_list';
  } else if (what === 'template') {
    const r = await q<{ recipe: string; kind: string; book: string | null; line: string; ref: string; qty: string; unit: string; makes_qty: string; makes_unit: string; sold_weight_g: string | null }>(`
      select r.name as recipe, case when r.kind = 'finished' then 'finished' else 'semi-finished' end as kind, r.book,
             case when l.role = 'packaging' then 'packaging' when l.sub_recipe_id is not null then 'recipe' else 'ingredient' end as line,
             coalesce(s.code, sr.name) as ref, l.qty, l.unit, v.output_qty as makes_qty, v.output_unit as makes_unit, v.sold_weight_g
      from recipes.recipe r
      join recipes.recipe_version v on v.recipe_id = r.id and v.state = 'approved'
      join recipes.recipe_line l on l.version_id = v.id
      left join public.skus s on s.id = l.ingredient_sku_id
      left join recipes.recipe sr on sr.id = l.sub_recipe_id
      where r.retired_at is null
      order by r.kind, r.name, l.role, l.line_no`);
    header = ['recipe', 'kind', 'line', 'ref', 'qty', 'unit', 'makes_qty', 'makes_unit', 'sold_weight_g', 'book'];
    rows = r.map(x => [x.recipe, x.kind, x.line, x.ref, x.qty, U[x.unit] ?? x.unit, x.makes_qty, U[x.makes_unit] ?? x.makes_unit, x.sold_weight_g ?? '', x.book ?? '']);
    name = 'cc_recipe_book_template';
  } else return new NextResponse('Unknown download.', { status: 400 });
  const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n') + '\n';
  return new NextResponse(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}_${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'private, no-store' } });
}
