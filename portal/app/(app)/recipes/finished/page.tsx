import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { listRecipes, getSettings } from '@/lib/recipes';
import { inr, pct } from '@/lib/recipes-engine';
import { Crumbs, Flash, Toolbar, Legend, Status, Verdict, soldAs } from '../ui';

// Finished goods, grouped the way the sales side already groups them: by the
// item glossary's category, named by the glossary alias (the name the menu
// uses), with the recipe's own name underneath when it differs.
export const dynamic = 'force-dynamic';

const NO_GLOSSARY = 'Not in the glossary';

export default async function FinishedPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string; cat?: string; show?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const sp = await searchParams; const qq = (sp.q ?? '').trim();
  const all = await listRecipes('finished', qq);
  const settings = await getSettings();
  const target = settings.target / 100;
  const cat = sp.cat ?? ''; const show = sp.show ?? '';
  const catOf = (r: { glossary_category: string | null }) => r.glossary_category ?? NO_GLOSSARY;
  const cats = Array.from(new Set(all.map(catOf))).sort((a, b) => (a === NO_GLOSSARY ? 1 : b === NO_GLOSSARY ? -1 : a.localeCompare(b)));
  let rows = cat ? all.filter(r => catOf(r) === cat) : all;
  if (show === 'above') rows = rows.filter(r => r.food_cost_with_packaging_pct != null && r.food_cost_with_packaging_pct > target);
  if (show === 'pending') rows = rows.filter(r => r.pending);
  if (show === 'upcoming') rows = rows.filter(r => r.status !== 'active');
  rows = [...rows].sort((a, b) => (a.glossary_alias ?? a.name).localeCompare(b.glossary_alias ?? b.name) || a.name.localeCompare(b.name));
  const href = (c: string, s: string) => '/recipes/finished?' + [c ? 'cat=' + encodeURIComponent(c) : '', s ? 'show=' + s : '', qq ? 'q=' + encodeURIComponent(qq) : ''].filter(Boolean).join('&');
  const chips = [{ label: 'All', href: href('', show), on: !cat, count: all.length },
    ...cats.map(c => ({ label: c, href: href(c, show), on: cat === c, count: all.filter(r => catOf(r) === c).length }))];
  const chips2 = [
    { label: 'Above target', href: href(cat, show === 'above' ? '' : 'above'), on: show === 'above', count: all.filter(r => r.food_cost_with_packaging_pct != null && r.food_cost_with_packaging_pct > target).length },
    { label: 'Change in progress', href: href(cat, show === 'pending' ? '' : 'pending'), on: show === 'pending', count: all.filter(r => r.pending).length },
    { label: 'Upcoming', href: href(cat, show === 'upcoming' ? '' : 'upcoming'), on: show === 'upcoming', count: all.filter(r => r.status !== 'active').length },
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
      <Toolbar action="/recipes/finished" q={qq} placeholder="Find a finished good" chips={chips} hidden={{ ...(cat ? { cat } : {}), ...(show ? { show } : {}) }} count={`${rows.length} shown`}
        right={perms.money ? <div className="chips">{chips2.map(c => <Link key={c.href} href={c.href} className={'rchip' + (c.on ? ' on' : '')}>{c.label}<span className="n">{c.count}</span></Link>)}</div> : null} />
      <div className="rtable">
        <table className="sheet">
          <thead><tr>
            <th>Item</th><th>Status</th><th className="num">Sold as</th><th className="num">Material cost</th>
            {perms.money ? <><th className="num">Packaging</th><th className="num">Selling price</th><th className="num">Food cost</th><th>Verdict</th></> : null}
          </tr></thead>
          <tbody>{rows.map(r => {
            const shown = r.glossary_alias ?? r.name;
            const sub = [r.glossary_alias && r.glossary_alias !== r.name ? `recipe: ${r.name}` : null, !r.glossary_alias ? 'not linked to a menu item yet' : null,
              r.pending ? 'change in progress' : null, r.missing_rates ? `${r.missing_rates} line${r.missing_rates === 1 ? '' : 's'} without a rate` : null].filter(Boolean).join(' · ');
            return (
              <tr key={r.recipe_id}>
                <td className="name"><Link href={'/recipes/r/' + encodeURIComponent(r.code)}>{shown}</Link>{sub ? <span className="sub">{sub}</span> : null}</td>
                <td><Status status={r.status} /></td>
                <td className="num">{soldAs(r.output_qty, r.sold_weight_g)}</td>
                <td className="num">{inr(r.unit_cost)}</td>
                {perms.money ? <>
                  <td className="num">{inr(r.packaging_cost)}</td>
                  <td className="num">{r.selling_price ? inr(r.selling_price, 0) : <span className="pill pill-warn">missing</span>}</td>
                  <td className="num"><b>{pct(r.food_cost_with_packaging_pct)}</b></td>
                  <td><Verdict fc={r.food_cost_with_packaging_pct} target={target} /></td>
                </> : null}
              </tr>);
          })}
            {rows.length === 0 ? <tr><td colSpan={8} className="muted">Nothing matches.</td></tr> : null}</tbody>
        </table>
      </div>
      <Legend items={[
        ['Item', 'the name the menu uses (from the item glossary); the recipe\'s own name sits underneath when it differs. Categories are the glossary\'s.'],
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
