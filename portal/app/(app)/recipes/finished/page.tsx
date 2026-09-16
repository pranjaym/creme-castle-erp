import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { listRecipes, getSettings } from '@/lib/recipes';
import { inr, pct } from '@/lib/recipes-engine';
import { Crumbs, Flash, SearchForm, Status, Verdict } from '../ui';

export const dynamic = 'force-dynamic';

export default async function FinishedPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string; book?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const sp = await searchParams; const qq = (sp.q ?? '').trim();
  let rows = await listRecipes('finished', qq);
  if (sp.book) rows = rows.filter(r => r.book === sp.book);
  const settings = await getSettings();
  const showMoney = perms.money;
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Finished goods']} />
      <h1 className="page">Finished goods</h1>
      <p className="hint">What is sold on Zomato, Swiggy and the website. The recipe is written for one batch; the batch makes one or many sold units (one 500 g cake, ten slices from a tray). The money view is the <Link href="/recipes/food-cost">food cost list</Link>.</p>
      <Flash ok={sp.ok} err={sp.err} />
      <SearchForm action="/recipes/finished" q={qq} placeholder="Find a finished good" extra={<>
        <Link className="linkbtn" href="/recipes/finished?book=cake">Cakes</Link>
        <Link className="linkbtn" href="/recipes/finished?book=pastry">Pastries and desserts</Link>
        {perms.draft ? <Link className="btn btn-primary" href="/recipes/new?kind=finished">New finished good</Link> : null}
        <Link className="btn btn-secondary" href="/recipes/download?what=finished">CSV</Link>
      </>} />
      <p className="note">{rows.length} items{qq ? ` matching "${qq}"` : ''}{sp.book ? ` in ${sp.book}` : ''}.</p>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr><th>Finished good</th><th>Book</th><th>Status</th><th className="num">Lines</th><th className="num">Batch makes</th><th className="num">Material per unit</th>{showMoney ? <><th className="num">Selling price</th><th className="num">Food cost, with packaging</th><th>Verdict</th></> : null}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.recipe_id}>
              <td><Link href={'/recipes/r/' + encodeURIComponent(r.code)}>{r.name}</Link>{r.pending ? <span className="pill pill-warn" style={{ marginLeft: 6 }}>change in progress</span> : null}{r.missing_rates ? <span className="pill pill-danger" style={{ marginLeft: 6 }}>{r.missing_rates} without a rate</span> : null}</td>
              <td className="muted small">{r.book}</td>
              <td><Status status={r.status} /></td>
              <td className="num">{r.line_count}{r.semi_lines ? <span className="muted small"> ({r.semi_lines} semi)</span> : null}</td>
              <td className="num">{r.output_qty != null ? (r.output_qty === 1 ? '1 unit' : `${r.output_qty.toLocaleString('en-IN')} units`) : ''}</td>
              <td className="num">{inr(r.unit_cost)}</td>
              {showMoney ? <>
                <td className="num">{r.selling_price ? inr(r.selling_price, 0) : <span className="pill pill-warn">missing</span>}</td>
                <td className="num">{pct(r.food_cost_with_packaging_pct)}</td>
                <td><Verdict fc={r.food_cost_with_packaging_pct} target={settings.target / 100} /></td>
              </> : null}
            </tr>))}
            {rows.length === 0 ? <tr><td colSpan={9} className="muted">Nothing matches.</td></tr> : null}</tbody>
        </table>
      </div>
    </>
  );
}
