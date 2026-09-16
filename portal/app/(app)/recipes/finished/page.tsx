import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { listRecipes, getSettings } from '@/lib/recipes';
import { inr, pct } from '@/lib/recipes-engine';
import { Crumbs, Flash, Toolbar, Legend, Status, Verdict, soldAs } from '../ui';

export const dynamic = 'force-dynamic';

export default async function FinishedPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string; book?: string; show?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const sp = await searchParams; const qq = (sp.q ?? '').trim();
  const all = await listRecipes('finished', qq);
  const settings = await getSettings();
  const target = settings.target / 100;
  const book = sp.book ?? ''; const show = sp.show ?? '';
  let rows = book ? all.filter(r => r.book === book) : all;
  if (show === 'above') rows = rows.filter(r => r.food_cost_with_packaging_pct != null && r.food_cost_with_packaging_pct > target);
  if (show === 'pending') rows = rows.filter(r => r.pending);
  if (show === 'upcoming') rows = rows.filter(r => r.status !== 'active');
  const href = (b: string, s: string) => '/recipes/finished?' + [b ? 'book=' + b : '', s ? 'show=' + s : '', qq ? 'q=' + encodeURIComponent(qq) : ''].filter(Boolean).join('&');
  const chips = [
    { label: 'All', href: href('', show), on: !book, count: all.length },
    { label: 'Cakes', href: href('cake', show), on: book === 'cake', count: all.filter(r => r.book === 'cake').length },
    { label: 'Pastries & desserts', href: href('pastry', show), on: book === 'pastry', count: all.filter(r => r.book === 'pastry').length },
  ];
  const chips2 = [
    { label: 'Above target', href: href(book, show === 'above' ? '' : 'above'), on: show === 'above', count: all.filter(r => r.food_cost_with_packaging_pct != null && r.food_cost_with_packaging_pct > target).length },
    { label: 'Change in progress', href: href(book, show === 'pending' ? '' : 'pending'), on: show === 'pending', count: all.filter(r => r.pending).length },
    { label: 'Upcoming', href: href(book, show === 'upcoming' ? '' : 'upcoming'), on: show === 'upcoming', count: all.filter(r => r.status !== 'active').length },
  ];
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Finished goods']} />
      <div className="spread">
        <h1 className="page">Finished goods</h1>
        <div className="row">
          {perms.draft ? <Link className="btn btn-primary" href="/recipes/new?kind=finished">New finished good</Link> : null}
          <Link className="btn btn-secondary" href="/recipes/download?what=finished">Download CSV</Link>
        </div>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <Toolbar action="/recipes/finished" q={qq} placeholder="Find a finished good" chips={chips} hidden={{ ...(book ? { book } : {}), ...(show ? { show } : {}) }} count={`${rows.length} shown`}
        right={perms.money ? <div className="chips">{chips2.map(c => <Link key={c.href} href={c.href} className={'rchip' + (c.on ? ' on' : '')}>{c.label}<span className="n">{c.count}</span></Link>)}</div> : null} />
      <div className="rtable">
        <table className="sheet">
          <thead><tr>
            <th>Item</th><th>Status</th><th className="num">Sold as</th><th className="num">Material cost</th>
            {perms.money ? <><th className="num">Packaging</th><th className="num">Selling price</th><th className="num">Food cost</th><th>Verdict</th></> : null}
          </tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.recipe_id}>
              <td className="name"><Link href={'/recipes/r/' + encodeURIComponent(r.code)}>{r.name}</Link>
                <span className="sub">{r.book === 'cake' ? 'cake' : 'pastry or dessert'}{r.pending ? ' · change in progress' : ''}{r.missing_rates ? ` · ${r.missing_rates} line${r.missing_rates === 1 ? '' : 's'} without a rate` : ''}</span></td>
              <td><Status status={r.status} /></td>
              <td className="num">{soldAs(r.output_qty, r.sold_weight_g)}</td>
              <td className="num">{inr(r.unit_cost)}</td>
              {perms.money ? <>
                <td className="num">{inr(r.packaging_cost)}</td>
                <td className="num">{r.selling_price ? inr(r.selling_price, 0) : <span className="pill pill-warn">missing</span>}</td>
                <td className="num"><b>{pct(r.food_cost_with_packaging_pct)}</b></td>
                <td><Verdict fc={r.food_cost_with_packaging_pct} target={target} /></td>
              </> : null}
            </tr>))}
            {rows.length === 0 ? <tr><td colSpan={8} className="muted">Nothing matches.</td></tr> : null}</tbody>
        </table>
      </div>
      <Legend items={[
        ['Sold as', 'what one batch of the recipe makes: one 500 g cake, or ten slices from one tray.'],
        ['Material cost', 'the ingredients in one sold unit, at today\'s price list, through every semi-finished batch inside it.'],
        ...(perms.money ? [
          ['Packaging', 'box, base, sleeve and bag for one unit.'] as [string, string],
          ['Food cost', `(material + ${settings.allowance}% allowance + packaging) ÷ (selling price + packaging charge). Target ${settings.target}%.`] as [string, string],
        ] : []),
      ]} />
    </>
  );
}
