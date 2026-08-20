'use client';
// Department screen: a hub with six actions. Nothing is pre-selected: the team
// always states the day (department default highlighted) and the action before
// any quantity can be typed. Phone-first: big targets, one decision per screen.
// Transfers are two-sided (receiver confirms) and exist in both directions:
// push (Sent without being asked) and pull (a Request raised on the maker).
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  logDeptBatch, confirmReceipt, saveClosing, createRequests, cancelRequest, savePlan,
  type DeptBatchRow, type ClosingRow, type RequestRow, type PlanSaveRow,
} from './actions';
import { logout } from '@/app/login/actions';

type Sku = { code: string; name: string; category: string; uom: string; typical_qty_per_day?: number | null };
type Dest = { code: string; name: string };
type Reason = { code: string; label_en: string; label_hi: string | null };
type DateChoice = { date: string; weekday: string; relative: string };
type InboxItem = { logId: number; skuName: string; skuCode: string; qty: number; uom: string; fromName: string; sentAt: string; sentBy: string; businessDate: string };
type LedgerRow = { date: string; skuCode: string; skuName: string; uom: string; planned: number | null; opening: number | null; made: number; received: number; pending: number; sent: number; wasted: number; closing: number | null; gap: number | null };
type Entry = { id: number; businessDate: string; action: string; qty: number; uom: string; skuName: string; destName: string | null; reasonCode: string | null; enteredBy: string; enteredAt: string };
type Requestable = { deptCode: string; deptName: string; items: Sku[] };
type PlanRowT = {
  skuCode: string; name: string; category: string; uom: string;
  parQty: number | null; parType: string; onHand: number | null;
  requestedQty: number; suggested: number; existingPlanned: number | null;
};
type PlanDataT = { planDate: string; closingDate: string; closingExists: boolean; rows: PlanRowT[] };
type Req = {
  id: number; skuCode: string; skuName: string; uom: string;
  requestedQty: number; sentQty: number; remainingQty: number;
  state: 'open' | 'partial' | 'fulfilled' | 'cancelled';
  neededBy: string | null; note: string | null; cancelReason: string | null;
  requesterCode: string; requesterName: string; makerCode: string; makerName: string;
  enteredBy: string; enteredAt: string;
};

type Screen = 'home' | 'made' | 'issued' | 'wasted' | 'closing' | 'receive' | 'request' | 'plan';

const ACTION_META: Record<string, { label: string; hi: string; ic: string; cls: string; desc: string }> = {
  made:    { label: 'Made',    hi: 'बनाया',  ic: '＋', cls: 'made',  desc: 'What the team produced' },
  issued:  { label: 'Sent',    hi: 'भेजा',   ic: '➜', cls: 'issue', desc: 'To a department or a spoke' },
  wasted:  { label: 'Waste',   hi: 'खराब',   ic: '🗑', cls: 'waste', desc: 'Reason-coded loss' },
  closing: { label: 'Closing', hi: 'गिनती',  ic: '☰', cls: 'close', desc: 'End-of-day physical count' },
  receive: { label: 'Receive', hi: 'प्राप्त', ic: '⬇', cls: 'recv',  desc: 'Confirm what arrived' },
  request: { label: 'Request', hi: 'मांग',   ic: '？', cls: 'req',   desc: 'Ask another department' },
  plan:    { label: 'Plan',    hi: 'प्लान',  ic: '📋', cls: 'plan',  desc: 'What to make next' },
};
const STATE_META: Record<Req['state'], { label: string; cls: string }> = {
  open:      { label: 'Waiting',   cls: 'st-open' },
  partial:   { label: 'Part sent', cls: 'st-partial' },
  fulfilled: { label: 'Done',      cls: 'st-done' },
  cancelled: { label: 'Closed',    cls: 'st-cancel' },
};

