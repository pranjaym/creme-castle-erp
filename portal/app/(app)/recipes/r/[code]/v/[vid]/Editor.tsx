'use client';

// The draft editor. Team screen: plain inputs, one decision per row, the cost
// updating as you type (the same rule as the database, mirrored in
// lib/recipes-engine). Saving posts the lines as JSON to one server action, which
// calls recipes.set_lines; sending for check is the same save plus one more step.
import { useMemo, useState } from 'react';
import { saveDraft } from '../../../../actions';
import { inr, pct, rateLabel, unitShort } from '@/lib/recipes-engine';

interface Line { role: 'material' | 'packaging'; ingredient_sku_id: number | null; sub_recipe_id: number | null; qty: number; unit: string; name: string; code: string; kind: string; rate: number | null; rate_unit: string }
interface Pick { id: number; code: string; name: string; base_unit?: string; output_unit?: string; rate?: number | null; unit_cost?: number | null; kind?: string; sku_type?: string }
interface Props {
  versionId: number; back: string; isFinished: boolean;
  initial: { output_qty: number; output_unit: string; sold_weight_g: number | null; lines: Line[] };
  picks: { ingredients: Pick[]; recipes: Pick[] };
  settings: { allowance: number; target: number };
  price: { selling_price: number | null; packaging_charge: number | null } | null;
  liveUnitCost: number | null;
}

