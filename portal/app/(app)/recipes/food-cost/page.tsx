import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { foodCostList, getSettings } from '@/lib/recipes';
import { inr, pct } from '@/lib/recipes-engine';
import { Crumbs, Flash, Toolbar, Legend, Verdict } from '../ui';

// Every active item, costed today, worst first, grouped by the item glossary's
// categories and named the way the menu names it. This is the list the P&L
// and the MIS read; month-end snapshots (migration 229) freeze it for history.
export const dynamic = 'force-dynamic';

const NO_GLOSSARY = 'Not in the glossary';

export default async function FoodCostPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; cat?: string; show?: string; q?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.money) redirect('/recipes');
  const sp = await searchParams; const qq = (sp.q ?? '').trim(); const cat = sp.cat ?? ''; const show = sp.show ?? '';
  const settings = await getSettings();
  const all = (await foodCostList()).filter(r => r.status === 'active');
  const catOf = (r: { glossary_category: string | null }) => r.glossary_category ?? NO_GLOSSARY;
  const cats = Array.from(new Set(all.map(catOf))).sort((a, b) => (a === NO_GLOSSARY ? 1 : b === NO_GLOSSARY ? -1 : a.localeCompare(b)));
  const over = (r: { food_cost_with_packaging_pct: number | null; target_pct: number }) => r.food_cost_with_packaging_pct != null && r.food_cost_with_packaging_pct > r.target_pct;
  let rows = cat ? all.filter(r => catOf(r) === cat) : all;
  if (show === 'above') rows = rows.filter(over);
  if (show === 'noprice') rows = rows.filter(r => !r.selling_price);
  if (qq) rows = rows.filter(r => (r.glossary_alias ?? r.name).toLowerCase().includes(qq.toLowerCase()) || r.name.toLowerCase().includes(qq.toLowerCase()));
  const href = (c: string, s: string) => '/recipes/food-cost?' + [c ? 'cat=' + encodeURIComponent(c) : '', s ? 'show=' + s : '', qq ? 'q=' + encodeURIComponent(qq) : ''].filter(Boolean).join('&');
  const chips = [{ label: 'All', href: href('', show), on: !cat, count: all.length },
    ...cats.map(c => ({ label: c, href: href(c, show), on: cat === c, count: all.filter(r => catOf(r) === c).length }))];
  const chips2 = [
    { label: 'Above target', href: href(cat, show === 'above' ? '' : 'above'), on: show === 'above', count: all.filter(over).length },
    { label: 'No selling price', href: href(cat, show === 'noprice' ? '' : 'noprice'), on: show === 'noprice', count: all.filter(r => !r.selling_price).length },
  ];
  const avg = (() => { const v = rows.filter(r => r.food_cost_with_packaging_pct != null); return v.length ? v.reduce((s, r) => s + (r.food_cost_with_packaging_pct ?? 0), 0) / v.length : null; })();
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Food cost list']} />
      <div className="spread">
        <h1 className="page">Food cost list</h1>
        <Link className="btn btn-secondary" href="/recipes/download?what=foodcost">Download CSV</Link>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <Toolbar action="/recipes/food-cost" q={qq} placeholder="Find an item" chips={chips} hidden={{ ...(cat ? { cat } : {}), ...(show ? { show } : {}) }}
        count={`${rows.length} shown${avg != null ? `, average food cost ${pct(avg)}` : ''}`}
        right={<div className="chips">{chips2.map(c => <Link key={c.href} href={c.href} className={'rchip' + (c.on ? ' on' : '')}>{c.label}<span className="n">{c.count}</span></Link>)}</div>} />
      <div className="rtable">
        <table className="sheet">
          <thead><tr><th>Item</th><th className="num">Material</th><th className="num">+ allowance</th><th className="num">Packaging</th><th className="num">Selling price</th><th className="num">Pack. charge</th><th className="num">Food cost</th><th className="num">With packaging</th><th>Verdict</th></tr></thead>
          <tbody>{rows.map(r => {
            const shown = r.glossary_alias ?? r.name;
            const sub = [r.glossary_alias && r.glossary_alias !== r.name ? `recipe: ${r.name}` : null, !r.glossary_alias ? 'not linked to a menu item yet' : null,
              r.missing_rates ? `${r.missing_rates} line${r.missing_rates === 1 ? '' : 's'} without a rate` : null].filter(Boolean).join(' · ');
            return (
              <tr key={r.recipe_id}>
                <td className="name"><Link href={'/recipes/r/' + encodeURIComponent(r.code)}>{shown}</Link>{sub ? <span className="sub">{sub}</span> : null}</td>
                <td className="num">{inr(r.material_per_unit)}</td>
                <td className="num">{inr(r.material_with_allowance)}</td>
                <td className="num">{inr(r.packaging_per_unit)}</td>
                <td className="num">{r.selling_price ? inr(r.selling_price, 0) : <span className="pill pill-warn">missing</span>}</td>
                <td className="num">{inr(r.packaging_charge, 0)}</td>
                <td className="num">{pct(r.food_cost_pct)}</td>
                <td className="num"><b>{pct(r.food_cost_with_packaging_pct)}</b></td>
                <td><Verdict fc={r.food_cost_with_packaging_pct} target={r.target_pct} /></td>
              </tr>);
          })}
            {rows.length === 0 ? <tr><td colSpan={9} className="muted">Nothing here.</td></tr> : null}</tbody>
        </table>
      </div>
      <Legend items={[
        ['Item', 'the menu name from the item glossary, recipe name underneath when it differs; tabs are the glossary\'s categories.'],
        ['Material', 'ingredients in one sold unit at today\'s price list, through every semi-finished batch.'],
        ['+ allowance', `material plus the ${settings.allowance}% wastage allowance (the workbook's +10%, now a named setting).`],
        ['Food cost', 'material with allowance ÷ selling price.'],
        ['With packaging', `(material with allowance + packaging) ÷ (selling price + packaging charge); the verdict compares this with the ${settings.target}% target.`],
      ]} />
      <p className="note">Cost of goods for a past month will read the month-end snapshot once the first one exists; they are taken automatically on the 1st.</p>
    </>
  );
}
