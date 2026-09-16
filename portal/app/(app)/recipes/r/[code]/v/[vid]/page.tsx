import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { getRecipe, getVersion, versionLines, costOfVersion, pickLists, getSettings, diffLines } from '@/lib/recipes';
import { inr, pct, rateLabel, unitShort } from '@/lib/recipes-engine';
import { submitForCheck, markChecked, sendBack, rejectVersion, approveVersion } from '../../../../actions';
import { Crumbs, Flash, Kind, State, RefLink, Verdict } from '../../../../ui';
import Editor from './Editor';

// One version of a recipe. A draft opens in the editor (cost as you type); anything
// else is read side by side with the live version: every changed line, cost before
// and after, food cost before and after, and the buttons for whoever's turn it is.
export const dynamic = 'force-dynamic';

export default async function VersionPage({ params, searchParams }: { params: Promise<{ code: string; vid: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const { code, vid } = await params; const sp = await searchParams;
  const d = await getRecipe(decodeURIComponent(code));
  const v = await getVersion(Number(vid));
  if (!d || !v || v.recipe_id !== d.recipe.id) notFound();
  const settings = await getSettings();
  const isFG = d.recipe.kind === 'finished';
  const back = `/recipes/r/${encodeURIComponent(d.recipe.code)}/v/${v.version_id}`;
  const [lines, cost, liveCost] = await Promise.all([versionLines(v.version_id), costOfVersion(v.version_id), d.live ? costOfVersion(d.live.version_id) : Promise.resolve(null)]);
  const isLive = d.live?.version_id === v.version_id;
  const sp0 = d.price?.selling_price ?? 0; const pc0 = d.price?.packaging_charge ?? 0;
  const fc = (c: { unit_cost: number; packaging_cost: number } | null) => c && sp0 > 0 ? (c.unit_cost * (1 + settings.allowance / 100) + c.packaging_cost) / (sp0 + pc0) : null;
  const diffs = d.live && !isLive ? diffLines(d.lines, lines) : [];
  const whoName = (s: string | null) => (s ?? '').split('<')[0].trim();

  if (v.state === 'draft' && perms.draft) {
    const picks = await pickLists();
    return (
      <>
        <Crumbs items={[['Recipes', '/recipes'], [d.recipe.name, '/recipes/r/' + encodeURIComponent(d.recipe.code)], `v${v.version_no} draft`]} />
        <div className="spread"><h1 className="page">{d.recipe.name} <span className="muted" style={{ fontSize: 16, fontWeight: 400 }}>draft v{v.version_no}</span></h1><State state="draft" /></div>
        <p className="hint">Change lines and what the batch makes; the cost updates as you type. Nothing here changes any live cost until it is checked and approved.
          {d.live ? <> The live version (v{d.live.version_no}) costs {inr(liveCost?.unit_cost ?? 0, isFG ? 2 : 4)} per {isFG ? 'unit' : unitShort(d.live.output_unit)}.</> : ' This recipe has no live version yet.'}</p>
        <Flash ok={sp.ok} err={sp.err} />
        <Editor versionId={v.version_id} back={back} isFinished={isFG}
          initial={{ output_qty: v.output_qty, output_unit: v.output_unit, sold_weight_g: v.sold_weight_g, lines: lines.map(l => ({ role: l.role, ingredient_sku_id: l.ingredient_sku_id, sub_recipe_id: l.sub_recipe_id, qty: l.qty, unit: l.unit, name: l.ref_name, code: l.ref_code, kind: l.ref_kind, rate: l.rate, rate_unit: l.rate_unit })) }}
          picks={{ ingredients: picks.ingredients.filter(i => i.id != null), recipes: picks.recipes.filter(r => r.id !== d.recipe.id) }}
          settings={settings} price={d.price ? { selling_price: d.price.selling_price, packaging_charge: d.price.packaging_charge } : null} liveUnitCost={liveCost?.unit_cost ?? null} />
        {perms.check ? (
          <form action={rejectVersion} className="row" style={{ marginTop: 18 }}>
            <input type="hidden" name="version_id" value={v.version_id} /><input type="hidden" name="back" value={'/recipes/r/' + encodeURIComponent(d.recipe.code)} />
            <input name="note" placeholder="reason" style={{ width: 240 }} /><button className="btn btn-secondary" type="submit">Reject this draft</button>
          </form>) : null}
      </>
    );
  }

  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], [d.recipe.name, '/recipes/r/' + encodeURIComponent(d.recipe.code)], `v${v.version_no}`]} />
      <div className="spread">
        <h1 className="page">{d.recipe.name} <span className="muted" style={{ fontSize: 16, fontWeight: 400 }}>version {v.version_no}</span></h1>
        <State state={v.state} checkedBy={v.checked_by} />
      </div>
      <p className="note">
        Drafted by {whoName(v.drafted_by)} on {(v.drafted_at ?? '').slice(0, 10)}{v.source ? ` (${v.source})` : ''}
        {v.checked_by ? <>, checked by {whoName(v.checked_by)} on {(v.checked_at ?? '').slice(0, 10)}</> : null}
        {v.approved_by ? <>, approved by {whoName(v.approved_by)} on {(v.approved_at ?? '').slice(0, 10)}, live from {v.effective_from}</> : null}
        {v.superseded_at ? <>, superseded on {v.superseded_at.slice(0, 10)}</> : null}
        {v.rejected_reason ? <>, rejected: {v.rejected_reason}</> : null}
      </p>
      {v.chef_note ? <p className="callout"><b>Chef&rsquo;s note:</b> {v.chef_note}</p> : null}
      {v.checker_note ? <p className="callout"><b>Checker&rsquo;s note:</b> {v.checker_note}</p> : null}
      <Flash ok={sp.ok} err={sp.err} />

      {!isLive && d.live ? (
        <>
          <h2 className="sec-head">What changes against the live version (v{d.live.version_no})</h2>
          <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className="tile"><div className="tlabel">Unit cost</div><div className="mval">{inr(liveCost?.unit_cost, isFG ? 2 : 4)} → <b>{inr(cost?.unit_cost, isFG ? 2 : 4)}</b></div><div className="muted small">{liveCost && cost ? ((cost.unit_cost - liveCost.unit_cost) >= 0 ? '+' : '') + inr(cost.unit_cost - liveCost.unit_cost, isFG ? 2 : 4) + (liveCost.unit_cost ? ` (${pct((cost.unit_cost - liveCost.unit_cost) / liveCost.unit_cost)})` : '') : ''}</div></div>
            <div className="tile"><div className="tlabel">Batch makes</div><div className="mval">{d.live.output_qty.toLocaleString('en-IN')} {unitShort(d.live.output_unit)} → <b>{v.output_qty.toLocaleString('en-IN')} {unitShort(v.output_unit)}</b></div></div>
            {isFG && perms.money ? <div className="tile"><div className="tlabel">Food cost with packaging</div><div className="mval">{pct(fc(liveCost))} → <b>{pct(fc(cost))}</b></div><div className="muted small"><Verdict fc={fc(cost)} target={settings.target / 100} /></div></div> : null}
            <div className="tile"><div className="tlabel">Lines changed</div><div className="mval">{diffs.length}</div></div>
          </div>
          {diffs.length ? (
            <div className="scroll-x"><table className="sheet" style={{ marginTop: 10 }}>
              <thead><tr><th>Line</th><th></th><th className="num">Live</th><th className="num">This version</th></tr></thead>
              <tbody>{diffs.map((x, i) => <tr key={i}><td>{x.ref_name}{x.role === 'packaging' ? <span className="muted small"> (packaging)</span> : null}</td><td><Kind kind={x.ref_kind} /></td><td className="num">{x.before != null ? `${x.before.toLocaleString('en-IN')} ${unitShort(x.unit)}` : <span className="pill pill-ok">added</span>}</td><td className="num">{x.after != null ? `${x.after.toLocaleString('en-IN')} ${unitShort(x.unit)}` : <span className="pill pill-danger">removed</span>}</td></tr>)}</tbody>
            </table></div>) : <p className="note">No line differs; only the output or a note changed.</p>}
        </>
      ) : null}

      <h2 className="sec-head">The lines of this version</h2>
      <div className="scroll-x"><table className="sheet">
        <thead><tr><th>Ingredient</th><th></th><th className="num">Quantity</th><th className="num">Rate today</th><th className="num">Amount</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.id}><td><RefLink kind={l.ref_kind} code={l.ref_code} name={l.ref_name} />{l.role === 'packaging' ? <span className="muted small"> (packaging)</span> : null}</td><td><Kind kind={l.ref_kind} /></td><td className="num">{l.qty.toLocaleString('en-IN')} {unitShort(l.unit)}</td><td className="num">{l.rate != null ? rateLabel(l.rate, l.rate_unit) : <span className="pill pill-danger">no rate</span>}</td><td className="num">{inr(l.amount)}</td></tr>)}
          <tr><td colSpan={2}><b>Batch makes {v.output_qty.toLocaleString('en-IN')} {isFG ? 'sold unit(s)' : unitShort(v.output_unit)}</b></td><td></td><td></td><td className="num"><b>{inr(cost?.batch_cost)}</b> batch, <b>{inr(cost?.unit_cost, isFG ? 2 : 4)}</b> per {isFG ? 'unit' : unitShort(v.output_unit)}</td></tr></tbody>
      </table></div>

      {(v.state === 'draft' || v.state === 'checked') ? (
        <>
          <h2 className="sec-head">Next step</h2>
          <div className="row">
            {v.state === 'draft' && perms.draft ? <form action={submitForCheck} className="row"><input type="hidden" name="version_id" value={v.version_id} /><input type="hidden" name="back" value={back} /><input name="note" placeholder="note for the checker" style={{ width: 240 }} /><button className="btn btn-primary" type="submit">Send for checking</button></form> : null}
            {v.state === 'checked' && !v.checked_by && perms.check ? <form action={markChecked} className="row"><input type="hidden" name="version_id" value={v.version_id} /><input type="hidden" name="back" value={back} /><input name="note" placeholder="checker's note" style={{ width: 240 }} /><button className="btn btn-primary" type="submit">Mark as checked</button></form> : null}
            {v.state === 'checked' && v.checked_by && perms.approve ? <form action={approveVersion} className="row"><input type="hidden" name="version_id" value={v.version_id} /><input type="hidden" name="back" value={'/recipes/r/' + encodeURIComponent(d.recipe.code)} /><label className="small">Live from<br /><input name="effective_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label><input name="note" placeholder="note" style={{ width: 200 }} /><button className="btn btn-primary" type="submit">Approve</button></form> : null}
            {v.state === 'checked' && perms.check ? <form action={sendBack} className="row"><input type="hidden" name="version_id" value={v.version_id} /><input type="hidden" name="back" value={back} /><input name="note" placeholder="what to change" style={{ width: 220 }} required /><button className="btn btn-secondary" type="submit">Send back to chef</button></form> : null}
            {perms.check ? <form action={rejectVersion} className="row"><input type="hidden" name="version_id" value={v.version_id} /><input type="hidden" name="back" value={'/recipes/r/' + encodeURIComponent(d.recipe.code)} /><input name="note" placeholder="reason" style={{ width: 200 }} required /><button className="btn btn-secondary" type="submit">Reject</button></form> : null}
            {v.state === 'checked' && v.checked_by && !perms.approve ? <span className="pill pill-warn">Waiting for Pranjay&rsquo;s approval</span> : null}
            {v.state === 'checked' && !v.checked_by && !perms.check ? <span className="pill pill-warn">Waiting for controls to check</span> : null}
          </div>
        </>
      ) : null}
      <p className="note"><Link href={'/recipes/r/' + encodeURIComponent(d.recipe.code)}>Back to the recipe</Link></p>
    </>
  );
}
