'use client';
// Build 3a logbook, desktop table entry. NOTHING is pre-selected: the chef first
// chooses Made / Issued / Wasted, and for Issued chooses the destination, before
// any table appears. This prevents entering under the wrong action or department.
import { Fragment, useState } from 'react';
import { logBatch, type BatchRow } from './actions';

type Sku = { code: string; name: string; category: string; uom: string; typical_qty_per_day?: number | null };
type Dest = { code: string; name: string };
type Reason = { code: string; label_en: string; label_hi: string | null };
type DateChoice = { date: string; weekday: string; relative: string };
type Action = 'made' | 'issued' | 'wasted';

const CAT_ORDER = ['Sponge', 'Ganache', 'Sub-component'];
const ACTIONS = [
  { key: 'made', label: 'Made', ic: '＋', cls: 'made', desc: 'Batches made, into the freezer' },
  { key: 'issued', label: 'Issued', ic: '➜', cls: 'issue', desc: 'Sent to a department or a spoke' },
  { key: 'wasted', label: 'Wasted', ic: '🗑', cls: 'waste', desc: 'Reason-coded loss' },
] as const;
const destNote = (code: string) => (code.startsWith('SK-') ? 'Spoke' : code.startsWith('CK-') ? 'Department' : '');

export default function LogClient(props: {
  skus: Sku[]; destinations: Dest[]; reasons: Reason[]; enteredBy: string;
  dateChoices: DateChoice[];
}) {
  const [bizDate, setBizDate] = useState<string | null>(null);    // null = choose-day screen (first step)
  const [action, setAction] = useState<Action | null>(null);      // null = choose-action screen
  const [dest, setDest] = useState('');                           // '' = choose-destination screen
  const [madeQty, setMadeQty] = useState<Record<string, string>>({});
  const [issuedQty, setIssuedQty] = useState<Record<string, string>>({});
  const [waste, setWaste] = useState<{ skuCode: string; reasonCode: string; qty: string }[]>([{ skuCode: '', reasonCode: '', qty: '' }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const grouped = CAT_ORDER.map((c) => ({ cat: c, items: props.skus.filter((s) => s.category === c) })).filter((g) => g.items.length);
  const filled = (m: Record<string, string>) => Object.values(m).filter((v) => Number(v) > 0).length;
  const chosen = props.dateChoices.find((c) => c.date === bizDate);

  function resetEntry() { setAction(null); setDest(''); setMadeQty({}); setIssuedQty({}); setWaste([{ skuCode: '', reasonCode: '', qty: '' }]); setMsg(null); }
  function toStart() { resetEntry(); }
  function changeDay() { setBizDate(null); resetEntry(); }        // back to the choose-day screen
  function chooseAction(a: Action) { setAction(a); setDest(''); setMsg(null); }

  async function saveTable(kind: 'made' | 'issued') {
    const map = kind === 'made' ? madeQty : issuedQty;
    const rows: BatchRow[] = Object.entries(map)
      .map(([skuCode, v]) => ({ skuCode, action: kind, qty: Number(v), destCode: kind === 'issued' ? dest : null }))
      .filter((r) => r.qty > 0);
    if (!rows.length) { setMsg({ ok: false, text: 'Type at least one quantity' }); return; }
    setBusy(true); setMsg(null);
    const res = await logBatch(rows, props.enteredBy, bizDate!);
    setBusy(false); setMsg({ ok: res.ok, text: res.message });
    if (res.ok) kind === 'made' ? setMadeQty({}) : setIssuedQty({});
  }
  async function saveWaste() {
    const rows: BatchRow[] = waste.filter((w) => w.skuCode && w.reasonCode && Number(w.qty) > 0)
      .map((w) => ({ skuCode: w.skuCode, action: 'wasted', qty: Number(w.qty), reasonCode: w.reasonCode }));
    if (!rows.length) { setMsg({ ok: false, text: 'Add at least one wastage row (item, reason, quantity)' }); return; }
    setBusy(true); setMsg(null);
    const res = await logBatch(rows, props.enteredBy, bizDate!);
    setBusy(false); setMsg({ ok: res.ok, text: res.message });
    if (res.ok) setWaste([{ skuCode: '', reasonCode: '', qty: '' }]);
  }
  const setQty = (map: Record<string, string>, setter: (m: Record<string, string>) => void, code: string, v: string) =>
    setter({ ...map, [code]: v.replace(/[^0-9.]/g, '') });

  const Header = () => (
    <div className="topbar">
      <span className="brand">Creme Castle</span>
      <span className="sub">Kitchen &middot; Sponge &amp; Ganache logbook</span>
      {bizDate && chosen && (
        <span className="when">
          {chosen.relative}, {chosen.weekday} {chosen.date}
          <button className="changebtn" onClick={changeDay}>change day</button>
        </span>
      )}
    </div>
  );

  function Sheet({ map, setter, showUsual }: { map: Record<string, string>; setter: (m: Record<string, string>) => void; showUsual: boolean }) {
    return (
      <table className="sheet">
        <thead><tr><th>Item</th><th>Unit</th>{showUsual && <th className="num">Usual/day</th>}<th className="num">Quantity</th></tr></thead>
        <tbody>
          {grouped.map((g) => (
            <Fragment key={g.cat}>
              <tr className="grouprow"><td colSpan={showUsual ? 4 : 3}>{g.cat}</td></tr>
              {g.items.map((s) => (
                <tr key={s.code}>
                  <td className="name">{s.name}</td>
                  <td className="unit">{s.uom}</td>
                  {showUsual && (
                    <td className="num usual">{s.typical_qty_per_day ?? ''}{s.typical_qty_per_day != null && (
                      <> <button className="usebtn" onClick={() => setQty(map, setter, s.code, String(s.typical_qty_per_day))}>use</button></>
                    )}</td>
                  )}
                  <td className="num">
                    <input className={`qtyin ${Number(map[s.code]) > 0 ? 'filled' : ''}`} inputMode="decimal"
                      value={map[s.code] ?? ''} placeholder="0" onChange={(e) => setQty(map, setter, s.code, e.target.value)} />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    );
  }
  const SaveBar = ({ n, onSave }: { n: number; onSave: () => void }) => (
    <div className="savebar">
      <button className="primary" disabled={busy || n === 0} onClick={onSave}>{busy ? 'Saving…' : 'Save all'}</button>
      <span className="count">{n} item{n === 1 ? '' : 's'} filled</span>
      {msg && <span className={msg.ok ? 'saved-pill' : 'err'}>{msg.text}</span>}
    </div>
  );

  // 0) choose the day first (nothing pre-selected). The kitchen runs 24 hours and
  // production crosses midnight, so the chef states which day a batch is for.
  if (!bizDate) return (
    <main><Header />
      <h1 className="step">Which day&rsquo;s production?</h1>
      <p className="hint">Pick the day these batches were made. Pick yesterday if you are catching up a day you missed.</p>
      <div className="choose">
        {props.dateChoices.map((c) => (
          <button key={c.date} className="pickbtn" onClick={() => { setBizDate(c.date); setMsg(null); }}>
            <span><span className="t">{c.relative}</span><br /><span className="d">{c.weekday} &middot; {c.date}</span></span>
          </button>
        ))}
      </div>
    </main>
  );

  // 1) choose action (nothing pre-selected)
  if (!action) return (
    <main><Header />
      <h1 className="step">What are you entering?</h1>
      <div className="choose">
        {ACTIONS.map((a) => (
          <button key={a.key} className={`pickbtn ${a.cls}`} onClick={() => chooseAction(a.key)}>
            <span className="ic">{a.ic}</span>
            <span><span className="t">{a.label}</span><br /><span className="d">{a.desc}</span></span>
          </button>
        ))}
      </div>
    </main>
  );

  const destName = props.destinations.find((d) => d.code === dest)?.name;

  // 2) issued: choose destination first (no default)
  if (action === 'issued' && !dest) return (
    <main><Header />
      <div className="crumb"><button className="changebtn" onClick={toStart}>&larr; Change</button><span className="now">Issued</span></div>
      <h1 className="step">Where are you issuing to?</h1>
      <p className="hint">Pick the department or spoke first. Then you fill quantities.</p>
      <div className="destgrid">
        {props.destinations.map((d) => (
          <button key={d.code} className="destbtn" onClick={() => { setDest(d.code); setMsg(null); }}>
            {d.name}<small>{destNote(d.code)}</small>
          </button>
        ))}
      </div>
    </main>
  );

  // 3) tables
  return (
    <main><Header />
      <div className="crumb">
        <button className="changebtn" onClick={toStart}>&larr; Change</button>
        <span className="now">
          {action === 'made' ? 'Made' : action === 'wasted' ? 'Wasted' : `Issued → ${destName}`}
        </span>
        {action === 'issued' && <button className="changebtn" onClick={() => { setDest(''); setIssuedQty({}); setMsg(null); }}>change department</button>}
      </div>

      {action === 'made' && (<>
        <p className="hint">Type the quantity made against each item. Leave the rest blank. Then Save all.</p>
        <Sheet map={madeQty} setter={setMadeQty} showUsual />
        <SaveBar n={filled(madeQty)} onSave={() => saveTable('made')} />
      </>)}

      {action === 'issued' && (<>
        <p className="hint">Fill the quantities issued to <strong>{destName}</strong>, then Save all.</p>
        <Sheet map={issuedQty} setter={setIssuedQty} showUsual={false} />
        <SaveBar n={filled(issuedQty)} onSave={() => saveTable('issued')} />
      </>)}

      {action === 'wasted' && (<>
        <p className="hint">Pick the item and reason, type the quantity. Add more rows if needed.</p>
        {waste.map((w, i) => (
          <div className="wrow" key={i}>
            <select value={w.skuCode} onChange={(e) => setWaste(waste.map((x, j) => j === i ? { ...x, skuCode: e.target.value } : x))}>
              <option value="">Item…</option>
              {props.skus.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            <select value={w.reasonCode} onChange={(e) => setWaste(waste.map((x, j) => j === i ? { ...x, reasonCode: e.target.value } : x))}>
              <option value="">Reason…</option>
              {props.reasons.map((r) => <option key={r.code} value={r.code}>{r.label_en}</option>)}
            </select>
            <input className="qtyin" inputMode="decimal" placeholder="Qty" value={w.qty}
              onChange={(e) => setWaste(waste.map((x, j) => j === i ? { ...x, qty: e.target.value.replace(/[^0-9.]/g, '') } : x))} />
            <button className="linkbtn" title="remove" onClick={() => { const n = waste.filter((_, j) => j !== i); setWaste(n.length ? n : [{ skuCode: '', reasonCode: '', qty: '' }]); }}>&times;</button>
          </div>
        ))}
        <button className="ghostbtn" onClick={() => setWaste([...waste, { skuCode: '', reasonCode: '', qty: '' }])}>+ Add row</button>
        <SaveBar n={waste.filter((w) => w.skuCode && w.reasonCode && Number(w.qty) > 0).length} onSave={saveWaste} />
      </>)}
    </main>
  );
}
