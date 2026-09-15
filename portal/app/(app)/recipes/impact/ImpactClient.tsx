'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { makeEngine, reach, inr, pct, rateLabel, fromBase, toBase, perLabel, type EngineModel } from '@/lib/recipes-engine';

interface Props { model: EngineModel; settings: { allowance: number; target: number }; prices: Record<number, { sp: number; pc: number }>; initialSku: number | null }

export default function ImpactClient({ model, settings, prices, initialSku }: Props) {
  const ingredients = useMemo(() => Object.values(model.ingredients).sort((a, b) => a.name.localeCompare(b.name)), [model]);
  const [sku, setSku] = useState<number>(initialSku ?? ingredients.find(i => i.code === 'CC00043')?.id ?? ingredients[0]?.id);
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [draft, setDraft] = useState<string>('');
  const ing = model.ingredients[sku];
  const base = useMemo(() => makeEngine(model), [model]);
  const cur = useMemo(() => makeEngine(model, overrides), [model, overrides]);
  const fc = (rid: number, c: { unit: number; packaging: number } | null) => { const p = prices[rid]; if (!c || !p || p.sp <= 0) return null; return (c.unit * (1 + settings.allowance / 100) + c.packaging) / (p.sp + p.pc); };
  const moved = useMemo(() => Object.values(model.recipes).filter(r => r.kind === 'finished').map(r => {
    const b = base.costRecipe(r.id); const c = cur.costRecipe(r.id); const d = (c?.unit ?? 0) - (b?.unit ?? 0);
    return { r, b, c, d };
  }).filter(x => Math.abs(x.d) > 1e-9).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)), [model, base, cur]);
  const apply = () => { const v = Number(draft); if (!ing || !Number.isFinite(v)) return; setOverrides(o => ({ ...o, [sku]: toBase(v, ing.base_unit) })); };
  const reachN = ing ? reach(model, { sku: ing.id }).length : 0;
  const verdict = (v: number | null) => v == null ? <span className="pill pill-neutral">no price</span> : v <= settings.target / 100 ? <span className="pill pill-ok">within target</span> : v <= settings.target / 100 + 0.05 ? <span className="pill pill-warn">near target</span> : <span className="pill pill-danger">above target</span>;

  return (
    <>
      <div className="tile">
        <div className="row">
          <label className="small">Ingredient<br />
            <select id="imp-sku" value={sku} onChange={e => { setSku(Number(e.target.value)); setDraft(''); }} style={{ minWidth: 280 }}>
              {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select></label>
          {ing ? <label className="small">New rate {perLabel(ing.base_unit)}<br /><input id="imp-rate" type="number" step="0.01" value={draft} placeholder={ing.rate != null ? fromBase(overrides[sku] ?? ing.rate, ing.base_unit).toFixed(2) : ''} onChange={e => setDraft(e.target.value)} style={{ width: 130 }} /></label> : null}
          <button type="button" className="btn btn-primary" onClick={apply}>Try it</button>
          {ing ? <span className="muted small">today {rateLabel(ing.rate, ing.base_unit)}, reaches {reachN} finished goods · <Link href={'/recipes/ingredients/' + ing.id}>open ingredient</Link></span> : null}
        </div>
        {Object.keys(overrides).length ? (
          <p className="small" style={{ marginTop: 10 }}>What-ifs: {Object.entries(overrides).map(([k, v]) => <span key={k} className="pill pill-warn" style={{ marginRight: 6 }}>{model.ingredients[Number(k)]?.name} {rateLabel(v, model.ingredients[Number(k)]?.base_unit ?? 'gram')}</span>)}
            <button type="button" className="linkbtn" onClick={() => setOverrides({})}>clear all</button></p>) : <p className="note">No what-if yet.</p>}
      </div>
      {moved.length ? (
        <>
          <h2 className="sec-head">{moved.length} finished goods move</h2>
          <div className="scroll-x"><table className="sheet">
            <thead><tr><th>Finished good</th><th className="num">Cost before</th><th className="num">Cost after</th><th className="num">Change</th><th className="num">Food cost before</th><th className="num">Food cost after</th><th></th></tr></thead>
            <tbody>{moved.map(x => (
              <tr key={x.r.id}><td><Link href={'/recipes/r/' + encodeURIComponent(x.r.code)}>{x.r.name}</Link></td>
                <td className="num">{inr(x.b?.unit)}</td><td className="num">{inr(x.c?.unit)}</td>
                <td className="num">{(x.d >= 0 ? '+' : '') + inr(x.d)} <span className="muted small">({x.b?.unit ? pct(x.d / x.b.unit) : ''})</span></td>
                <td className="num">{pct(fc(x.r.id, x.b))}</td><td className="num">{pct(fc(x.r.id, x.c))}</td><td>{verdict(fc(x.r.id, x.c))}</td></tr>))}</tbody>
          </table></div>
        </>) : null}
    </>
  );
}
