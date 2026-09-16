import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { listRecipes } from '@/lib/recipes';
import { inr, rateLabel, unitShort, pct } from '@/lib/recipes-engine';
import { Crumbs, Flash, SearchForm, Status } from '../ui';

export const dynamic = 'force-dynamic';

export default async function SemiPage({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const sp = await searchParams; const qq = (sp.q ?? '').trim();
  const rows = await listRecipes('intermediate', qq);
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Semi-finished']} />
      <h1 className="page">Semi-finished recipes</h1>
      <p className="hint">Sponges, ganaches, creams, glazes, syrups, bases. Each is a batch: what goes in, what comes out, and therefore what one gram or one piece of it costs. A semi-finished recipe can use another one, to any depth, never in a loop.</p>
      <Flash ok={sp.ok} err={sp.err} />
      <SearchForm action="/recipes/semi" q={qq} placeholder="Find a semi-finished recipe" extra={<>
        {perms.draft ? <Link className="btn btn-primary" href="/recipes/new?kind=intermediate">New semi-finished recipe</Link> : null}
        <Link className="btn btn-secondary" href="/recipes/download?what=semi">CSV</Link>
      </>} />
      <p className="note">{rows.length} recipes{qq ? ` matching "${qq}"` : ''}.</p>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr><th>Recipe</th><th>Status</th><th className="num">Lines</th><th className="num">Batch makes</th><th className="num">Yield</th><th className="num">Batch cost</th><th className="num">Unit cost</th><th className="num">Used in</th></tr></thead>
          <tbody>{rows.map(r => {
            const weightOut = r.output_unit === 'gram' || r.output_unit === 'millilitre';
            const y = weightOut && r.input_qty && r.output_qty ? r.output_qty / r.input_qty : null;
            return (
              <tr key={r.recipe_id}>
                <td><Link href={'/recipes/r/' + encodeURIComponent(r.code)}>{r.name}</Link>{r.pending ? <span className="pill pill-warn" style={{ marginLeft: 6 }}>change in progress</span> : null}{r.missing_rates ? <span className="pill pill-danger" style={{ marginLeft: 6 }}>{r.missing_rates} line{r.missing_rates === 1 ? '' : 's'} without a rate</span> : null}</td>
                <td><Status status={r.status} /></td>
                <td className="num">{r.line_count}{r.semi_lines ? <span className="muted small"> ({r.semi_lines} semi)</span> : null}</td>
                <td className="num">{r.output_qty != null ? `${r.output_qty.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${unitShort(r.output_unit ?? '')}` : ''}</td>
                <td className="num">{y != null ? pct(y, 0) : <span className="muted">pieces</span>}</td>
                <td className="num">{inr(r.batch_cost)}</td>
                <td className="num">{rateLabel(r.unit_cost, r.output_unit ?? 'piece')}</td>
                <td className="num">{r.used_in || <span className="pill pill-neutral">unused</span>}</td>
              </tr>);
          })}
            {rows.length === 0 ? <tr><td colSpan={8} className="muted">Nothing matches.</td></tr> : null}</tbody>
        </table>
      </div>
    </>
  );
}
