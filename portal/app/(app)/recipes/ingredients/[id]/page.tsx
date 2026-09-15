import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { getIngredient, engineModel, getSettings } from '@/lib/recipes';
import { makeEngine, reach, rateLabel, fromBase, perLabel, unitShort, inr, pct } from '@/lib/recipes-engine';
import { setRate } from '../../actions';
import { Crumbs, Flash, Kind } from '../../ui';

// One ingredient: its price with source and history, where it is used directly, and
// every finished good its price reaches through any chain, with the cost per sold unit.
export const dynamic = 'force-dynamic';

export default async function IngredientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user.role);
  if (!perms.view) redirect('/');
  const { id } = await params; const sp = await searchParams;
  const data = await getIngredient(Number(id));
  if (!data) notFound();
  const { ing, used, history } = data;
  const [model, settings] = await Promise.all([engineModel(), getSettings()]);
  const engine = makeEngine(model);
  const fgIds = reach(model, { sku: ing.id });
  const share = fgIds.map(rid => {
    const r = model.recipes[rid]; const c = engine.costRecipe(rid);
    // this ingredient's rupees inside one unit, through every chain
    const ex: Record<number, number> = {};
    const walk = (recipe: typeof r, mult: number, depth: number) => { if (depth > 12) return; for (const l of recipe.lines) { if (l.role !== 'material') continue; if (l.ingredient_sku_id != null) ex[l.ingredient_sku_id] = (ex[l.ingredient_sku_id] ?? 0) + l.qty * mult; else if (l.sub_recipe_id != null) { const s = model.recipes[l.sub_recipe_id]; if (s) walk(s, mult * l.qty / s.output_qty, depth + 1); } } };
    walk(r, 1 / r.output_qty, 0);
    const qty = ex[ing.id] ?? 0; const rupees = qty * (ing.rate_per_base ?? 0);
    return { r, unit: c?.unit ?? 0, qty, rupees, sharePct: c && c.unit ? rupees / c.unit : 0 };
  }).sort((a, b) => b.rupees - a.rupees);
  const back = '/recipes/ingredients/' + ing.id;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], ['Ingredients & prices', '/recipes/ingredients'], ing.name]} />
      <div className="spread">
        <h1 className="page">{ing.name}</h1>
        <span className="muted num">{ing.code}{ing.sn_name ? ` · SupplyNote: ${ing.sn_name}` : ' · not in SupplyNote'}</span>
      </div>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="tile">
          <div className="t">Price</div>
          <table className="sheet" style={{ marginTop: 8 }}><tbody>
            <tr><td className="muted">Bought as</td><td>{ing.purchase_unit ?? ing.uom}{ing.purchase_price != null ? ` at ${inr(ing.purchase_price)}` : ''}</td></tr>
            <tr><td className="muted">One pack is</td><td>{ing.pack_base_units != null ? `${ing.pack_base_units.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${unitShort(ing.base_unit)}` : 'not known'}</td></tr>
            <tr><td className="muted">Rate in recipes</td><td><b>{rateLabel(ing.rate_per_base, ing.base_unit)}</b>{ing.rate_as_of ? <span className="muted small"> · {ing.rate_source?.replace(/_/g, ' ')}, {ing.rate_as_of}</span> : null}</td></tr>
            <tr><td className="muted">Type</td><td><Kind kind={ing.sku_type === 'packaging' ? 'packaging' : 'raw'} /></td></tr>
          </tbody></table>
          {perms.check ? (
            <form action={setRate} className="row" style={{ marginTop: 12 }}>
              <input type="hidden" name="sku_id" value={ing.id} /><input type="hidden" name="base_unit" value={ing.base_unit} /><input type="hidden" name="back" value={back} />
              <label className="small">New rate {perLabel(ing.base_unit)}<br /><input name="rate_display" type="number" step="0.0001" defaultValue={ing.rate_per_base != null ? fromBase(ing.rate_per_base, ing.base_unit).toFixed(4) : ''} style={{ width: 120 }} required /></label>
              <label className="small">As of<br /><input name="as_of" type="date" defaultValue={today} /></label>
              <label className="small">Why<br /><input name="note" placeholder="quote, invoice no., reason" style={{ width: 220 }} /></label>
              <button className="btn btn-primary" type="submit">Save verified rate</button>
            </form>
          ) : null}
          <div className="note">Saving a rate never edits the old one: the old row is closed with a date and the new one starts. <Link href="/recipes/ingredients/supplynote">Fetch from SupplyNote</Link> proposes the last purchase price for you to accept.</div>
        </div>
        <div className="tile">
          <div className="t">Used directly in {used.length} recipe{used.length === 1 ? '' : 's'}</div>
          <div className="scroll-x"><table className="sheet" style={{ marginTop: 8 }}>
            <thead><tr><th>Recipe</th><th></th><th className="num">Per batch</th></tr></thead>
            <tbody>{used.map((u, i) => <tr key={i}><td><Link href={'/recipes/r/' + encodeURIComponent(u.used_by_code)}>{u.used_by_name}</Link></td><td><Kind kind={u.used_by_kind} />{u.role === 'packaging' ? <span className="muted small"> packaging</span> : null}</td><td className="num">{u.qty.toLocaleString('en-IN')} {unitShort(u.unit)}</td></tr>)}
              {used.length === 0 ? <tr><td colSpan={3} className="muted">No recipe uses this ingredient.</td></tr> : null}</tbody>
          </table></div>
        </div>
      </div>

      <h2 className="sec-head">Reaches {share.length} finished good{share.length === 1 ? '' : 's'}</h2>
      <p className="hint">Through every semi-finished batch in between: how much of this ingredient one sold unit contains, the rupees that is today, and its share of the unit cost. <Link href={'/recipes/impact?sku=' + ing.id}>Try a new price</Link> to see every cost move.</p>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr><th>Finished good</th><th className="num">Per sold unit</th><th className="num">Rupees</th><th className="num">Share of unit cost</th><th className="num">Unit cost</th></tr></thead>
          <tbody>{share.map(s => (
            <tr key={s.r.id}><td><Link href={'/recipes/r/' + encodeURIComponent(s.r.code)}>{s.r.name}</Link></td>
              <td className="num">{s.qty.toLocaleString('en-IN', { maximumFractionDigits: s.qty < 1 ? 3 : 1 })} {unitShort(ing.base_unit)}</td>
              <td className="num">{inr(s.rupees)}</td><td className="num">{pct(s.sharePct)}</td><td className="num">{inr(s.unit)}</td></tr>))}
            {share.length === 0 ? <tr><td colSpan={5} className="muted">Reaches no finished good.</td></tr> : null}</tbody>
        </table>
      </div>

      <h2 className="sec-head">Rate history</h2>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr><th>As of</th><th className="num">Rate</th><th>Source</th><th>Set by</th><th>Note</th><th>Closed</th></tr></thead>
          <tbody>{history.map((h, i) => (
            <tr key={i}><td>{h.as_of}</td><td className="num">{rateLabel(h.rate_per_base, ing.base_unit)}</td><td>{h.source.replace(/_/g, ' ')}</td><td className="muted small">{h.set_by}</td><td className="muted small">{h.note}</td><td className="muted small">{h.superseded_at ? h.superseded_at.slice(0, 10) : <span className="pill pill-ok">current</span>}</td></tr>))}</tbody>
        </table>
      </div>
      <p className="note">Target food cost {settings.target}%, allowance {settings.allowance}%.</p>
    </>
  );
}
