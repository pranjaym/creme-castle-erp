import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { listIngredients } from '@/lib/recipes';
import { rateLabel, unitShort } from '@/lib/recipes-engine';
import { Crumbs, Flash, SearchForm } from '../ui';

// The price list. Purchase price is what SupplyNote paid per purchase unit; the pack
// size turns it into a rate per kilo, litre or piece, which is the rate every recipe
// line uses. Rates are never typed on a line (plan, rule 1).
export const dynamic = 'force-dynamic';

export default async function IngredientsPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string; missing?: string; unused?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const sp = await searchParams; const qq = (sp.q ?? '').trim();
  let rows = await listIngredients(qq);
  if (sp.missing === '1') rows = rows.filter(r => r.used_in > 0 && r.rate_per_base == null);
  if (sp.unused === '1') rows = rows.filter(r => r.used_in === 0);
  const inUse = rows.filter(r => r.used_in > 0).length;
  const src = (s: string | null) => s === 'supplynote_last_purchase' ? 'SupplyNote' : s === 'manual_verified' ? 'manual, verified' : s === 'workbook_baseline' ? 'workbook baseline' : 'none';

  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Ingredients & prices']} />
      <h1 className="page">Ingredients and prices</h1>
      <p className="hint">
        Every purchased ingredient, keyed to SupplyNote by its code. The rate a recipe line uses is the price per gram,
        millilitre or piece, derived from the purchase price and the pack size. A rate carries its source and date;
        the workbook baseline is unverified until controls confirms it or SupplyNote&rsquo;s last purchase replaces it.
      </p>
      <Flash ok={sp.ok} err={sp.err} />
      <SearchForm action="/recipes/ingredients" q={qq} placeholder="Find by name or SupplyNote code" extra={
        <>
          <Link className="linkbtn" href="/recipes/ingredients?missing=1">In use, no rate</Link>
          <Link className="linkbtn" href="/recipes/ingredients?unused=1">Not used by any recipe</Link>
          {perms.check ? <Link className="btn btn-primary" href="/recipes/ingredients/supplynote">Fetch SupplyNote prices</Link> : null}
          <Link className="btn btn-secondary" href="/recipes/download?what=ingredients">CSV</Link>
        </>
      } />
      <p className="note">{rows.length} ingredients{qq ? ` matching "${qq}"` : ''}, {inUse} in use by a recipe.</p>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr>
            <th>Code</th><th>Ingredient</th><th>Bought as</th><th className="num">Purchase price</th><th className="num">One pack is</th><th className="num">Rate in recipes</th><th>Source</th><th className="num">Used in</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="muted small num">{r.code}</td>
                <td><Link href={'/recipes/ingredients/' + r.id}>{r.name}</Link>{r.sn_name && r.sn_name !== r.name ? <div className="muted small">SupplyNote: {r.sn_name}</div> : null}{!r.sn_code ? <div className="muted small">not in SupplyNote</div> : null}</td>
                <td>{r.purchase_unit ?? r.uom}</td>
                <td className="num">{r.purchase_price != null ? '₹' + r.purchase_price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''}</td>
                <td className="num">{r.pack_base_units != null ? `${r.pack_base_units.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${unitShort(r.base_unit)}` : <span className="muted">?</span>}</td>
                <td className="num">{r.rate_per_base != null ? rateLabel(r.rate_per_base, r.base_unit) : <span className="pill pill-danger">no rate</span>}</td>
                <td className="small muted">{src(r.rate_source)}{r.rate_as_of ? `, ${r.rate_as_of}` : ''}</td>
                <td className="num">{r.used_in ? <Link href={'/recipes/ingredients/' + r.id}>{r.used_in}</Link> : <span className="pill pill-neutral">unused</span>}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={8} className="muted">Nothing matches.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
