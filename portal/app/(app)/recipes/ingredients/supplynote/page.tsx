import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { listIngredients } from '@/lib/recipes';
import { lastPurchases, type FulfilmentRow } from '@/lib/supplynote';
import { rateLabel, unitShort } from '@/lib/recipes-engine';
import { applySupplyNoteRates } from '../../actions';
import { Crumbs, Flash } from '../../ui';

// SupplyNote's last purchase price, proposed, never applied silently (rule 4: a
// visible verify step). One row per ingredient bought at the warehouse in the
// window; controls ticks the ones to accept. Prices are pre-tax per SupplyNote
// unit, the same basis as the workbook.
export const dynamic = 'force-dynamic';

export default async function SupplyNotePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; days?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user.role);
  if (!perms.check) redirect('/recipes/ingredients');
  const sp = await searchParams;
  const days = Math.min(Math.max(Number(sp.days ?? 120) || 120, 7), 366);
  const ings = await listIngredients();
  const byCode = new Map(ings.map(i => [(i.sn_code ?? i.code).toUpperCase(), i]));
  let fetched: { rows: FulfilmentRow[]; directions: Record<string, number>; pages: number } | null = null; let error: string | null = null;
  try { fetched = await lastPurchases(days); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const proposals = (fetched?.rows ?? []).map(r => {
    const ing = byCode.get(r.sku_code.toUpperCase());
    const price = r.invoiced_unit_price ?? r.po_unit_price ?? 0;
    const pack = ing?.pack_base_units ?? null;
    const unitMatches = ing ? (ing.purchase_unit ?? ing.uom ?? '').toLowerCase() === (r.unit ?? '').toLowerCase() : false;
    const proposed = ing && pack && unitMatches ? price / pack : (ing && ing.base_unit === 'piece' && (r.unit ?? '').toLowerCase() === 'piece' ? price : null);
    const delta = ing && proposed != null && ing.rate_per_base ? (proposed - ing.rate_per_base) / ing.rate_per_base : null;
    return { r, ing, price, pack, unitMatches, proposed, delta };
  }).filter(p => p.ing).sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
  const unknown = (fetched?.rows ?? []).filter(r => !byCode.has(r.sku_code.toUpperCase())).length;
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], ['Ingredients & prices', '/recipes/ingredients'], 'SupplyNote prices']} />
      <h1 className="page">Last purchase prices from SupplyNote</h1>
      <p className="hint">
        The last vendor purchase received at the central warehouse in the last {days} days, one row per ingredient we use, beside the rate the recipes use today.
        Tick the rows to accept; each becomes a new dated rate with source &ldquo;SupplyNote last purchase&rdquo;. Nothing is applied without a tick.
        Prices are per SupplyNote unit before tax, the basis the workbook used.
      </p>
      <Flash ok={sp.ok} err={sp.err} />
      {error ? <p className="err">SupplyNote could not be read: {error}</p> : null}
      {fetched ? <p className="note">{fetched.rows.length} products with a vendor purchase in the window ({fetched.pages} page{fetched.pages === 1 ? '' : 's'}); {proposals.length} are on our price list, {unknown} are not used by any recipe. Directions seen: {Object.entries(fetched.directions).map(([k, v]) => `${k} ${v}`).join(', ')}. <Link href="/recipes/ingredients/supplynote?days=366">Look back a year</Link></p> : null}
      {proposals.length ? (
        <form action={applySupplyNoteRates}>
          <div className="scroll-x"><table className="sheet">
            <thead><tr><th>Accept</th><th>Ingredient</th><th>Last bought</th><th className="num">Price per {`unit`}</th><th className="num">Rate today</th><th className="num">Proposed rate</th><th className="num">Change</th></tr></thead>
            <tbody>{proposals.map(p => (
              <tr key={p.r.sku_code}>
                <td>{p.proposed != null ? <input type="checkbox" name="accept" value={p.ing!.id} defaultChecked={p.delta != null && Math.abs(p.delta) > 0.0005 && Math.abs(p.delta) <= 0.25} /> : <span className="muted small">pack size unknown</span>}
                  {p.proposed != null ? <><input type="hidden" name={'rate_' + p.ing!.id} value={p.proposed} /><input type="hidden" name={'asof_' + p.ing!.id} value={(p.r.grn_date ?? '').slice(0, 10)} /><input type="hidden" name={'note_' + p.ing!.id} value={`SupplyNote ${p.r.purchase_order_no}, ${p.r.grn_no ?? ''}, ${p.r.seller_name}, ${p.price} per ${p.r.unit}`} /></> : null}</td>
                <td><Link href={'/recipes/ingredients/' + p.ing!.id}>{p.ing!.name}</Link><div className="muted small">{p.r.sku_code} · used in {p.ing!.used_in}</div></td>
                <td className="small">{(p.r.grn_date ?? '').slice(0, 10)}<div className="muted">{p.r.seller_name} · {p.r.purchase_order_no}</div></td>
                <td className="num">₹{p.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })} / {p.r.unit}{!p.unitMatches ? <div className="pill pill-warn">unit differs: we hold {p.ing!.purchase_unit ?? p.ing!.uom}</div> : null}</td>
                <td className="num">{rateLabel(p.ing!.rate_per_base, p.ing!.base_unit)}</td>
                <td className="num">{p.proposed != null ? rateLabel(p.proposed, p.ing!.base_unit) : <span className="muted">need pack size ({p.pack ?? '?'} {unitShort(p.ing!.base_unit)})</span>}</td>
                <td className="num">{p.delta != null ? <span className={p.delta > 0.05 ? 'pill pill-danger' : p.delta < -0.05 ? 'pill pill-ok' : 'pill pill-neutral'}>{(p.delta * 100).toFixed(1)}%</span> : ''}</td>
              </tr>))}</tbody>
          </table></div>
          <p style={{ marginTop: 12 }}><button className="btn btn-primary" type="submit">Accept the ticked rates</button> <span className="muted small">Rows that moved by up to 25% are ticked to start with; a bigger swing usually means a pack size or unit differs, so those wait for a deliberate tick.</span></p>
        </form>) : fetched ? <p className="empty">No ingredient on our list was bought at the warehouse in this window.</p> : null}
      <p className="note">A proposed rate needs the pack size (how many g, ml or pieces in one SupplyNote unit). Where the workbook never derived one, the row says so; set that ingredient&rsquo;s rate by hand on its page.</p>
    </>
  );
}
