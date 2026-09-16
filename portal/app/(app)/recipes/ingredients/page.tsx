import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { listIngredients } from '@/lib/recipes';
import { rateLabel, unitShort } from '@/lib/recipes-engine';
import { Crumbs, Flash, Toolbar, Legend } from '../ui';

export const dynamic = 'force-dynamic';

export default async function IngredientsPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string; show?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const sp = await searchParams; const qq = (sp.q ?? '').trim(); const show = sp.show ?? '';
  const all = await listIngredients(qq);
  let rows = all;
  if (show === 'inuse') rows = all.filter(r => r.used_in > 0);
  if (show === 'missing') rows = all.filter(r => r.used_in > 0 && r.rate_per_base == null);
  if (show === 'unused') rows = all.filter(r => r.used_in === 0);
  if (show === 'nosn') rows = all.filter(r => !r.sn_code);
  const href = (s: string) => '/recipes/ingredients?' + [s ? 'show=' + s : '', qq ? 'q=' + encodeURIComponent(qq) : ''].filter(Boolean).join('&');
  const chips = [
    { label: 'All', href: href(''), on: !show, count: all.length },
    { label: 'In use', href: href('inuse'), on: show === 'inuse', count: all.filter(r => r.used_in > 0).length },
    { label: 'In use, no rate', href: href('missing'), on: show === 'missing', count: all.filter(r => r.used_in > 0 && r.rate_per_base == null).length },
    { label: 'Not in SupplyNote', href: href('nosn'), on: show === 'nosn', count: all.filter(r => !r.sn_code).length },
    { label: 'Unused', href: href('unused'), on: show === 'unused', count: all.filter(r => r.used_in === 0).length },
  ];
  const src = (s: string | null) => s === 'supplynote_last_purchase' ? 'SupplyNote' : s === 'manual_verified' ? 'verified by hand' : s === 'workbook_baseline' ? 'workbook' : 'none';
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Ingredients & prices']} />
      <div className="spread">
        <h1 className="page">Ingredients and prices</h1>
        <div className="row">
          {perms.check ? <Link className="btn btn-primary" href="/recipes/ingredients/supplynote">Fetch SupplyNote prices</Link> : null}
          <Link className="btn btn-secondary" href="/recipes/download?what=ingredients">Download CSV</Link>
        </div>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <Toolbar action="/recipes/ingredients" q={qq} placeholder="Find by name or SupplyNote code" chips={chips} hidden={show ? { show } : {}} count={`${rows.length} shown`} />
      <div className="rtable">
        <table className="sheet">
          <thead><tr><th>Ingredient</th><th>Bought as</th><th className="num">Purchase price</th><th className="num">One pack is</th><th className="num">Rate in recipes</th><th>Rate source</th><th className="num">Used in</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td className="name"><Link href={'/recipes/ingredients/' + r.id}>{r.name}</Link>
                <span className="sub">{r.code}{r.sn_name && r.sn_name !== r.name ? ` · SupplyNote: ${r.sn_name}` : ''}{!r.sn_code ? ' · not in SupplyNote' : ''}</span></td>
              <td>{r.purchase_unit ?? r.uom}</td>
              <td className="num">{r.purchase_price != null ? '₹' + r.purchase_price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''}</td>
              <td className="num">{r.pack_base_units != null ? `${r.pack_base_units.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${unitShort(r.base_unit)}` : <span className="muted">?</span>}</td>
              <td className="num"><b>{r.rate_per_base != null ? rateLabel(r.rate_per_base, r.base_unit) : <span className="pill pill-danger">no rate</span>}</b></td>
              <td className="small muted">{src(r.rate_source)}{r.rate_as_of ? `, ${r.rate_as_of}` : ''}</td>
              <td className="num">{r.used_in ? `${r.used_in} recipe${r.used_in === 1 ? '' : 's'}` : <span className="muted">none</span>}</td>
            </tr>))}
            {rows.length === 0 ? <tr><td colSpan={7} className="muted">Nothing matches.</td></tr> : null}</tbody>
        </table>
      </div>
      <Legend items={[
        ['Bought as', 'the unit SupplyNote buys it in: a kg, a 0.5 kg pack, a tray of eggs, a tin.'],
        ['One pack is', 'how many grams, millilitres or pieces one purchase unit holds, after any usable-yield adjustment.'],
        ['Rate in recipes', 'purchase price ÷ pack, shown per kg, litre or piece; every recipe line uses this figure.'],
        ['Rate source', 'workbook = the 17 Aug 2026 sheet, unverified; SupplyNote = last purchase; verified by hand = typed by controls with a reason.'],
      ]} />
    </>
  );
}