export default function Editor({ versionId, back, isFinished, initial, picks, settings, price, liveUnitCost }: Props) {
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [outQty, setOutQty] = useState<number>(initial.output_qty);
  const [outUnit, setOutUnit] = useState<string>(initial.output_unit);
  const [sold, setSold] = useState<string>(initial.sold_weight_g != null ? String(initial.sold_weight_g) : '');
  const [search, setSearch] = useState('');
  const [addRole, setAddRole] = useState<'material' | 'packaging'>('material');

  const options = useMemo(() => {
    const s = search.trim().toLowerCase(); if (s.length < 2) return [];
    const ing = picks.ingredients.filter(i => i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s)).slice(0, 8).map(i => ({ ...i, isRecipe: false }));
    const rec = picks.recipes.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s)).slice(0, 8).map(r => ({ ...r, isRecipe: true }));
    return [...rec, ...ing];
  }, [search, picks]);

  const add = (p: Pick & { isRecipe: boolean }) => {
    const unit = p.isRecipe ? (p.output_unit ?? 'gram') : (p.base_unit ?? 'gram');
    setLines(ls => [...ls, { role: addRole, ingredient_sku_id: p.isRecipe ? null : p.id, sub_recipe_id: p.isRecipe ? p.id : null, qty: 0, unit, name: p.name, code: p.code,
      kind: p.isRecipe ? (p.kind ?? 'intermediate') : (p.sku_type === 'packaging' ? 'packaging' : 'raw'), rate: p.isRecipe ? (p.unit_cost ?? null) : (p.rate ?? null), rate_unit: unit }]);
    setSearch('');
  };
  const setQty = (i: number, v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, qty: Number(v) || 0 } : l));
  const remove = (i: number) => setLines(ls => ls.filter((_, j) => j !== i));

  const material = lines.filter(l => l.role === 'material'); const packaging = lines.filter(l => l.role === 'packaging');
  const batch = material.reduce((s, l) => s + l.qty * (l.rate ?? 0), 0);
  const packCost = packaging.reduce((s, l) => s + l.qty * (l.rate ?? 0), 0);
  const missing = lines.filter(l => l.rate == null).length;
  const unit = outQty > 0 ? batch / outQty : 0;
  const inputW = material.filter(l => l.unit === 'gram' || l.unit === 'millilitre').reduce((s, l) => s + l.qty, 0);
  const allWeight = material.length > 0 && material.every(l => l.unit === 'gram' || l.unit === 'millilitre');
  const yieldPct = !isFinished && allWeight && (outUnit === 'gram' || outUnit === 'millilitre') && inputW ? outQty / inputW : null;
  const sp = price?.selling_price ?? 0; const pc = price?.packaging_charge ?? 0;
  const withAllow = unit * (1 + settings.allowance / 100);
  const fcPack = sp > 0 ? (withAllow + packCost) / (sp + pc) : null;
  const payload = JSON.stringify(lines.map(l => ({ role: l.role, ingredient_sku_id: l.ingredient_sku_id, sub_recipe_id: l.sub_recipe_id, qty: l.qty, unit: l.unit })));

  const row = (l: Line, i: number) => (
    <tr key={i}>
      <td>{l.name}{l.role === 'packaging' ? <span className="muted small"> (packaging)</span> : null}</td>
      <td><span className={'pill ' + (l.kind === 'finished' ? 'pill-warn' : 'pill-neutral')}>{l.kind === 'raw' ? 'purchased' : l.kind === 'packaging' ? 'packaging' : 'semi-finished'}</span></td>
      <td className="num"><input id={`qty-${i}`} type="number" step="any" min="0" value={l.qty} onChange={e => setQty(i, e.target.value)} style={{ width: 96, textAlign: 'right' }} /> <span className="muted">{unitShort(l.unit)}</span></td>
      <td className="num">{l.rate != null ? rateLabel(l.rate, l.rate_unit) : <span className="pill pill-danger">no rate</span>}</td>
      <td className="num">{inr(l.qty * (l.rate ?? 0))}</td>
      <td className="num">{batch && l.role === 'material' ? pct(l.qty * (l.rate ?? 0) / batch, 0) : ''}</td>
      <td><button type="button" className="linkbtn" onClick={() => remove(i)}>remove</button></td>
    </tr>);

  return (
    <div>
      <div className="scroll-x"><table className="sheet">
        <thead><tr><th>Ingredient</th><th></th><th className="num">Quantity</th><th className="num">Rate</th><th className="num">Amount</th><th className="num">Share</th><th></th></tr></thead>
        <tbody>
          {lines.map((l, i) => l.role === 'material' ? row(l, i) : null)}
          <tr><td colSpan={2}><b>Batch</b> <span className="muted small">{material.length} lines{allWeight ? `, ${inputW.toLocaleString('en-IN')} g/ml in` : ''}</span></td><td></td><td></td><td className="num"><b>{inr(batch)}</b></td><td></td><td></td></tr>
          <tr><td colSpan={2}><b>This batch makes</b></td>
            <td className="num"><input id="out-qty" type="number" step="any" min="0" value={outQty} onChange={e => setOutQty(Number(e.target.value) || 0)} style={{ width: 96, textAlign: 'right' }} />{' '}
              {isFinished ? <span className="muted">sold unit(s)</span> : <select id="out-unit" value={outUnit} onChange={e => setOutUnit(e.target.value)}><option value="gram">g</option><option value="millilitre">ml</option><option value="piece">pc</option><option value="set">set</option></select>}</td>
            <td colSpan={4} className="muted small">{yieldPct != null ? `= yield ${pct(yieldPct, 0)} of what went in` : isFinished ? <>of <input id="sold-g" type="number" placeholder="sold weight g" value={sold} onChange={e => setSold(e.target.value)} style={{ width: 90 }} /> g each</> : ''}</td></tr>
          <tr><td colSpan={2}><b>Unit cost</b> <span className="muted small">= {inr(batch)} ÷ {outQty}</span></td><td></td><td></td><td className="num"><b style={{ fontSize: 16 }}>{isFinished ? inr(unit) : inr(unit, 4)}</b><div className="muted small">per {isFinished ? 'sold unit' : unitShort(outUnit)}{liveUnitCost != null ? `, live is ${isFinished ? inr(liveUnitCost) : inr(liveUnitCost, 4)}` : ''}</div></td><td></td><td></td></tr>
          {isFinished ? <>
            {lines.map((l, i) => l.role === 'packaging' ? row(l, i) : null)}
            <tr><td colSpan={2}><b>Packaging per unit</b></td><td></td><td></td><td className="num"><b>{inr(packCost)}</b></td><td></td><td></td></tr>
            {price ? <tr><td colSpan={2}><b>Food cost with packaging</b> <span className="muted small">at {inr(sp, 0)} + {inr(pc, 0)}, allowance {settings.allowance}%</span></td><td></td><td></td><td className="num"><b>{pct(fcPack)}</b></td><td></td><td></td></tr> : null}
          </> : null}
          {missing ? <tr><td colSpan={7}><span className="pill pill-danger">{missing} line{missing === 1 ? '' : 's'} without a rate, costed at zero</span></td></tr> : null}
        </tbody>
      </table></div>

      <div className="tile" style={{ marginTop: 12 }}>
        <div className="t">Add a line</div>
        <div className="row" style={{ marginTop: 6 }}>
          <select id="add-role" value={addRole} onChange={e => setAddRole(e.target.value as 'material' | 'packaging')}><option value="material">ingredient or semi-finished</option>{isFinished ? <option value="packaging">packaging</option> : null}</select>
          <input id="add-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a name or SupplyNote code" style={{ minWidth: 300, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
        </div>
        {options.length ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {options.map(o => <li key={(o.isRecipe ? 'r' : 'i') + o.id}><button type="button" className="btn btn-secondary" onClick={() => add(o)}>{o.name} <span className="muted small">{o.isRecipe ? 'semi-finished' : o.code}</span></button></li>)}
          </ul>) : search.trim().length >= 2 ? <p className="note">Nothing matches. An ingredient must exist in SupplyNote first; ask controls to add it.</p> : null}
      </div>

      <form action={saveDraft} className="row" style={{ marginTop: 14 }}>
        <input type="hidden" name="version_id" value={versionId} /><input type="hidden" name="back" value={back} />
        <input type="hidden" name="lines" value={payload} /><input type="hidden" name="output_qty" value={outQty} /><input type="hidden" name="output_unit" value={isFinished ? 'piece' : outUnit} /><input type="hidden" name="sold_weight_g" value={sold} />
        <input id="draft-note" name="note" placeholder="note for the checker (what changed and why)" style={{ minWidth: 320, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
        <button className="btn btn-secondary" type="submit" name="then" value="save">Save draft</button>
        <button className="btn btn-primary" type="submit" name="then" value="submit">Save and send for checking</button>
      </form>
    </div>
  );
}
