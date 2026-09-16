import Link from 'next/link';
import { requireUser, recipePerms } from '@/lib/session';
import { homeCounts, getSettings, recentEvents } from '@/lib/recipes';
import { redirect } from 'next/navigation';
import { saveSettings } from './actions';
import { Flash } from './ui';

// The recipe module's compass. Answers the day's questions and every number is a
// door (two-audience principle): what is waiting on whom, what is above target,
// what has no price, which ingredients have no rate.
export const dynamic = 'force-dynamic';

export default async function RecipesHome({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const sp = await searchParams;
  const [c, settings, events] = await Promise.all([homeCounts(), getSettings(), recentEvents(20)]);

  const tile = (href: string, value: number | string, label: string, sub?: React.ReactNode) => (
    <Link className="tile" href={href}>
      <div className="mval" style={{ fontSize: 26 }}>{value}</div>
      <div className="t" style={{ fontSize: 14 }}>{label}</div>
      {sub ? <div className="d">{sub}</div> : null}
    </Link>
  );

  return (
    <>
      <h1 className="page">Recipes and costing</h1>
      <p className="hint">
        Every cost here is rebuilt from the price list, up through the semi-finished batches, into the sold item.
        One rule everywhere: <b>unit cost = the lines added up ÷ what the batch makes</b>. A chef writes a change,
        controls checks and prices it, Pranjay approves it; only the approved version is ever read.
      </p>
      <Flash ok={sp.ok} err={sp.err} />

      <h2 className="sec-head">Waiting on someone</h2>
      <div className="tiles">
        {tile('/recipes/approvals?state=draft', c.drafts, 'drafts being written', 'chef is still working on these')}
        {tile('/recipes/approvals?state=check', c.to_check, 'waiting for a check', perms.check ? 'yours to check and price' : 'with controls')}
        {tile('/recipes/approvals?state=approve', c.to_approve, 'waiting for approval', perms.approve ? 'yours to approve' : "with Pranjay")}
        {tile('/recipes/ingredients?missing=1', c.used_without_rate, 'ingredients in use with no rate', 'costed at zero until a rate is set')}
      </div>

      <h2 className="sec-head">The book today</h2>
      <div className="tiles">
        {tile('/recipes/food-cost', c.above_target, `items above ${settings.target}% food cost`, 'with packaging, allowance included')}
        {tile('/recipes/food-cost?filter=noprice', c.no_price, 'active items with no selling price', 'no food cost can be computed')}
        {tile('/recipes/finished', c.fg_active, 'active finished goods', 'what is sold on Zomato and Swiggy')}
        {tile('/recipes/semi', c.semi, 'semi-finished recipes', 'sponges, ganaches, creams, syrups, bases')}
        {tile('/recipes/ingredients', c.ingredients, 'purchased ingredients', c.newest_rate ? `price list as of ${c.newest_rate}` : 'no rates yet')}
        {tile('/recipes/ingredients/supplynote', c.rate_changes_7d, 'rate changes in the last 7 days', 'fetch last purchase prices from SupplyNote')}
      </div>

      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="tile">
          <div className="t">Settings used on every page</div>
          {perms.approve ? (
            <form action={saveSettings} className="row" style={{ marginTop: 8 }}>
              <label className="small">Target food cost %<br /><input name="target" type="number" step="0.1" defaultValue={settings.target} style={{ width: 90 }} /></label>
              <label className="small">Wastage allowance %<br /><input name="allowance" type="number" step="0.1" defaultValue={settings.allowance} style={{ width: 90 }} /></label>
              <button className="btn btn-primary" type="submit">Save</button>
            </form>
          ) : (
            <div className="d">Target food cost <b>{settings.target}%</b>, wastage allowance <b>{settings.allowance}%</b>. Only an admin changes these.</div>
          )}
          <div className="d" style={{ marginTop: 6 }}>The target is a placeholder until Pranjay sets out the rule (with and without packaging). The allowance is the workbook&rsquo;s +10%, now a named number.</div>
        </div>
        <div className="tile">
          <div className="t">Doors</div>
          <div className="d">
            <Link href="/recipes/new">Write a new recipe</Link> · <Link href="/recipes/upload">Bulk upload a recipe file</Link> · <Link href="/recipes/impact">What if a price changes</Link> · <Link href="/recipes/download?what=foodcost">Download the food cost list (CSV)</Link>
          </div>
        </div>
      </div>

      <h2 className="sec-head">Recent activity</h2>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr><th>When</th><th>What</th><th>Recipe or ingredient</th><th>Who</th></tr></thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i}>
                <td className="muted small">{e.at.slice(0, 16).replace('T', ' ')}</td>
                <td>{e.action}</td>
                <td>{e.code ? <Link href={'/recipes/r/' + encodeURIComponent(e.code)}>{e.name}</Link> : e.name ?? (e.entity === 'import' ? 'workbook' : e.entity)}</td>
                <td className="muted small">{e.actor}</td>
              </tr>
            ))}
            {events.length === 0 ? <tr><td colSpan={4} className="muted">Nothing yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
