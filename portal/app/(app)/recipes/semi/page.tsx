import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { listRecipes } from '@/lib/recipes';
import { inr, rateLabel, unitShort, pct } from '@/lib/recipes-engine';
import { Crumbs, Flash, Toolbar, Legend, Status } from '../ui';

export const dynamic = 'force-dynamic';

export default async function SemiPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string; show?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const sp = await searchParams; const qq = (sp.q ?? '').trim(); const show = sp.show ?? '';
  const all = await listRecipes('intermediate', qq);
  let rows = all;
  if (show === 'active') rows = all.filter(r => r.status === 'active');
  if (show === 'unused') rows = all.filter(r => !r.used_in);
  if (show === 'pending') rows = all.filter(r => r.pending);
  if (show === 'norate') rows = all.filter(r => r.missing_rates > 0);
  const href = (s: string) => '/recipes/semi?' + [s ? 'show=' + s : '', qq ? 'q=' + encodeURIComponent(qq) : ''].filter(Boolean).join('&');
  const chips = [
    { label: 'All', href: href(''), on: !show, count: all.length },
    { label: 'Active', href: href('active'), on: show === 'active', count: all.filter(r => r.status === 'active').length },
    { label: 'Not used anywhere', href: href('unused'), on: show === 'unused', count: all.filter(r => !r.used_in).length },
    { label: 'Change in progress', href: href('pending'), on: show === 'pending', count: all.filter(r => r.pending).length },
    { label: 'Missing a rate', href: href('norate'), on: show === 'norate', count: all.filter(r => r.missing_rates > 0).length },
  ];
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Semi-finished']} />
      <div className="spread">
        <h1 className="page">Semi-finished recipes</h1>
        <div className="row">
          {perms.draft ? <Link className="btn btn-primary" href="/recipes/new?kind=intermediate">New semi-finished recipe</Link> : null}
          <Link className="btn btn-secondary" href="/recipes/download?what=semi">Download CSV</Link>
        </div>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <Toolbar action="/recipes/semi" q={qq} placeholder="Find a sponge, ganache, cream, syrup, base" chips={chips} hidden={show ? { show } : {}} count={`${rows.length} shown`} />
      <div className="rtable">
        <table className="sheet">
          <thead><tr><th>Recipe</th><th>Status</th><th className="num">One batch makes</th><th className="num">Yield</th><th className="num">Batch cost</th><th className="num">Cost per kg / L / pc</th><th className="num">Used in</th></tr></thead>
          <tbody>{rows.map(r => {
            const weightOut = r.output_unit === 'gram' || r.output_unit === 'millilitre';
            const y = weightOut && r.input_qty && r.output_qty ? r.output_qty / r.input_qty : null;
            return (
              <tr key={r.recipe_id}>
                <td className="name"><Link href={'/recipes/r/' + encodeURIComponent(r.code)}>{r.name}</Link>
                  <span className="sub">{r.line_count} ingredient{r.line_count === 1 ? '' : 's'}{r.semi_lines ? `, ${r.semi_lines} of them semi-finished` : ''}{r.pending ? ' · change in progress' : ''}{r.missing_rates ? ` · ${r.missing_rates} without a rate` : ''}</span></td>
                <td><Status status={r.status} /></td>
                <td className="num">{r.output_qty != null ? `${r.output_qty.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${unitShort(r.output_unit ?? '')}` : ''}</td>
                <td className="num">{y != null ? pct(y, 0) : <span className="muted">by piece</span>}</td>
                <td className="num">{inr(r.batch_cost)}</td>
                <td className="num"><b>{rateLabel(r.unit_cost, r.output_unit ?? 'piece')}</b></td>
                <td className="num">{r.used_in ? `${r.used_in} recipe${r.used_in === 1 ? '' : 's'}` : <span className="muted">none</span>}</td>
              </tr>);
          })}
            {rows.length === 0 ? <tr><td colSpan={7} className="muted">Nothing matches.</td></tr> : null}</tbody>
        </table>
      </div>
      <Legend items={[
        ['One batch makes', 'the weight or pieces that come out when the recipe is made once, as the chef declared it.'],
        ['Yield', 'what comes out as a share of what went in; below 100% means water baked or boiled off.'],
        ['Cost per kg / L / pc', 'batch cost ÷ what the batch makes; this is the rate every recipe using it pays.'],
        ['Used in', 'how many other recipes use this one directly.'],
      ]} />
    </>
  );
}