const num = (v: string) => v.replace(/[^0-9.]/g, '');
const fmt = (n: number | null) => (n == null ? '' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
const istClock = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

export default function DeptClient(props: {
  account: { email: string; role: string };
  mode: 'trial' | 'live';
  dept: { code: string; name: string };
  settings: { dayStart: string; closingBefore: string };
  skus: Sku[]; destinations: Dest[]; reasons: Reason[];
  requestables: Requestable[]; incomingRequests: Req[]; outgoingRequests: Req[];
  inbox: InboxItem[]; ledger: LedgerRow[]; recentEntries: Entry[];
  planDatas: PlanDataT[];
  dateChoices: DateChoice[]; openDay: string;
  glanceDay: string; glanceChoices: { date: string; weekday: string }[];
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>('home');
  const [bizDate, setBizDate] = useState<string | null>(null);
  const [dest, setDest] = useState('');
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});
  const [reqLinks, setReqLinks] = useState<Record<string, number>>({});
  const [askDept, setAskDept] = useState('');
  const [neededBy, setNeededBy] = useState<string | null>(null);
  const [waste, setWaste] = useState<{ skuCode: string; reasonCode: string; qty: string }[]>([{ skuCode: '', reasonCode: '', qty: '' }]);
  const [closingMap, setClosingMap] = useState<Record<string, { total: string; split: boolean; b: [string, string, string, string] }>>({});
  const [planDate, setPlanDate] = useState('');
  const [planMap, setPlanMap] = useState<Record<string, string>>({});
  const [planCta, setPlanCta] = useState(false);
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(`cc-who-${props.dept.code}`);
    if (saved) setWho(saved);
  }, [props.dept.code]);
  function saveWho(v: string) {
    setWho(v);
    localStorage.setItem(`cc-who-${props.dept.code}`, v);
  }
  const enteredBy = `${props.dept.code.toLowerCase().replace('ck-', '')}-dept${who ? `/${who.trim()}` : ''}`;

  const grouped = useMemo(() => {
    const cats = [...new Set(props.skus.map((s) => s.category))];
    return cats.map((c) => ({ cat: c, items: props.skus.filter((s) => s.category === c) })).filter((g) => g.items.length);
  }, [props.skus]);

  const chosen = props.dateChoices.find((c) => c.date === bizDate);
  const openChoice = props.dateChoices.find((c) => c.date === props.openDay);
  const glanceMeta = props.glanceChoices.find((c) => c.date === props.glanceDay);

  function goHome() {
    setScreen('home'); setBizDate(null); setDest(''); setQtyMap({}); setReqLinks({});
    setAskDept(''); setNeededBy(null);
    setWaste([{ skuCode: '', reasonCode: '', qty: '' }]); setClosingMap({}); setMsg(null);
    router.refresh();
  }
  function start(s: Screen) {
    setMsg(null); setQtyMap({}); setDest(''); setReqLinks({});
    if (s === 'closing') setBizDate(props.openDay);
    else setBizDate(null);
    if (s === 'request') {
      setAskDept(props.requestables.length === 1 ? props.requestables[0].deptCode : '');
      setNeededBy(null);
      setBizDate(props.openDay); // requests are raised now; no day question needed
    }
    if (s === 'plan') openPlan(props.planDatas[0]?.planDate ?? '');
    setScreen(s);
  }
  /** Jump into the Sent flow pre-filled from one incoming request. */
  function startSendForRequest(r: Req) {
    setMsg(null);
    setScreen('issued');
    setBizDate(props.openDay);
    setDest(r.requesterCode);
    setQtyMap({ [r.skuCode]: String(r.remainingQty) });
    setReqLinks({ [r.skuCode]: r.id });
  }

  async function saveMovement(kind: 'made' | 'issued') {
    const rows: DeptBatchRow[] = Object.entries(qtyMap)
      .map(([skuCode, v]) => ({
        skuCode, action: kind, qty: Number(v),
        destCode: kind === 'issued' ? dest : null,
        requestId: kind === 'issued' ? (reqLinks[skuCode] ?? null) : null,
      }))
      .filter((r) => r.qty > 0);
    if (!rows.length) { setMsg({ ok: false, text: 'Type at least one quantity' }); return; }
    setBusy(true); setMsg(null);
    const res = await logDeptBatch(props.dept.code, rows, enteredBy, bizDate!);
    setBusy(false); setMsg({ ok: res.ok, text: res.message });
    if (res.ok) { setQtyMap({}); setReqLinks({}); router.refresh(); }
  }
  async function saveWaste() {
    const rows: DeptBatchRow[] = waste.filter((w) => w.skuCode && w.reasonCode && Number(w.qty) > 0)
      .map((w) => ({ skuCode: w.skuCode, action: 'wasted', qty: Number(w.qty), reasonCode: w.reasonCode }));
    if (!rows.length) { setMsg({ ok: false, text: 'Add at least one row (item, reason, quantity)' }); return; }
    setBusy(true); setMsg(null);
    const res = await logDeptBatch(props.dept.code, rows, enteredBy, bizDate!);
    setBusy(false); setMsg({ ok: res.ok, text: res.message });
    if (res.ok) { setWaste([{ skuCode: '', reasonCode: '', qty: '' }]); router.refresh(); }
  }
  async function submitClosing() {
    const rows: ClosingRow[] = Object.entries(closingMap).map(([skuCode, v]) => {
      if (v.split) {
        return {
          skuCode,
          today: v.b[0] === '' ? null : Number(v.b[0]),
          oneDay: v.b[1] === '' ? null : Number(v.b[1]),
          twoDay: v.b[2] === '' ? null : Number(v.b[2]),
          older: v.b[3] === '' ? null : Number(v.b[3]),
        };
      }
      return { skuCode, totalOnly: v.total === '' ? null : Number(v.total) };
    }).filter((r) => Object.values(r).some((x) => typeof x === 'number' && !Number.isNaN(x)));
    if (!rows.length) { setMsg({ ok: false, text: 'Count at least one item before saving' }); return; }
    setBusy(true); setMsg(null);
    const res = await saveClosing(props.dept.code, bizDate!, rows, enteredBy);
    setBusy(false); setMsg({ ok: res.ok, text: res.message });
    if (res.ok) { setClosingMap({}); setPlanCta(true); router.refresh(); }
  }
  async function submitRequest() {
    const rows: RequestRow[] = Object.entries(qtyMap)
      .map(([skuCode, v]) => ({ skuCode, qty: Number(v) })).filter((r) => r.qty > 0);
    if (!rows.length) { setMsg({ ok: false, text: 'Type at least one quantity' }); return; }
    setBusy(true); setMsg(null);
    const res = await createRequests(props.dept.code, askDept, rows, neededBy, null, enteredBy);
    setBusy(false); setMsg({ ok: res.ok, text: res.message });
    if (res.ok) { setQtyMap({}); router.refresh(); }
  }

  function openPlan(date: string) {
    setPlanDate(date);
    const pd = props.planDatas.find((d) => d.planDate === date);
    const pre: Record<string, string> = {};
    for (const r of pd?.rows ?? []) {
      // prefill: an already-saved plan wins (editing replaces), else the suggestion
      const v = r.existingPlanned ?? r.suggested;
      pre[r.skuCode] = v > 0 || r.existingPlanned != null ? String(v) : '';
    }
    setPlanMap(pre);
  }
  async function submitPlan() {
    const rows: PlanSaveRow[] = Object.entries(planMap)
      .filter(([, v]) => v !== '' && !Number.isNaN(Number(v)))
      .map(([skuCode, v]) => ({ skuCode, planned: Number(v) }));
    if (!rows.length) { setMsg({ ok: false, text: 'Fill at least one item (blank rows are skipped)' }); return; }
    setBusy(true); setMsg(null);
    const res = await savePlan(props.dept.code, planDate, rows, enteredBy);
    setBusy(false); setMsg({ ok: res.ok, text: res.message });
    if (res.ok) router.refresh();
  }

  const BackToConsole = () => (props.account.role !== 'department' ? (
    <div className="backbar">
      <a href="/admin">&larr; Kitchen console</a>
      <span>viewing the {props.dept.name} screen as the team sees it</span>
    </div>
  ) : null);

  const TrialBar = () => (props.mode === 'trial' ? (
    <div className="trialbar">
      <strong>TRIAL</strong> practice run: enter real work as usual. Everything here is cleared when the real start begins.
    </div>
  ) : null);

  const Header = ({ sub }: { sub?: string }) => (
    <div className="topbar">
      <span className="brand">Creme Castle</span>
      <span className="sub">{props.dept.name}{sub ? ` · ${sub}` : ''}</span>
      <span className="when">
        <input
          className="whoin" placeholder="Your name" value={who}
          onChange={(e) => saveWho(e.target.value)} aria-label="Who is entering"
        />
        <span className="acctag" title={props.account.email}>{props.account.email.split('@')[0]}</span>
        <button className="signout" onClick={() => logout()}>sign out</button>
      </span>
    </div>
  );

  const DayPicker = ({ title, hint }: { title: string; hint: string }) => (
    <>
      <h1 className="step">{title}</h1>
      <p className="hint">{hint}</p>
      <div className="choose">
        {props.dateChoices.map((c) => (
          <button key={c.date} className={`pickbtn ${c.date === props.openDay ? 'suggested' : ''}`}
            onClick={() => { setBizDate(c.date); setMsg(null); }}>
            <span>
              <span className="t">{c.relative}</span>
              {c.date === props.openDay && <span className="sugg">your shift&rsquo;s day</span>}
              <br /><span className="d">{c.weekday} &middot; {c.date}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );

  function QtySheet({ items, showUsual }: { items?: { cat: string; items: Sku[] }[]; showUsual: boolean }) {
    const groups = items ?? grouped;
    return (
      <div className="entrylist">
        {groups.map((g) => (
          <Fragment key={g.cat}>
            <div className="entrycat">{g.cat}</div>
            {g.items.map((s) => (
              <label className="entryrow" key={s.code}>
                <span className="ename">{s.name}<small>{s.uom}{showUsual && s.typical_qty_per_day != null ? ` · usual ${fmt(s.typical_qty_per_day)}/day` : ''}</small></span>
                <input className={`qtyin big ${Number(qtyMap[s.code]) > 0 ? 'filled' : ''}`} inputMode="decimal" placeholder="0"
                  value={qtyMap[s.code] ?? ''} onChange={(e) => setQtyMap({ ...qtyMap, [s.code]: num(e.target.value) })} />
              </label>
            ))}
          </Fragment>
        ))}
      </div>
    );
  }
  const filledCount = Object.values(qtyMap).filter((v) => Number(v) > 0).length;
  const SaveBar = ({ n, onSave, label }: { n: number; onSave: () => void; label?: string }) => (
    <div className="savebar">
      <button className="primary" disabled={busy || n === 0} onClick={onSave}>{busy ? 'Saving…' : (label ?? 'Save all')}</button>
      <span className="count">{n} item{n === 1 ? '' : 's'}</span>
      {msg && <span className={msg.ok ? 'saved-pill' : 'err'}>{msg.text}</span>}
    </div>
  );
  const Crumb = ({ label, extra }: { label: string; extra?: React.ReactNode }) => (
    <div className="crumb">
      <button className="changebtn" onClick={goHome}>&larr; Home</button>
      <span className="now">{label}</span>
      {bizDate && chosen && screen !== 'home' && screen !== 'request' && (
        <span className="daytag">{chosen.relative} &middot; {chosen.weekday} {chosen.date}</span>
      )}
      {extra}
    </div>
  );

  // ---------- HOME ----------
  if (screen === 'home') {
    const hasGaps = props.ledger.some((r) => r.gap != null && r.gap !== 0);
    const openIncoming = props.incomingRequests;
    const activeOutgoing = props.outgoingRequests.filter((r) => r.state === 'open' || r.state === 'partial');
    const doneOutgoing = props.outgoingRequests.filter((r) => r.state === 'fulfilled' || r.state === 'cancelled').slice(0, 6);
    return (
      <main><BackToConsole /><TrialBar /><Header />
        <div className="deptmeta">
          Production day <strong>{openChoice ? `${openChoice.weekday} ${props.openDay}` : props.openDay}</strong>
          <span className="metadot">·</span> day starts {props.settings.dayStart.slice(0, 5)}
          <span className="metadot">·</span> count by {props.settings.closingBefore.slice(0, 5)}
        </div>

        {props.inbox.length > 0 && (
          <button className="inboxbanner" onClick={() => start('receive')}>
            <span className="ic">⬇</span>
            <span><strong>{props.inbox.length} transfer{props.inbox.length === 1 ? '' : 's'} waiting for you</strong><br />
              <small>Tap to confirm what actually arrived</small></span>
          </button>
        )}
        {openIncoming.length > 0 && (
          <div className="inboxbanner asks">
            <span className="ic">？</span>
            <span><strong>{openIncoming.length} request{openIncoming.length === 1 ? '' : 's'} for you to send</strong><br />
              <small>Listed below under &ldquo;Requests for you&rdquo;</small></span>
          </div>
        )}

        <div className="actiongrid">
          {(['made', 'issued', 'wasted', 'closing', 'plan', 'receive', 'request'] as const).map((k) => {
            const a = ACTION_META[k];
            return (
              <button key={k} className={`actioncard ${a.cls}`} onClick={() => start(k)}>
                <span className="ic">{a.ic}</span>
                <span className="t">{a.label} <span className="hi">{a.hi}</span></span>
                <span className="d">{k === 'receive' && props.inbox.length ? `${props.inbox.length} waiting` : a.desc}</span>
              </button>
            );
          })}
        </div>

        {openIncoming.length > 0 && (<>
          <h2 className="sect">Requests for you</h2>
          <div className="inboxlist">
            {openIncoming.map((r) => (
              <RequestCard key={r.id} req={r} side="maker" busyGlobal={busy}
                onSend={() => startSendForRequest(r)}
                onClose={async (reason) => {
                  const res = await cancelRequest(props.dept.code, r.id, reason, enteredBy);
                  if (res.ok) router.refresh();
                  return res;
                }} />
            ))}
          </div>
        </>)}

        <div className="sectrow">
          <h2 className="sect">
            {props.glanceDay === props.openDay ? 'Today at a glance' : `Day at a glance`}
          </h2>
          <select
            className="glancesel" value={props.glanceDay} aria-label="Pick the day to view"
            onChange={(e) => router.push(`/dept/${props.dept.code}?glance=${e.target.value}`)}>
            {!props.glanceChoices.some((c) => c.date === props.glanceDay) && (
              <option value={props.glanceDay}>{props.glanceDay}</option>
            )}
            {props.glanceChoices.map((c) => (
              <option key={c.date} value={c.date}>
                {c.date === props.openDay ? `${c.weekday} ${c.date} (current)` : `${c.weekday} ${c.date}`}
              </option>
            ))}
          </select>
        </div>
        {props.ledger.length === 0 ? (
          <p className="hint">Nothing logged for {glanceMeta ? `${glanceMeta.weekday} ${props.glanceDay}` : props.glanceDay}.</p>
        ) : (
          <div className="tablewrap">
            <table className="sheet slim">
              <thead><tr>
                <th>Item</th><th className="num">Plan</th><th className="num">Open</th><th className="num">Made</th><th className="num">In</th>
                <th className="num">Out</th><th className="num">Waste</th><th className="num">Close</th><th className="num">Gap</th>
              </tr></thead>
              <tbody>
                {props.ledger.map((r) => (
                  <tr key={r.skuCode}>
                    <td className="name">{r.skuName}<small className="unit"> {r.uom}</small></td>
                    <td className="num">{fmt(r.planned)}</td>
                    <td className="num">{fmt(r.opening)}</td>
                    <td className="num">{fmt(r.made) || ''}</td>
                    <td className="num">{fmt(r.received) || ''}{r.pending > 0 && <span className="penddot" title="unconfirmed">•</span>}</td>
                    <td className="num">{fmt(r.sent) || ''}</td>
                    <td className="num">{fmt(r.wasted) || ''}</td>
                    <td className="num">{fmt(r.closing)}</td>
                    <td className={`num ${r.gap != null && r.gap !== 0 ? 'neg' : ''}`}>{r.gap != null ? fmt(r.gap) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasGaps && <p className="hint">A non-zero gap means the count and the entries disagree: either a miscount or something moved without being logged.</p>}

        {(activeOutgoing.length > 0 || doneOutgoing.length > 0) && (<>
          <h2 className="sect">Your requests</h2>
          <div className="inboxlist">
            {activeOutgoing.map((r) => (
              <RequestCard key={r.id} req={r} side="requester" busyGlobal={busy}
                onClose={async (reason) => {
                  const res = await cancelRequest(props.dept.code, r.id, reason, enteredBy);
                  if (res.ok) router.refresh();
                  return res;
                }} />
            ))}
            {doneOutgoing.map((r) => <RequestCard key={r.id} req={r} side="requester" done busyGlobal={busy} />)}
          </div>
        </>)}

        <h2 className="sect">Recent entries</h2>
        {props.recentEntries.length === 0 ? <p className="hint">No entries yet today.</p> : (
          <ul className="entlog">
            {props.recentEntries.slice(0, 12).map((e) => (
              <li key={e.id}>
                <span className={`vtag ${e.action}`}>{ACTION_META[e.action]?.label ?? e.action}</span>
                <span className="etext">{fmt(e.qty)} {e.uom} {e.skuName}{e.destName ? ` → ${e.destName}` : ''}{e.reasonCode ? ` (${e.reasonCode})` : ''}</span>
                <span className="ewhen">{istClock(e.enteredAt)} · {e.enteredBy}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  // ---------- RECEIVE ----------
  if (screen === 'receive') {
    return (
      <main><BackToConsole /><TrialBar /><Header sub="Receive" />
        <Crumb label="Receive / प्राप्त" />
        {props.inbox.length === 0 ? (
          <p className="hint">Nothing waiting. When another department sends you items, they appear here to confirm.</p>
        ) : (
          <div className="inboxlist">
            {props.inbox.map((it) => <ReceiptCard key={it.logId} item={it} deptCode={props.dept.code} enteredBy={enteredBy} onDone={() => router.refresh()} />)}
          </div>
        )}
        {msg && <p className={msg.ok ? 'saved-pill' : 'err'}>{msg.text}</p>}
      </main>
    );
  }

  // ---------- REQUEST (the pull flow) ----------
  if (screen === 'request') {
    if (props.requestables.length === 0) {
      return (
        <main><BackToConsole /><TrialBar /><Header sub="Request" />
          <Crumb label="Request / मांग" />
          <p className="hint">No other department has an item list yet, so there is nothing to request. This changes when the next departments join.</p>
        </main>
      );
    }
    if (!askDept) {
      return (
        <main><BackToConsole /><TrialBar /><Header sub="Request" />
          <Crumb label="Request / मांग" />
          <h1 className="step">Which department are you asking?</h1>
          <div className="destgrid">
            {props.requestables.map((d) => (
              <button key={d.deptCode} className="destbtn" onClick={() => { setAskDept(d.deptCode); setMsg(null); }}>
                {d.deptName}<small>{d.items.length} items</small>
              </button>
            ))}
          </div>
        </main>
      );
    }
    const target = props.requestables.find((d) => d.deptCode === askDept)!;
    const targetGroups = [...new Set(target.items.map((s) => s.category))]
      .map((c) => ({ cat: c, items: target.items.filter((s) => s.category === c) })).filter((g) => g.items.length);
    return (
      <main><BackToConsole /><TrialBar /><Header sub="Request" />
        <Crumb label={`Request → ${target.deptName}`}
          extra={props.requestables.length > 1
            ? <button className="changebtn" onClick={() => { setAskDept(''); setQtyMap({}); }}>change department</button>
            : undefined} />
        <p className="hint">
          Type what you need against each item. {target.deptName} sees this on their screen and sends against it;
          you confirm on Receive when it arrives. Every request keeps its history: asked, sent, received.
        </p>
        <div className="pickline">
          <span className="hint" style={{ margin: 0 }}>Needed by:</span>
          <button className={`chipbtn ${neededBy === null ? 'on' : ''}`} onClick={() => setNeededBy(null)}>No date</button>
          <button className={`chipbtn ${neededBy === props.dateChoices[0].date ? 'on' : ''}`}
            onClick={() => setNeededBy(props.dateChoices[0].date)}>Today</button>
          <button className={`chipbtn ${neededBy !== null && neededBy > props.dateChoices[0].date ? 'on' : ''}`}
            onClick={() => {
              const [y, m, d] = props.dateChoices[0].date.split('-').map(Number);
              const t = new Date(Date.UTC(y, m - 1, d)); t.setUTCDate(t.getUTCDate() + 1);
              setNeededBy(t.toISOString().slice(0, 10));
            }}>Tomorrow</button>
        </div>
        <QtySheet items={targetGroups} showUsual />
        <SaveBar n={filledCount} onSave={submitRequest} label="Send request" />
      </main>
    );
  }

  // ---------- CLOSING ----------
  if (screen === 'closing') {
    const countedN = Object.values(closingMap).filter((v) => v.split ? v.b.some((x) => x !== '') : v.total !== '').length;
    return (
      <main><BackToConsole /><TrialBar /><Header sub="Closing count" />
        <Crumb label="Closing / गिनती" extra={
          <button className="changebtn" onClick={() => setBizDate(bizDate === props.dateChoices[0].date ? props.dateChoices[1].date : props.dateChoices[0].date)}>
            change day
          </button>
        } />
        <p className="hint">
          Count what is physically left, item by item. Tap <strong>split by age</strong> to count fresh and older stock separately
          (like the paper register&rsquo;s 1/2/3 days old columns). An item you leave blank is simply not counted today; a zero means counted and none left.
        </p>
        <div className="entrylist">
          {grouped.map((g) => (
            <Fragment key={g.cat}>
              <div className="entrycat">{g.cat}</div>
              {g.items.map((s) => {
                const st = closingMap[s.code] ?? { total: '', split: false, b: ['', '', '', ''] as [string, string, string, string] };
                const set = (patch: Partial<typeof st>) => setClosingMap({ ...closingMap, [s.code]: { ...st, ...patch } });
                const splitSum = st.b.reduce((a, x) => a + (Number(x) || 0), 0);
                return (
                  <div className={`entryrow closing ${st.split ? 'expanded' : ''}`} key={s.code}>
                    <span className="ename">{s.name}<small>{s.uom}</small></span>
                    {!st.split ? (
                      <span className="closectl">
                        <input className={`qtyin big ${st.total !== '' ? 'filled' : ''}`} inputMode="decimal" placeholder="count"
                          value={st.total} onChange={(e) => set({ total: num(e.target.value) })} />
                        <button className="usebtn" onClick={() => set({ split: true, total: '' })}>split by age</button>
                      </span>
                    ) : (
                      <span className="agegrid">
                        {(['Today', '1 day', '2 days', '3+ days'] as const).map((lbl, i) => (
                          <label key={lbl}><small>{lbl}</small>
                            <input className={`qtyin ${st.b[i] !== '' ? 'filled' : ''}`} inputMode="decimal" placeholder="0"
                              value={st.b[i]} onChange={(e) => { const b = [...st.b] as typeof st.b; b[i] = num(e.target.value); set({ b }); }} />
                          </label>
                        ))}
                        <span className="agesum">= {fmt(splitSum)}</span>
                        <button className="usebtn" onClick={() => set({ split: false, b: ['', '', '', ''] })}>single total</button>
                      </span>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
        <SaveBar n={countedN} onSave={submitClosing} label="Save closing" />
        {planCta && msg?.ok && (
          <p style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => { setPlanCta(false); start('plan'); }}>
              Plan the next production →
            </button>
          </p>
        )}
      </main>
    );
  }

  // ---------- PLAN (the paper "production plan" column, digital) ----------
  if (screen === 'plan') {
    const pd = props.planDatas.find((d) => d.planDate === planDate) ?? props.planDatas[0];
    if (!pd) {
      return (
        <main><BackToConsole /><TrialBar /><Header sub="Plan" />
          <Crumb label="Plan / प्लान" />
          <p className="hint">Nothing to plan yet.</p>
        </main>
      );
    }
    const groups = [...new Set(pd.rows.map((r) => r.category))]
      .map((c) => ({ cat: c, items: pd.rows.filter((r) => r.category === c) })).filter((g) => g.items.length);
    const filledN = Object.values(planMap).filter((v) => v !== '').length;
    const anyExisting = pd.rows.some((r) => r.existingPlanned != null);
    return (
      <main><BackToConsole /><TrialBar /><Header sub="Plan" />
        <Crumb label="Plan / प्लान" />
        <div className="pickline">
          {props.planDatas.map((d) => (
            <button key={d.planDate} className={`chipbtn ${planDate === d.planDate ? 'on' : ''}`}
              onClick={() => { openPlan(d.planDate); setMsg(null); }}>
              {d.planDate === props.planDatas[0]?.planDate ? `Today ${d.planDate}` : `Tomorrow ${d.planDate}`}
            </button>
          ))}
        </div>
        {!pd.closingExists && (
          <p className="hint reqnote" style={{ background: 'var(--amber-bg)', borderColor: 'var(--amber-bd)', color: 'var(--amber)' }}>
            No closing count saved for {pd.closingDate} yet, so the suggestion assumes zero in hand.
            Counting first gives a truer plan.
          </p>
        )}
        {anyExisting && <p className="hint">A plan already exists for this day. Saving again replaces it (the old one stays on record).</p>}
        <p className="hint">
          The suggestion is par minus counted stock plus what other departments asked for.
          <strong> Your number is the plan</strong>: change any line, blank means skip.
        </p>
        <div className="entrylist">
          {groups.map((g) => (
            <Fragment key={g.cat}>
              <div className="entrycat">{g.cat}</div>
              {g.items.map((r) => (
                <label className="entryrow" key={r.skuCode}>
                  <span className="ename">{r.name}
                    <small>
                      {r.parType === 'on_demand'
                        ? `on demand · asked ${fmt(r.requestedQty)}`
                        : `par ${fmt(r.parQty)} - in hand ${r.onHand == null ? '0 (no count)' : fmt(r.onHand)}${r.requestedQty > 0 ? ` + asked ${fmt(r.requestedQty)}` : ''} = ${fmt(r.suggested)} ${r.uom}`}
                    </small>
                  </span>
                  <input className={`qtyin big ${planMap[r.skuCode] !== '' && planMap[r.skuCode] !== undefined ? 'filled' : ''}`}
                    inputMode="decimal" placeholder="skip"
                    value={planMap[r.skuCode] ?? ''}
                    onChange={(e) => setPlanMap({ ...planMap, [r.skuCode]: num(e.target.value) })} />
                </label>
              ))}
            </Fragment>
          ))}
        </div>
        <SaveBar n={filledN} onSave={submitPlan} label="Save plan" />
      </main>
    );
  }

  // ---------- MOVEMENTS: made / issued / wasted ----------
  const meta = ACTION_META[screen];
  if (!bizDate) {
    return (
      <main><BackToConsole /><TrialBar /><Header sub={meta.label} />
        <Crumb label={`${meta.label} / ${meta.hi}`} />
        <DayPicker
          title="Which production day?"
          hint={screen === 'made'
            ? 'Pick the day these batches belong to. Night production before the day change still belongs to your shift’s day.'
            : 'Pick the day this entry belongs to.'}
        />
      </main>
    );
  }
  if (screen === 'issued' && !dest) {
    return (
      <main><BackToConsole /><TrialBar /><Header sub="Sent" />
        <Crumb label="Sent / भेजा" />
        <h1 className="step">Where is it going?</h1>
        <p className="hint">Pick the department or spoke first. The receiver will confirm what arrives.</p>
        <div className="destgrid">
          {props.destinations.map((d) => (
            <button key={d.code} className="destbtn" onClick={() => { setDest(d.code); setMsg(null); }}>
              {d.name}<small>{d.code.startsWith('SK-') ? 'Spoke (via Central Dispatch)' : 'Department'}</small>
            </button>
          ))}
        </div>
      </main>
    );
  }
  const destName = props.destinations.find((d) => d.code === dest)?.name;
  const linkedReqIds = [...new Set(Object.values(reqLinks))];
  return (
    <main><BackToConsole /><TrialBar /><Header sub={meta.label} />
      <Crumb label={screen === 'issued' ? `Sent → ${destName}` : `${meta.label} / ${meta.hi}`}
        extra={screen === 'issued'
          ? <button className="changebtn" onClick={() => { setDest(''); setQtyMap({}); setReqLinks({}); }}>change destination</button>
          : undefined} />

      {screen === 'made' && (<>
        <p className="hint">Quantity made against each item. Blank rows are skipped.</p>
        <QtySheet showUsual />
        <SaveBar n={filledCount} onSave={() => saveMovement('made')} />
      </>)}

      {screen === 'issued' && (<>
        {linkedReqIds.length > 0 && (
          <p className="hint reqnote">This send answers request #{linkedReqIds.join(', #')} from {destName}. Saving links the two, and the request closes automatically once the asked quantity is sent.</p>
        )}
        <p className="hint">Quantities sent to <strong>{destName}</strong>. They will see this and confirm what arrived.</p>
        <QtySheet showUsual={false} />
        <SaveBar n={filledCount} onSave={() => saveMovement('issued')} />
      </>)}

      {screen === 'wasted' && (<>
        <p className="hint">Item, reason, quantity. Add rows as needed.</p>
        {waste.map((w, i) => (
          <div className="wrow" key={i}>
            <select value={w.skuCode} onChange={(e) => setWaste(waste.map((x, j) => (j === i ? { ...x, skuCode: e.target.value } : x)))}>
              <option value="">Item…</option>
              {props.skus.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            <select value={w.reasonCode} onChange={(e) => setWaste(waste.map((x, j) => (j === i ? { ...x, reasonCode: e.target.value } : x)))}>
              <option value="">Reason…</option>
              {props.reasons.map((r) => <option key={r.code} value={r.code}>{r.label_en}{r.label_hi ? ` / ${r.label_hi}` : ''}</option>)}
            </select>
            <input className="qtyin" inputMode="decimal" placeholder="Qty" value={w.qty}
              onChange={(e) => setWaste(waste.map((x, j) => (j === i ? { ...x, qty: num(e.target.value) } : x)))} />
            <button className="linkbtn" title="remove" onClick={() => { const n = waste.filter((_, j) => j !== i); setWaste(n.length ? n : [{ skuCode: '', reasonCode: '', qty: '' }]); }}>&times;</button>
          </div>
        ))}
        <button className="ghostbtn" onClick={() => setWaste([...waste, { skuCode: '', reasonCode: '', qty: '' }])}>+ Add row</button>
        <SaveBar n={waste.filter((w) => w.skuCode && w.reasonCode && Number(w.qty) > 0).length} onSave={saveWaste} />
      </>)}
    </main>
  );
}

// One request, seen from either side. The maker gets Send now / Can't send;
// the requester gets progress and Withdraw while it is still open.
function RequestCard({ req, side, done, busyGlobal, onSend, onClose }: {
  req: Req; side: 'maker' | 'requester'; done?: boolean; busyGlobal: boolean;
  onSend?: () => void;
  onClose?: (reason: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [mode, setMode] = useState<'idle' | 'reason'>('idle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const st = STATE_META[req.state];
  const otherName = side === 'maker' ? req.requesterName : req.makerName;

  async function close() {
    if (!onClose) return;
    setBusy(true); setErr('');
    const res = await onClose(reason);
    setBusy(false);
    if (!res.ok) setErr(res.message);
  }
  return (
    <div className={`rcard req ${done ? 'muted' : ''}`}>
      <div className="rmain">
        <span className="rqty">{fmt(req.requestedQty)} {req.uom}</span>
        <span className="rname">{req.skuName}</span>
        <span className={`stchip ${st.cls}`}>{st.label}</span>
        <span className="rmeta">
          {side === 'maker' ? `asked by ${otherName}` : `from ${otherName}`}
          {req.neededBy ? ` · needed by ${req.neededBy}` : ''} · {istClock(req.enteredAt)} · {req.enteredBy}
          {req.sentQty > 0 && req.state !== 'fulfilled' ? ` · ${fmt(req.sentQty)} sent, ${fmt(req.remainingQty)} to go` : ''}
          {req.state === 'cancelled' && req.cancelReason ? ` · ${req.cancelReason}` : ''}
        </span>
      </div>
      {!done && mode === 'idle' && (
        <div className="ractions">
          {side === 'maker' && onSend && (
            <button className="primary" disabled={busyGlobal} onClick={onSend}>Send now</button>
          )}
          {onClose && (
            <button className="ghostbtn" disabled={busy} onClick={() => setMode('reason')}>
              {side === 'maker' ? "Can't send" : 'Withdraw'}
            </button>
          )}
        </div>
      )}
      {!done && mode === 'reason' && (
        <div className="ractions">
          <input className="qtyin reasonin" placeholder="Why? (required, kept on record)" autoFocus
            value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="primary" disabled={busy || !reason.trim()} onClick={close}>{busy ? 'Saving…' : 'Confirm'}</button>
          <button className="ghostbtn" disabled={busy} onClick={() => { setMode('idle'); setReason(''); setErr(''); }}>Back</button>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

// One pending transfer: confirm as sent, or record a different number.
function ReceiptCard({ item, deptCode, enteredBy, onDone }: {
  item: InboxItem; deptCode: string; enteredBy: string; onDone: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'differ' | 'done'>('idle');
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(qty: number) {
    setBusy(true); setNote(null);
    const res = await confirmReceipt(deptCode, item.logId, qty, enteredBy);
    setBusy(false); setNote({ ok: res.ok, text: res.message });
    if (res.ok) { setMode('done'); onDone(); }
  }
  if (mode === 'done') {
    return <div className="rcard done"><span className="saved-pill">{note?.text ?? 'Confirmed'}</span></div>;
  }
  return (
    <div className="rcard">
      <div className="rmain">
        <span className="rqty">{item.qty} {item.uom}</span>
        <span className="rname">{item.skuName}</span>
        <span className="rmeta">from {item.fromName} · sent {istClock(item.sentAt)} · {item.sentBy}</span>
      </div>
      {mode === 'idle' ? (
        <div className="ractions">
          <button className="primary" disabled={busy} onClick={() => send(item.qty)}>
            {busy ? 'Saving…' : `✓ Received ${item.qty}`}
          </button>
          <button className="ghostbtn" disabled={busy} onClick={() => setMode('differ')}>Different number</button>
        </div>
      ) : (
        <div className="ractions">
          <input className="qtyin big" inputMode="decimal" placeholder="actual qty" autoFocus
            value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ''))} />
          <button className="primary" disabled={busy || val === ''} onClick={() => send(Number(val))}>
            {busy ? 'Saving…' : 'Save actual'}
          </button>
          <button className="ghostbtn" disabled={busy} onClick={() => { setMode('idle'); setVal(''); }}>Back</button>
        </div>
      )}
      {note && !note.ok && <p className="err">{note.text}</p>}
    </div>
  );
}
