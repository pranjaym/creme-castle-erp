import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { foodCostList, getSettings } from '@/lib/recipes';
import { inr, pct } from '@/lib/recipes-engine';
import { Crumbs, Flash, Verdict } from '../ui';

// Every active item, costed today: material rebuilt from raw material prices, the
// allowance added the way the workbook does, packaging as box + base + sleeve + bag,
// food cost against the Zomato/Swiggy price. Worst first. This is the list the P&L
// and the MIS read; month-end snapshots (migration 229) freeze it for history.
export const dynamic = 'force-dynamic';

export default async function FoodCostPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; filter?: string; q?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.money) redirect('/recipes');
  const sp = await searchParams;
  const settings = await getSettings();
  let rows = (await foodCostList()).filter(r => r.status === 'active');
  if (sp.filter === 'noprice') rows = rows.filter(r => !r.selling_price);
  if (sp.filter === 'above') rows = rows.filter(r => r.food_cost_with_packaging_pct != null && r.food_cost_with_packaging_pct > r.target_pct);
  if (sp.q) rows = rows.filter(r => r.name.toLowerCase().includes(sp.q!.toLowerCase()));
  const above = rows.filter(r => r.food_cost_with_packaging_pct != null && r.food_cost_with_packaging_pct > r.target_pct).length;
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Food cost list']} />
      <div className="spread">
        <h1 className="page">Food cost list</h1>
        <Link className="btn btn-secondary" href="/recipes/download?what=foodcost">Download CSV</Link>
      </div>
      <p className="hint">
        Material is rebuilt from the price list through every semi-finished batch. The allowance ({settings.allowance}%) is added before
        comparing with price. Food cost = (material + allowance) ÷ selling price; with packaging, the packaging set is added on top and
        the customer&rsquo;s packaging charge is added to the price. Target {settings.target}% until Pranjay sets out the fuller rule.
      </p>
      <Flash ok={sp.ok} err={sp.err} />
      <form method="get" className="filter-bar">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Find an item" style={{ minWidth: 220, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
        <button className="btn btn-secondary" type="submit">Find</button>
        <Link className="linkbtn" href="/recipes/food-cost">All active</Link>
        <Link className="linkbtn" href="/recipes/food-cost?filter=above">Above target ({above})</Link>
        <Link className="linkbtn" href="/recipes/food-cost?filter=noprice">No selling price</Link>
      </form>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr><th>Item</th><th className="num">Material</th><th className="num">+ allowance</th><th className="num">Packaging</th><th className="num">Selling price</th><th className="num">Pack. charge</th><th className="num">Food cost</th><th className="num">With packaging</th><th>Verdict</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.recipe_id}>
              <td><Link href={'/recipes/r/' + encodeURIComponent(r.code)}>{r.name}</Link>{r.missing_rates ? <span className="pill pill-danger" style={{ marginLeft: 6 }}>{r.missing_rates} without a rate</span> : null}</td>
              <td className="num">{inr(r.material_per_unit)}</td>
              <td className="num">{inr(r.material_with_allowance)}</td>
              <td className="num">{inr(r.packaging_per_unit)}</td>
              <td className="num">{r.selling_price ? inr(r.selling_price, 0) : <span className="pill pill-warn">missing</span>}</td>
              <td className="num">{inr(r.packaging_charge, 0)}</td>
              <td className="num">{pct(r.food_cost_pct)}</td>
              <td className="num"><b>{pct(r.food_cost_with_packaging_pct)}</b></td>
              <td><Verdict fc={r.food_cost_with_packaging_pct} target={r.target_pct} /></td>
            </tr>))}
            {rows.length === 0 ? <tr><td colSpan={9} className="muted">Nothing here.</td></tr> : null}</tbody>
        </table>
      </div>
      <p className="note">{rows.length} active items. Cost of goods for a past month will read the month-end snapshot once the first one exists (they are taken automatically on the 1st).</p>
    </>
  );
}
