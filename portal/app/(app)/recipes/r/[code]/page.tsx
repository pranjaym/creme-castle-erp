import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { getRecipe, getSettings } from '@/lib/recipes';
import { inr, pct, rateLabel, unitShort } from '@/lib/recipes-engine';
import { startDraft, setPrice, retireRecipe } from '../../actions';
import { Crumbs, Flash, Kind, Status, State, Verdict, RefLink, Strip, soldAs } from '../../ui';

// The costing card: one component for a semi-finished batch and a finished good.
// Lines are what the chef writes; the rate on each line comes from the price list
// (never typed); the batch makes a declared output; unit cost is the one rule.
export const dynamic = 'force-dynamic';

export default async function RecipePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.view) redirect('/');
  const { code } = await params; const sp = await searchParams;
  const d = await getRecipe(decodeURIComponent(code));
  if (!d) notFound();
  const settings = await getSettings();
  const { recipe, live, lines, cost, price, explode, usedIn, versions } = d;
  const isFG = recipe.kind === 'finished';
  const material = lines.filter(l => l.role === 'material'); const packaging = lines.filter(l => l.role === 'packaging');
  const batch = cost?.batch_cost ?? 0; const unit = cost?.unit_cost ?? 0; const packCost = cost?.packaging_cost ?? 0;
  const inputW = material.filter(l => l.unit === 'gram' || l.unit === 'millilitre').reduce((s, l) => s + l.qty, 0);
  const allWeight = material.length > 0 && material.every(l => l.unit === 'gram' || l.unit === 'millilitre');
  const yieldPct = !isFG && live && allWeight && (live.output_unit === 'gram' || live.output_unit === 'millilitre') && inputW ? live.output_qty / inputW : null;
  const withAllow = unit * (1 + settings.allowance / 100);
  const sp0 = price?.selling_price ?? 0; const pc0 = price?.packaging_charge ?? 0;
  const fcNo = sp0 > 0 ? withAllow / sp0 : null; const fcPack = sp0 > 0 ? (withAllow + packCost) / (sp0 + pc0) : null;
  const pending = versions.find(v => v.state === 'draft' || v.state === 'checked');
  const showMoney = perms.money;
  const back = '/recipes/r/' + encodeURIComponent(recipe.code);
  const exTotal = explode.reduce((s, e) => s + e.cost, 0);

  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], [isFG ? 'Finished goods' : 'Semi-finished', isFG ? '/recipes/finished' : '/recipes/semi'], recipe.name]} />
      <div className="spread">
        <div>
          <h1 className="page">{recipe.name}</h1>
          <p className="rtitle" style={{ marginTop: 4 }}>
            <Kind kind={recipe.kind} /> <Status status={recipe.status} />
            {d.aliases.filter(a => a.system === 'item_glossary').map(a => <span key={a.external_name} className="meta">sold as <b>{a.external_name}</b></span>)}
            <span className="meta">{live ? <>live since {live.effective_from ?? '17 Aug 2026'}{(live.approved_by ?? '').startsWith('workbook') ? ', from the workbook' : `, approved by ${(live.approved_by ?? '').split('<')[0].trim()}`}{live.version_no > 1 ? ` (change ${live.version_no})` : ''}</> : <b>no live version</b>}</span>
          </p>
        </div>
        <div className="row">
          {pending ? <Link className="btn btn-primary" href={`${back}/v/${pending.version_id}`}>Open the change in progress (v{pending.version_no}, {pending.state})</Link>
            : perms.draft ? <form action={startDraft}><input type="hidden" name="recipe_id" value={recipe.id} /><input type="hidden" name="code" value={recipe.code} /><button className="btn btn-primary" type="submit">Start a change</button></form> : null}
        </div>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      {recipe.retired_at ? <p className="hint warn">Retired on {recipe.retired_at.slice(0, 10)}: {recipe.retired_reason}. Kept for history; no cost reads it.</p> : null}
      <Strip items={isFG ? [
        { l: 'Material cost', v: inr(unit), d: 'per sold unit, today' },
        ...(showMoney ? [
          { l: 'Packaging', v: inr(packCost), d: packaging.length ? `${packaging.length} item${packaging.length === 1 ? '' : 's'}` : 'none yet' },
          { l: 'Selling price', v: sp0 ? inr(sp0, 0) : 'missing', d: pc0 ? `+ ${inr(pc0, 0)} packaging charge` : 'Zomato = Swiggy' },
          { l: 'Food cost', v: pct(fcPack), d: <Verdict fc={fcPack} target={settings.target / 100} /> },
        ] : []),
        { l: 'Sold as', v: soldAs(live?.output_qty, live?.sold_weight_g).replace(' per batch', ''), d: live && live.output_qty > 1 ? 'per batch' : 'one batch makes one' },
      ] : [
        { l: 'Cost', v: rateLabel(unit, live?.output_unit ?? 'piece'), d: 'today, per ' + (live && (live.output_unit === 'gram' || live.output_unit === 'millilitre') ? (live.output_unit === 'gram' ? 'kg' : 'litre') : 'piece') },
        { l: 'One batch makes', v: live ? `${live.output_qty.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${unitShort(live.output_unit)}` : '', d: `${inr(batch)} of ingredients` },
        { l: 'Yield', v: yieldPct != null ? pct(yieldPct, 0) : 'by piece', d: yieldPct != null ? `${inputW.toLocaleString('en-IN')} g/ml goes in` : '' },
        { l: 'Used in', v: String(usedIn.length), d: usedIn.length === 1 ? 'recipe' : 'recipes' },
      ]} />

      <h2 className="sec-head">The batch</h2>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr><th>Ingredient</th><th></th><th className="num">Quantity</th><th className="num">Rate</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
          <tbody>
            {material.map(l => (
              <tr key={l.id}>
                <td><RefLink kind={l.ref_kind} code={l.ref_code} name={l.ref_name} /></td>
                <td><Kind kind={l.ref_kind} /></td>
                <td className="num">{l.qty.toLocaleString('en-IN')} {unitShort(l.unit)}</td>
                <td className="num">{l.rate != null ? rateLabel(l.rate, l.rate_unit) : <span className="pill pill-danger">no rate</span>}</td>
                <td className="num">{inr(l.amount)}</td>
                <td className="num">{batch ? pct(l.amount / batch, 0) : ''}</td>
              </tr>))}
            <tr><td colSpan={2}><b>Batch</b> <span className="muted small">{material.length} lines{allWeight ? `, ${inputW.toLocaleString('en-IN')} g/ml in` : ''}</span></td><td></td><td></td><td className="num"><b>{inr(batch)}</b></td><td></td></tr>
            {live ? <tr><td colSpan={2}><b>This batch makes</b></td><td className="num"><b>{live.output_qty.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {isFG ? (live.output_qty === 1 ? 'sold unit' : 'sold units') : unitShort(live.output_unit)}</b>{isFG && live.sold_weight_g ? <span className="muted small"> of {live.sold_weight_g} g</span> : null}</td><td colSpan={3} className="muted small">{yieldPct != null ? `= yield ${pct(yieldPct, 0)} of what went in` : ''}</td></tr> : null}
            <tr><td colSpan={2}><b>Unit cost</b> <span className="muted small">= {inr(batch)} ÷ {live?.output_qty.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</span></td><td></td><td></td><td className="num"><b style={{ fontSize: 16 }}>{isFG ? inr(unit) : inr(unit, 4)}</b><div className="muted small">per {isFG ? 'sold unit' : unitShort(live?.output_unit ?? 'piece')}{!isFG && live && (live.output_unit === 'gram' || live.output_unit === 'millilitre') ? `, ${inr(unit * 1000)} per ${live.output_unit === 'gram' ? 'kg' : 'litre'}` : ''}</div></td><td></td></tr>
            {cost?.missing_rates ? <tr><td colSpan={6}><span className="pill pill-danger">{cost.missing_rates} line{cost.missing_rates === 1 ? '' : 's'} without a rate, costed at zero</span></td></tr> : null}
          </tbody>
        </table>
      </div>

      {isFG ? (
        <>
          <h2 className="sec-head">Selling it</h2>
          <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div className="tile"><div className="t">Packaging</div>
              <table className="sheet" style={{ marginTop: 8 }}><tbody>
                {packaging.map(l => <tr key={l.id}><td><RefLink kind={l.ref_kind} code={l.ref_code} name={l.ref_name} /></td><td className="num">{l.qty} {unitShort(l.unit)}</td><td className="num">{inr(l.amount)}</td></tr>)}
                <tr><td><b>Packaging per unit</b></td><td></td><td className="num"><b>{inr(packCost)}</b></td></tr>
                {packaging.length === 0 ? <tr><td colSpan={3} className="muted small">No packaging line yet.</td></tr> : null}
              </tbody></table></div>
            {showMoney ? <>
              <div className="tile"><div className="t">Price (Zomato = Swiggy)</div>
                <table className="sheet" style={{ marginTop: 8 }}><tbody>
                  <tr><td className="muted">Selling price</td><td className="num">{price?.selling_price ? inr(price.selling_price, 0) : <span className="pill pill-warn">missing</span>}</td></tr>
                  <tr><td className="muted">Packaging charge</td><td className="num">{inr(price?.packaging_charge ?? 0, 0)}</td></tr>
                  <tr><td className="muted">Customer pays</td><td className="num">{inr(sp0 + pc0, 0)}</td></tr>
                  {price?.effective_from ? <tr><td className="muted small" colSpan={2}>since {price.effective_from}</td></tr> : null}
                </tbody></table>
                {perms.check ? (
                  <form action={setPrice} className="row" style={{ marginTop: 10 }}>
                    <input type="hidden" name="recipe_id" value={recipe.id} /><input type="hidden" name="back" value={back} />
                    <label className="small">Price<br /><input name="selling_price" type="number" step="1" defaultValue={price?.selling_price ?? ''} style={{ width: 90 }} /></label>
                    <label className="small">Pack. charge<br /><input name="packaging_charge" type="number" step="1" defaultValue={price?.packaging_charge ?? ''} style={{ width: 90 }} /></label>
                    <label className="small">From<br /><input name="effective_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                    <button className="btn btn-secondary" type="submit">Save price</button>
                  </form>) : null}
              </div>
              <div className="tile"><div className="t">Food cost</div>
                <table className="sheet" style={{ marginTop: 8 }}><tbody>
                  <tr><td className="muted">Material</td><td className="num">{inr(unit)}</td></tr>
                  <tr><td className="muted">+ allowance {settings.allowance}%</td><td className="num">{inr(withAllow)}</td></tr>
                  <tr><td className="muted">Food cost</td><td className="num"><b>{pct(fcNo)}</b> <span className="muted small">= {inr(withAllow)} ÷ {inr(sp0, 0)}</span></td></tr>
                  <tr><td className="muted">With packaging</td><td className="num"><b>{pct(fcPack)}</b> <Verdict fc={fcPack} target={settings.target / 100} /><div className="muted small">= ({inr(withAllow)} + {inr(packCost)}) ÷ {inr(sp0 + pc0, 0)}</div></td></tr>
                </tbody></table></div>
            </> : null}
          </div>
        </>
      ) : null}

      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', marginTop: 18 }}>
        <div className="tile">
          <div className="t">All the way down to raw materials</div>
          <div className="d">One {isFG ? 'sold unit' : unitShort(live?.output_unit ?? 'piece')}, opened up through every semi-finished batch. This is what the kitchen consumes.</div>
          <div className="scroll-x"><table className="sheet" style={{ marginTop: 8 }}>
            <thead><tr><th>Raw material</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Share</th></tr></thead>
            <tbody>{explode.map(e => <tr key={e.sku_id}><td><Link href={'/recipes/ingredients/' + e.sku_id}>{e.name}</Link></td><td className="num">{e.qty.toLocaleString('en-IN', { maximumFractionDigits: e.qty < 1 ? 3 : 1 })} {unitShort(e.base_unit)}</td><td className="num">{inr(e.cost)}</td><td className="num">{exTotal ? pct(e.cost / exTotal, 0) : ''}</td></tr>)}
              <tr><td><b>{explode.length} raw materials</b></td><td></td><td className="num"><b>{inr(exTotal)}</b></td><td></td></tr></tbody>
          </table></div>
        </div>
        <div className="tile">
          <div className="t">{isFG ? 'Also known as' : `Used in ${usedIn.length} recipe${usedIn.length === 1 ? '' : 's'}`}</div>
          {!isFG ? (
            <div className="scroll-x"><table className="sheet" style={{ marginTop: 8 }}>
              <thead><tr><th>Recipe</th><th></th><th className="num">Per batch</th></tr></thead>
              <tbody>{usedIn.map((u, i) => <tr key={i}><td><Link href={'/recipes/r/' + encodeURIComponent(u.used_by_code)}>{u.used_by_name}</Link></td><td><Kind kind={u.used_by_kind} /></td><td className="num">{u.qty.toLocaleString('en-IN')} {unitShort(u.unit)}</td></tr>)}
                {usedIn.length === 0 ? <tr><td colSpan={3} className="muted">Not used by any recipe.</td></tr> : null}</tbody>
            </table></div>
          ) : (
            <ul className="small" style={{ marginTop: 8 }}>{d.aliases.map((a, i) => <li key={i}><span className="muted">{a.system.replace('_', ' ')}:</span> {a.external_name}</li>)}
              {!d.aliases.some(a => a.system === 'item_glossary') ? <li className="muted">Not yet linked to an item in the sales glossary.</li> : null}</ul>
          )}
        </div>
      </div>

      <details className="rfold">
        <summary>Change history</summary>
        <p className="hint">Every version this recipe has had, and every action on it. Most recipes show one version, the workbook import; a version appears here each time a change is approved.</p>
        {perms.approve && !recipe.retired_at ? (
          <form action={retireRecipe} className="row" style={{ marginBottom: 12 }}><input type="hidden" name="recipe_id" value={recipe.id} /><input type="hidden" name="code" value={recipe.code} />
            <input name="reason" placeholder="reason to retire this recipe" style={{ width: 260, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6 }} /><button className="btn btn-secondary" type="submit">Retire the recipe</button>
            <span className="note">Retiring keeps every record; the recipe just stops counting as live.</span></form>) : null}
        <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <div className="tile">
          <div className="t">Versions</div>
          <div className="scroll-x"><table className="sheet" style={{ marginTop: 8 }}>
            <thead><tr><th>v</th><th>State</th><th>Who</th><th>When</th><th className="num">Cost at approval</th></tr></thead>
            <tbody>{versions.map(v => <tr key={v.version_id}><td><Link href={`${back}/v/${v.version_id}`}>v{v.version_no}</Link></td><td><State state={v.state} checkedBy={v.checked_by} /></td><td className="muted small">{(v.approved_by ?? v.checked_by ?? v.drafted_by ?? '').split('<')[0].trim()}</td><td className="muted small">{(v.approved_at ?? v.checked_at ?? v.drafted_at ?? '').slice(0, 10)}</td><td className="num">{v.unit_cost_at_approval != null ? inr(v.unit_cost_at_approval, isFG ? 2 : 4) : ''}</td></tr>)}</tbody>
          </table></div>
          {d.snapshots.length ? <><div className="t" style={{ marginTop: 14 }}>Cost history</div><ul className="small" style={{ marginTop: 6 }}>{d.snapshots.slice(0, 8).map((s, i) => <li key={i}><span className="muted">{s.as_of}, {s.snapshot_kind.replace('_', ' ')}:</span> {inr(s.unit_cost, isFG ? 2 : 4)}</li>)}</ul></> : null}
          </div>
          <div className="tile">
            <div className="t">Actions</div>
      <div className="scroll-x"><table className="sheet">
        <thead><tr><th>When</th><th>What</th><th>Who</th><th>Detail</th></tr></thead>
        <tbody>{d.events.map((e, i) => <tr key={i}><td className="muted small">{e.at.slice(0, 16).replace('T', ' ')}</td><td>{e.action}</td><td className="muted small">{(e.actor ?? '').split('<')[0].trim()}</td><td className="muted small">{e.data ? Object.entries(e.data).filter(([k, v]) => v != null && !['recipe_id', 'copied_from', 'version_id'].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 4 }) : String(v)}`).join(' · ') : ''}</td></tr>)}</tbody>
      </table></div>
          </div>
        </div>
      </details>
    </>
  );
}
