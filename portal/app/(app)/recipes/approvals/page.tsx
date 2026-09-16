import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { pendingVersions } from '@/lib/recipes';
import { inr } from '@/lib/recipes-engine';
import { Crumbs, Flash, Kind, State } from '../ui';

// The queue: every version that is not live and not finished with. Grouped by whose
// turn it is. Each row opens the side-by-side view where the buttons live.
export const dynamic = 'force-dynamic';

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; state?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const sp = await searchParams;
  const all = await pendingVersions();
  const groups = [
    { key: 'approve', title: 'Waiting for approval', who: "Pranjay's turn", rows: all.filter(v => v.state === 'checked' && v.checked_by) },
    { key: 'check', title: 'Waiting for a check', who: "controls' turn", rows: all.filter(v => v.state === 'checked' && !v.checked_by) },
    { key: 'draft', title: 'Drafts still being written', who: "the chef's turn", rows: all.filter(v => v.state === 'draft') },
  ].filter(g => !sp.state || g.key === sp.state);
  const whoName = (s: string | null) => (s ?? '').split('<')[0].trim();
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Changes & approvals']} />
      <h1 className="page">Changes and approvals</h1>
      <p className="hint">A change is a new version of a recipe. It goes chef → controls → Pranjay, and only an approved version changes a cost. Open a row to see every changed line and the cost before and after.</p>
      <Flash ok={sp.ok} err={sp.err} />
      {groups.map(g => (
        <div key={g.key}>
          <h2 className="sec-head">{g.title} <span className="muted small">({g.rows.length}, {g.who})</span></h2>
          {g.rows.length === 0 ? <p className="note">Nothing here.</p> : (
            <div className="scroll-x"><table className="sheet">
              <thead><tr><th>Recipe</th><th></th><th>Version</th><th>By</th><th>Since</th><th className="num">Cost live → new</th><th>Note</th></tr></thead>
              <tbody>{g.rows.map(v => (
                <tr key={v.version_id}>
                  <td><Link href={`/recipes/r/${encodeURIComponent(v.code)}/v/${v.version_id}`}>{v.name}</Link></td>
                  <td><Kind kind={v.kind} /></td>
                  <td>v{v.version_no} <State state={v.state} checkedBy={v.checked_by} /></td>
                  <td className="muted small">{whoName(v.checked_by ?? v.drafted_by)}</td>
                  <td className="muted small">{(v.checked_at ?? v.drafted_at ?? '').slice(0, 10)}</td>
                  <td className="num">{v.live_unit_cost != null ? inr(v.live_unit_cost, v.kind === 'finished' ? 2 : 4) : 'new'} → <b>{inr(v.new_unit_cost, v.kind === 'finished' ? 2 : 4)}</b>{v.new_missing ? <span className="pill pill-danger" style={{ marginLeft: 6 }}>{v.new_missing} no rate</span> : null}</td>
                  <td className="muted small">{v.checker_note ?? v.chef_note}</td>
                </tr>))}</tbody>
            </table></div>)}
        </div>))}
    </>
  );
}
