'use client';
// Admin · Items: inline edits save one field at a time (no giant form), each
// save confirmed in a status pill. Live toggle never deletes anything.
import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  setSkuActive, setSkuDepartment, setSkuTypicalQty, setSkuSortOrder, setSkuPar, addSku,
} from './actions';

type Dept = { code: string; name: string };
type Item = {
  code: string; name: string; category: string; uom: string;
  typicalQty: number | null; sortOrder: number; active: boolean;
  deptCode: string; parQty: number | null; parType: string;
};

const CATS = ['Sponge', 'Ganache', 'Sub-component'];
const UOMS = ['Pieces', 'Trays', 'Kg', 'Litre'];
const num = (v: string) => v.replace(/[^0-9.]/g, '');

export default function ItemsClient({ depts, items }: { depts: Dept[]; items: Item[] }) {
  const router = useRouter();
  const [who, setWho] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState('');

  useEffect(() => { const w = localStorage.getItem('cc-who-admin'); if (w) setWho(w); }, []);
  const actor = `admin${who ? `/${who.trim()}` : ''}`;

  async function run(key: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusyKey(key); setMsg(null);
    const res = await fn();
    setBusyKey('');
    setMsg({ ok: res.ok, text: res.message });
    if (res.ok) router.refresh();
  }

  return (
    <>
      <div className="adminsect">
        <div className="eyebrow">Add an item</div>
        <AddItemForm depts={depts} busy={busyKey === 'add'} onAdd={(input) => run('add', () => addSku(input, actor))} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div className="eyebrow" style={{ margin: 0 }}>All items</div>
        <input className="whoin" placeholder="Your name (for the audit)" style={{ width: 200 }}
          value={who} onChange={(e) => { setWho(e.target.value); localStorage.setItem('cc-who-admin', e.target.value); }} />
        {msg && <span className={msg.ok ? 'saved-pill' : 'err'}>{msg.text}</span>}
      </div>
      <div className="tablewrap admincard">
        <table className="sheet slim" style={{ border: 'none' }}>
          <thead><tr>
            <th>Live</th><th>Item</th><th>Category</th><th>Made by</th><th>Unit</th>
            <th className="num">Typical/day</th><th className="num">Par</th><th className="num">Order</th>
          </tr></thead>
          <tbody>
            {CATS.map((cat) => {
              const rows = items.filter((i) => i.category === cat);
              if (!rows.length) return null;
              return (
                <Fragment key={cat}>
                  <tr className="grouprow"><td colSpan={8}>{cat}</td></tr>
                  {rows.map((it) => (
                    <ItemRow key={it.code} it={it} depts={depts} busy={busyKey.startsWith(`it-${it.code}`)}
                      run={(field, fn) => run(`it-${it.code}-${field}`, fn)} actor={actor} />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ItemRow({ it, depts, busy, run, actor }: {
  it: Item; depts: Dept[]; busy: boolean;
  run: (field: string, fn: () => Promise<{ ok: boolean; message: string }>) => void; actor: string;
}) {
  const [typical, setTypical] = useState(it.typicalQty != null ? String(it.typicalQty) : '');
  const [par, setPar] = useState(it.parQty != null ? String(it.parQty) : '');
  const [parType, setParType] = useState(it.parType);
  const [sort, setSort] = useState(String(it.sortOrder));

  const typicalDirty = typical !== (it.typicalQty != null ? String(it.typicalQty) : '');
  const parDirty = par !== (it.parQty != null ? String(it.parQty) : '') || parType !== it.parType;
  const sortDirty = sort !== String(it.sortOrder);

  return (
    <tr style={it.active ? undefined : { opacity: 0.45 }}>
      <td>
        <button className={`livebtn ${it.active ? 'on' : ''}`} disabled={busy} title={it.active ? 'Tap to switch off' : 'Tap to make live'}
          onClick={() => run('live', () => setSkuActive(it.code, !it.active, actor))}>
          {it.active ? 'LIVE' : 'OFF'}
        </button>
      </td>
      <td className="name">{it.name} <small className="unit">{it.code}</small></td>
      <td className="unit">{it.category}</td>
      <td>
        <select value={it.deptCode} disabled={busy} style={{ minWidth: 140 }}
          onChange={(e) => run('dept', () => setSkuDepartment(it.code, e.target.value, actor))}>
          {!it.deptCode && <option value="">unassigned</option>}
          {depts.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
      </td>
      <td className="unit">{it.uom}</td>
      <td className="num">
        <span className="cellwrap">
          <input className="qtyin" style={{ width: 74 }} inputMode="decimal" value={typical}
            onChange={(e) => setTypical(num(e.target.value))} />
          {typicalDirty && <button className="usebtn" disabled={busy}
            onClick={() => run('typ', () => setSkuTypicalQty(it.code, typical === '' ? null : Number(typical), actor))}>save</button>}
        </span>
      </td>
      <td className="num">
        <span className="cellwrap">
          <select value={parType} style={{ minWidth: 100 }} onChange={(e) => setParType(e.target.value)}>
            <option value="fixed">fixed</option>
            <option value="on_demand">on demand</option>
            <option value="ready_made">ready made</option>
          </select>
          {parType === 'fixed' && (
            <input className="qtyin" style={{ width: 74 }} inputMode="decimal" value={par}
              onChange={(e) => setPar(num(e.target.value))} />
          )}
          {parDirty && <button className="usebtn" disabled={busy}
            onClick={() => run('par', () => setSkuPar(it.code, par === '' ? null : Number(par), parType, actor))}>save</button>}
        </span>
      </td>
      <td className="num">
        <span className="cellwrap">
          <input className="qtyin" style={{ width: 56 }} inputMode="numeric" value={sort}
            onChange={(e) => setSort(e.target.value.replace(/[^0-9]/g, ''))} />
          {sortDirty && <button className="usebtn" disabled={busy}
            onClick={() => run('sort', () => setSkuSortOrder(it.code, Number(sort || 0), actor))}>save</button>}
        </span>
      </td>
    </tr>
  );
}

function AddItemForm({ depts, busy, onAdd }: {
  depts: Dept[]; busy: boolean;
  onAdd: (input: { name: string; category: string; deptCode: string; uom: string; typicalQty: number | null; parQty: number | null; parType: string }) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Sponge');
  const [deptCode, setDeptCode] = useState('CK-SPONGE');
  const [uom, setUom] = useState('Pieces');
  const [typical, setTypical] = useState('');
  const [par, setPar] = useState('');
  const [parType, setParType] = useState('fixed');

  function pickCategory(c: string) {
    setCategory(c);
    if (c === 'Sponge') { setDeptCode('CK-SPONGE'); setUom('Pieces'); }
    else { setDeptCode('CK-LIQUID'); setUom('Kg'); }
  }

  return (
    <div className="addform">
      <input className="qtyin" style={{ width: 280, textAlign: 'left' }} placeholder="Item name, as the chef says it"
        value={name} onChange={(e) => setName(e.target.value)} />
      <select value={category} onChange={(e) => pickCategory(e.target.value)} style={{ minWidth: 130 }}>
        {CATS.map((c) => <option key={c}>{c}</option>)}
      </select>
      <select value={deptCode} onChange={(e) => setDeptCode(e.target.value)} style={{ minWidth: 140 }}>
        {depts.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
      </select>
      <select value={uom} onChange={(e) => setUom(e.target.value)} style={{ minWidth: 100 }}>
        {UOMS.map((u) => <option key={u}>{u}</option>)}
      </select>
      <input className="qtyin" style={{ width: 100 }} inputMode="decimal" placeholder="typical/day"
        value={typical} onChange={(e) => setTypical(num(e.target.value))} />
      <select value={parType} onChange={(e) => setParType(e.target.value)} style={{ minWidth: 110 }}>
        <option value="fixed">fixed par</option>
        <option value="on_demand">on demand</option>
        <option value="ready_made">ready made</option>
      </select>
      {parType === 'fixed' && (
        <input className="qtyin" style={{ width: 90 }} inputMode="decimal" placeholder="par"
          value={par} onChange={(e) => setPar(num(e.target.value))} />
      )}
      <button className="primary" disabled={busy || !name.trim()}
        onClick={() => onAdd({
          name, category, deptCode, uom,
          typicalQty: typical === '' ? null : Number(typical),
          parQty: par === '' ? null : Number(par), parType,
        })}>
        {busy ? 'Adding…' : 'Add item'}
      </button>
    </div>
  );
}
