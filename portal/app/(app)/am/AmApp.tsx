'use client';
// The Area Manager app on the phone (migration 256, 13 Nov 2026, in test).
// Flow agreed with Pranjay on 13 Nov: plan the day, check in within the store's
// radius with a store-front photo, then the visit sections (last visit, ERP
// Questions, the 28-item audit with a photo on every item, order checks, the
// blind stock count, to-dos, next-visit checks), the in-charge sees the to-dos,
// check out. Every save goes to /am/api, which re-checks it and answers with the
// fresh state; nothing is kept only on the phone.
import { useState } from 'react';
import type { DayState, StoreRow, AuditItem, VisitDetail } from '@/lib/am';
import s from './am.module.css';

type OrderCheck = { key: string; title: string; hint: string };
type View = 'day' | 'checkin' | 'hub' | 'last' | 'qs' | 'audit' | 'auditSum' | 'ord' | 'inv' | 'todo' | 'next' | 'out' | 'closed' | 'dayEnd';
type Loc = { lat: number; lng: number; acc: number };

const short = (store: string) => store.replace(/^CC-/, '').replace(/^TEST-OFFICE$/, 'Test site: Corporate Office');
function hm(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const KIND = { am_visit: 'AM visit', am_audit: 'AM monthly audit', qa_audit: 'QA surprise audit', other_audit: 'Other visit' } as const;
const KIND_NOTE = { am_audit: 'Scores the AM audit line (15 points).', qa_audit: 'Unannounced. Scores the QA audit line (15 points).', other_audit: 'Recorded with every answer and photo, no points.' } as const;
function locate(): Promise<Loc> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('This phone does not give a location to web pages.'));
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      e => rej(new Error(e.code === 1 ? 'Location is blocked for this site on this phone. Steps to allow it are below.' : 'Could not get your location. Step near a window or outside and try again.')),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  });
}
function shrink(file: File): Promise<Blob> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => resolve(b ?? file), 'image/jpeg', 0.75);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export default function AmApp(props: {
  initial: DayState; stores: StoreRow[]; items: AuditItem[]; orderChecks: OrderCheck[];
  varianceReasons: string[]; missReasons: string[]; me: string;
}) {
  const { stores, items, orderChecks, varianceReasons, missReasons } = props;
  const [st, setSt] = useState<DayState>(props.initial);
  const [view, setView] = useState<View>(props.initial.visit ? 'hub' : 'day');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [amF, setAmF] = useState<string>('Test');
  const [picking, setPicking] = useState<string[]>([]);
  const [unp, setUnp] = useState<{ open: boolean; store: string; reason: string }>({ open: false, store: '', reason: '' });
  const [ci, setCi] = useState<{ kind: 'am_visit' | 'am_audit' | 'qa_audit' | 'other_audit'; store: string; planned: boolean; reason: string | null; loc: Loc | null; photo: number | null; preview: string | null } | null>(null);
  const [ai, setAi] = useState(0);
  const [draft, setDraft] = useState<{ result: 'pass' | 'fail' | null; photo: number | null; preview: string | null; note: string; owner: string; due: string }>({ result: null, photo: null, preview: null, note: '', owner: '', due: '' });
  const [ordDraft, setOrdDraft] = useState<Record<string, { photo: number | null; preview: string | null; pending: string }>>({});
  const [invDraft, setInvDraft] = useState<Record<string, string>>({});
  const [ppDraft, setPpDraft] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const [qOpen, setQOpen] = useState(false);
  const [qaKind, setQaKind] = useState<'am_audit' | 'qa_audit' | 'other_audit'>('qa_audit');
  const [qaStore, setQaStore] = useState(props.stores[0]?.store ?? '');
  const [lastClosed, setLastClosed] = useState<{ store: string; minutes: number | null; from: string; to: string | null } | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const v: VisitDetail | null = st.visit;
  const pinOf = (store: string) => stores.find(x => x.store === store);
  const go = (to: View) => { setErr(null); setFlash(null); setView(to); window.scrollTo(0, 0); };

  // Returns the server's answer (with the fresh state) on success, null on failure.
  async function call(action: string, body: Record<string, unknown> = {}): Promise<DayState | null> {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/am/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, visitId: v?.id, ...body }) });
      const j = await r.json().catch(() => ({ error: 'The server did not answer. Check your connection and try again.' }));
      if (j.date) setSt({ date: j.date, plan: j.plan ?? null, visits: j.visits ?? [], visit: j.visit ?? null });
      if (!r.ok || j.error) { setErr(j.error ?? 'Not saved. Try again.'); return null; }
      return { date: j.date, plan: j.plan ?? null, visits: j.visits ?? [], visit: j.visit ?? null };
    } catch {
      setErr('No connection. Nothing was saved; try again when you have signal.');
      return null;
    } finally { setBusy(false); }
  }

  async function upload(file: File, purpose: string, visitId: number | null): Promise<{ id: number; preview: string } | null> {
    setBusy(true); setErr(null);
    try {
      const blob = await shrink(file);
      const fd = new FormData();
      fd.append('photo', new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }));
      fd.append('purpose', purpose);
      if (visitId) fd.append('visitId', String(visitId));
      const r = await fetch('/am/photo', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({ error: 'The photo did not save. Try again.' }));
      if (!r.ok || j.error) { setErr(j.error ?? 'The photo did not save. Try again.'); return null; }
      const preview = URL.createObjectURL(blob);
      setPreviews(p => ({ ...p, [String(j.id)]: preview }));
      return { id: j.id as number, preview };
    } catch {
      setErr('The photo did not upload. Check your connection and try again.');
      return null;
    } finally { setBusy(false); }
  }
  const imgFor = (id: number | null | undefined) => (id ? previews[String(id)] ?? `/am/photo/${id}` : null);

  function PhotoBox({ label, photo, onFile }: { label: string; photo: number | null; onFile: (f: File) => void }) {
    const src = imgFor(photo);
    return (
      <label className={`${s.photo} ${photo ? s.photodone : ''}`}>
        {src ? <img src={src} alt="" /> : null}
        <span>{photo ? 'Photo saved. Tap to retake' : label}</span>
        <input type="file" accept="image/*" capture="environment" disabled={busy}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      </label>
    );
  }

  const Msgs = () => (<>
    {err ? <div className={s.err} role="alert">{err}</div> : null}
    {flash ? <div className={s.ok}>{flash}</div> : null}
  </>);
  const Band = () => <div className={s.testband}><b>Test version.</b> Everything saved now is marked as test and will be cleared from all reports before the app goes live.</div>;

  // ---------------- views ----------------
  if (view === 'checkin' && ci) {
    const pin = pinOf(ci.store)!;
    const dist = ci.loc ? metres(ci.loc.lat, ci.loc.lng, pin.lat, pin.lng) : null;
    const inside = dist != null && dist <= pin.radius;
    return (
      <div className={s.app}>
        <Band />
        <div className={s.h}>{ci.kind === 'am_visit' ? 'Check in' : KIND[ci.kind]} · {short(ci.store)}</div>
        <div className={s.sub}>Check in works only within {pin.radius} m of the store&apos;s pin.{pin.needsCheck ? ` This pin is not confirmed yet (${pin.pinNote ?? 'from SalaryBox'}).` : ''}</div>
        <Msgs />
        <button className={`${s.btn} ${s.ghost}`} disabled={busy} onClick={async () => {
          setErr(null); setBusy(true);
          try { const loc = await locate(); setCi({ ...ci, loc }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>{ci.loc ? 'Check my location again' : 'Get my location'}</button>
        {err?.startsWith('Location is blocked') ? (
          <div className={s.card}><div className={s.cardh}>Allow location (iPhone)</div>
            <div className={s.sub} style={{ lineHeight: 1.5 }}>
              <b>1.</b> Settings, Privacy and Security, Location Services: switched on.<br />
              <b>2.</b> On the same screen, scroll to <b>Safari Websites</b> (or Chrome if you use Chrome) and set it to <b>While Using the App</b> or <b>Ask Next Time</b>. &quot;Never&quot; blocks every website without asking.<br />
              <b>3.</b> Settings, Apps, Safari, <b>Location</b>: set to <b>Ask</b> or <b>Allow</b>, not Deny.<br />
              <b>4.</b> Back in Safari on this page, tap <b>aA</b> in the address bar, Website Settings, <b>Location</b>: <b>Ask</b> or <b>Allow</b>.<br />
              <b>5.</b> Close this tab, open the link again, tap Get my location, and tap Allow when asked.
            </div>
          </div>
        ) : null}
        {ci.loc ? (
          <div className={inside ? s.ok : s.err}>
            You are <b>{dist} m</b> from the store (GPS ±{ci.loc.acc} m). {inside ? 'Inside the check-in circle.' : `Move within ${pin.radius} m to check in.`}
          </div>
        ) : null}
        {ci.loc && !inside ? (
          <button className={s.link} disabled={busy} onClick={async () => {
            if (await call('reportPin', { store: ci.store, lat: ci.loc!.lat, lng: ci.loc!.lng, acc: ci.loc!.acc, dist, note: 'Reported from check-in: I am at the store but the app says I am far.' }))
              setFlash('Thanks. The pin is flagged for checking. You cannot check in here until it is fixed.');
          }}>I am at the store, the pin looks wrong</button>
        ) : null}
        {inside ? (
          <PhotoBox label="Take a photo of the store front with the signboard" photo={ci.photo} onFile={async f => {
            const r = await upload(f, 'front', null); if (r) setCi({ ...ci, photo: r.id, preview: r.preview });
          }} />
        ) : null}
        <button className={s.btn} disabled={busy || !inside || !ci.photo} onClick={async () => {
          if (await call('checkIn', { kind: ci.kind, store: ci.store, planned: ci.planned, reason: ci.reason, lat: ci.loc!.lat, lng: ci.loc!.lng, acc: ci.loc!.acc, photo: ci.photo })) { setCi(null); go('hub'); }
        }}>Check in</button>
        <button className={s.link} onClick={() => { setCi(null); go('day'); }}>Back</button>
      </div>
    );
  }

  if (v && view === 'hub') {
    const answered = items.filter(i => v.audit[i.code]).length;
    const failed = items.filter(i => v.audit[i.code]?.result === 'fail').length;
    const secs: [View, string, string][] = [
      ['last', 'Last visit and open points', v.sectionsDone.includes('last') ? 'all marked' : (v.openPoints.length ? `${v.openPoints.length} open points` : 'nothing open from earlier visits')],
      ['qs', 'Questions from the ERP', v.sectionsDone.includes('qs') ? 'discussed' : (v.questions.length ? `${v.questions.length} open` : 'none open for this store')],
      ['audit', `Store audit · ${items.length} items`, `${answered} of ${items.length} done${failed ? ` · ${failed} fail` : ''}`],
      ['ord', 'Stock audit: order checks', 'Petpooja PO and TO, SupplyNote PO and SO'],
      ['inv', 'Stock audit: random count', '2 add-ons and 6 finished goods'],
      ['todo', 'To-dos for the store', v.sectionsDone.includes('todo') ? `${v.todos.length} saved` : 'filled from your findings'],
      ['next', 'Check next visit', v.sectionsDone.includes('next') ? `${v.nexts.length} saved` : 'for the next visit here'],
    ];
    if (v.kind !== 'am_visit') secs.splice(0, secs.length, ...secs.filter(x => x[0] === 'audit' || x[0] === 'todo'));
    const secKey: Record<string, string> = { last: 'last', qs: 'qs', audit: 'audit', ord: 'ord', inv: 'inv', todo: 'todo', next: 'next' };
    const all = secs.every(x => v.sectionsDone.includes(secKey[x[0]]));
    const mins = Math.round((Date.now() - new Date(v.checkinAt).getTime()) / 60000);
    return (
      <div className={s.app}>
        <Band />
        <div className={s.h}>{v.kind !== 'am_visit' ? `${KIND[v.kind as keyof typeof KIND] ?? 'Audit'} · ` : ''}{short(v.store)}</div>
        <div className={s.sub}>Checked in {hm(v.checkinAt)}, {v.checkinDist} m from the pin · {mins} min so far · every answer saves as you go</div>
        <Msgs />
        {secs.map(([k, t, d]) => (
          <button key={k} className={`${s.sec} ${v.sectionsDone.includes(secKey[k]) ? s.secdone : ''}`} onClick={() => {
            if (k === 'audit') {
              if (v.sectionsDone.includes('audit')) return go('auditSum');
              const first = items.findIndex(i => !v.audit[i.code]);
              const idx = first < 0 ? 0 : first;
              setAi(idx); loadDraft(idx); return go('audit');
            }
            if (k === 'qs') setQOpen(false);
            setText(''); go(k);
          }}>
            <div><b>{t}</b><span>{d}</span></div><span>{v.sectionsDone.includes(secKey[k]) ? '✓' : '›'}</span>
          </button>
        ))}
        <button className={s.btn} disabled={!all} onClick={() => go('out')}>Check out</button>
        {!all ? <div className={s.sub} style={{ textAlign: 'center' }}>Check out unlocks when every section is done</div> : null}
        <button className={s.link} onClick={() => go('day')}>Back to my day</button>
      </div>
    );
  }

  function loadDraft(idx: number, from: VisitDetail | null = v) {
    const it = items[idx]; const a = from?.audit[it.code];
    setDraft({ result: a?.result ?? null, photo: a?.photo ?? null, preview: null, note: a?.note ?? '', owner: a?.owner ?? '', due: a?.due ?? '' });
  }

  if (v && view === 'last') {
    const ok = v.openPoints.every(p => p.mark);
    return (
      <div className={s.app}>
        <div className={s.h}>Last visit and open points</div>
        <Msgs />
        {v.openPoints.length ? (
          <div className={s.card}><div className={s.cardh}>Open from earlier visits</div>
            {v.openPoints.map(p => (
              <div key={`${p.kind}${p.id}`} className={s.row} style={{ flexWrap: 'wrap' }}>
                <div className={s.rowl}><b>{p.text}</b><span>{p.kind === 'todo' ? 'to-do' : 'check'} from {new Date(p.from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</span></div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className={`${s.chip} ${p.mark === 'done' ? s.chipon : ''}`} disabled={busy} onClick={() => call('markPoint', { kind: p.kind, refId: p.id, status: 'done' })}>Done</button>
                  <button className={`${s.chip} ${p.mark === 'open' ? s.chipon : ''}`} disabled={busy} onClick={() => call('markPoint', { kind: p.kind, refId: p.id, status: 'open' })}>Still open</button>
                </div>
              </div>
            ))}
          </div>
        ) : <div className={s.card}><div className={s.sub}>Nothing is open from earlier visits to this store. After today, what you leave open shows here next time.</div></div>}
        <button className={s.btn} disabled={busy || !ok} onClick={async () => { if (await call('finish', { section: 'last' })) go('hub'); }}>Save and back</button>
        <button className={s.link} onClick={() => go('hub')}>Back</button>
      </div>
    );
  }

  if (v && view === 'qs') {
    const ok = v.questions.every(x => x.seen);
    return (
      <div className={s.app}>
        <div className={s.h}>Questions from the ERP</div>
        <Msgs />
        {!v.questions.length ? <div className={s.card}><div className={s.sub}>No open Questions for this store.</div></div> : !qOpen ? (
          <button className={s.sec} onClick={() => setQOpen(true)}><div><b>{v.questions.length} open Questions</b><span>tap to open</span></div><span>›</span></button>
        ) : (
          <div className={s.card}>
            {v.questions.map(x => (
              <div key={x.id} className={s.row} style={{ flexWrap: 'wrap' }}>
                <div className={s.rowl}><b>{x.prompt}</b><span>{x.overdue ? 'overdue · ' : ''}{x.status} · asked {new Date(x.raisedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })} · <a href={`/questions?q=${x.id}`}>answer in Questions</a></span></div>
                {x.seen ? <span className={`${s.pill} ${s.good}`}>discussed</span> :
                  <button className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => call('questionSeen', { questionId: x.id })}>Discussed</button>}
              </div>
            ))}
          </div>
        )}
        <button className={s.btn} disabled={busy || !ok} onClick={async () => { if (await call('finish', { section: 'qs' })) go('hub'); }}>Save and back</button>
        <button className={s.link} onClick={() => go('hub')}>Back</button>
      </div>
    );
  }

  if (v && view === 'audit') {
    const it = items[ai];
    const ready = !!draft.result && !!draft.photo && (draft.result === 'pass' || (draft.note.trim().length > 0 && draft.owner.trim().length > 0 && !!draft.due));
    const done = items.filter(i => v.audit[i.code]).length;
    return (
      <div className={s.app}>
        <div className={s.nav}><span className={s.sub}>Item {ai + 1} of {items.length} · {done} answered</span>{it.critical ? <span className={`${s.pill} ${s.bad}`}>Critical</span> : null}</div>
        <div className={s.prog}><i style={{ width: `${(100 * (ai + 1)) / items.length}%` }} /></div>
        <span className={s.group}>{it.grp}</span>
        <p className={s.q}>{it.title}</p>
        <div className={s.passline}><b>Pass looks like</b>{it.passLine}</div>
        {it.critical ? <div className={s.sub}>A fail on this item caps the store&apos;s month at 60.</div> : null}
        <Msgs />
        <div className={s.pf}>
          <button className={`${s.pass} ${draft.result === 'pass' ? s.passon : ''}`} onClick={() => setDraft({ ...draft, result: 'pass', photo: draft.result === 'pass' ? draft.photo : null })}>PASS</button>
          <button className={`${s.fail} ${draft.result === 'fail' ? s.failon : ''}`} onClick={() => setDraft({ ...draft, result: 'fail', photo: draft.result === 'fail' ? draft.photo : null })}>FAIL</button>
        </div>
        {draft.result ? (
          <PhotoBox label={draft.result === 'pass' ? 'Take a photo (proof of pass)' : 'Take a photo of the problem'} photo={draft.photo} onFile={async f => {
            const r = await upload(f, `audit:${it.code}`, v.id); if (r) setDraft(d => ({ ...d, photo: r.id, preview: r.preview }));
          }} />
        ) : null}
        {draft.result === 'fail' ? (<>
          <label className={s.lbl} htmlFor="am-note">What must be fixed</label>
          <textarea id="am-note" className={s.txt} rows={2} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} placeholder="One line" />
          <label className={s.lbl} htmlFor="am-owner">Who will fix it</label>
          <input id="am-owner" className={s.txt} value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })} placeholder="Name or role, for example: store in-charge" />
          <label className={s.lbl} htmlFor="am-due">Fix by</label>
          <input id="am-due" type="date" className={s.txt} value={draft.due} min={new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)} onChange={e => setDraft({ ...draft, due: e.target.value })} />
        </>) : null}
        <button className={s.btn} disabled={busy || !ready} onClick={async () => {
          const fresh = await call('audit', { code: it.code, result: draft.result, note: draft.note, owner: draft.owner, due: draft.due, photo: draft.photo });
          if (!fresh) return;
          if (ai < items.length - 1) { setAi(ai + 1); loadDraft(ai + 1, fresh.visit); window.scrollTo(0, 0); } else go('auditSum');
        }}>{ai === items.length - 1 ? 'Save and finish' : 'Save and next'}</button>
        <div className={s.nav}>
          <button className={s.link} onClick={() => { if (ai === 0) go('hub'); else { setAi(ai - 1); loadDraft(ai - 1); } }}>{ai === 0 ? 'Back to visit' : 'Previous item'}</button>
          <button className={s.link} onClick={() => go('hub')}>Pause</button>
        </div>
      </div>
    );
  }

  if (v && view === 'auditSum') {
    const passed = items.filter(i => v.audit[i.code]?.result === 'pass').length;
    const crit = items.filter(i => i.critical && v.audit[i.code]?.result === 'fail').length;
    const missing = items.filter(i => !v.audit[i.code]).length;
    return (
      <div className={s.app}>
        <div className={s.h}>Audit</div>
        <Msgs />
        <div className={s.card}><div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}><div><div className={s.big}>{passed}</div><div className={s.sub}>of {items.length} passed</div></div>
          <div className={s.sub}>{items.length - passed - missing} failed{crit ? <> · <b style={{ color: '#a8321f' }}>{crit} critical: the month is capped at 60</b></> : ' · no critical fails'}{missing ? ` · ${missing} not answered` : ''}</div></div></div>
        {v.sectionsDone.includes('audit') ? <div className={s.ok}>Audit saved.</div> :
          <button className={s.btn} disabled={busy || missing > 0} onClick={async () => { if (await call('finish', { section: 'audit' })) go('hub'); }}>Finish audit</button>}
        <button className={s.link} onClick={() => { setAi(0); loadDraft(0); go('audit'); }}>Review items</button>
        <button className={s.link} onClick={() => go('hub')}>Back to visit</button>
      </div>
    );
  }

  if (v && view === 'ord') {
    const allSaved = orderChecks.every(o => v.orders[o.key]);
    return (
      <div className={s.app}>
        <div className={s.h}>Order checks</div>
        <div className={s.sub}>For each: a photo of the pending list, and how many are still pending.</div>
        <Msgs />
        {orderChecks.map(o => {
          const saved = v.orders[o.key];
          const d = ordDraft[o.key] ?? { photo: saved?.photo ?? null, preview: null, pending: saved ? String(saved.pending) : '' };
          const set = (x: Partial<typeof d>) => setOrdDraft(m => ({ ...m, [o.key]: { ...d, ...x } }));
          return (
            <div key={o.key} className={s.card}>
              <div className={s.cardh}>{o.title} {saved ? <span className={`${s.pill} ${s.good}`}>saved</span> : null}</div>
              <div className={s.sub} style={{ marginBottom: 6 }}>{o.hint}</div>
              <PhotoBox label="Photo of the pending list" photo={d.photo} onFile={async f => { const r = await upload(f, `order:${o.key}`, v.id); if (r) set({ photo: r.id, preview: r.preview }); }} />
              <label className={s.lbl} htmlFor={`am-o-${o.key}`}>Pending right now</label>
              <input id={`am-o-${o.key}`} className={s.txt} type="number" min={0} inputMode="numeric" value={d.pending} onChange={e => set({ pending: e.target.value })} />
              <button className={`${s.btn} ${s.small}`} style={{ marginTop: 8 }} disabled={busy || !d.photo || d.pending === ''}
                onClick={() => call('order', { key: o.key, pending: Number(d.pending), photo: d.photo })}>Save this check</button>
            </div>
          );
        })}
        <button className={s.btn} disabled={busy || !allSaved} onClick={async () => { if (await call('finish', { section: 'ord' })) go('hub'); }}>Order checks done</button>
        <button className={s.link} onClick={() => go('hub')}>Back</button>
      </div>
    );
  }

  if (v && view === 'inv') {
    const locked = !!v.invLockedAt;
    const allPhys = v.invItems.every(i => v.stock[i.item]?.physical != null);
    return (
      <div className={s.app}>
        <div className={s.h}>Random count</div>
        <div className={s.sub}>{locked ? 'Your counts are locked. Now type each item’s figure from the store’s Petpooja stock screen, and take one photo of that screen.' : 'The app picked these 8 items. Count each one physically first. Petpooja’s figures come after your counts lock.'}</div>
        <Msgs />
        <div className={s.card}>
          <div className={`${s.inv} ${s.invh}`}><span>Item</span><span style={{ textAlign: 'right' }}>You count</span><span style={{ textAlign: 'right' }}>Petpooja</span></div>
          {v.invItems.map(i => {
            const c = v.stock[i.item];
            const diff = c && c.physical != null && c.petpooja != null ? c.physical - c.petpooja : null;
            return (
              <div key={i.item} className={s.inv}>
                <div><b>{i.item}</b><div className={s.sub}>{i.kind === 'add_on' ? 'Add-on' : 'Finished good'}</div></div>
                <input className={s.txt} type="number" min={0} inputMode="numeric" disabled={locked || busy} aria-label={`Your count for ${i.item}`}
                  value={invDraft[i.item] ?? (c?.physical != null ? String(c.physical) : '')}
                  onChange={e => setInvDraft(m => ({ ...m, [i.item]: e.target.value }))}
                  onBlur={e => { const n = e.target.value; if (n !== '' && Number(n) !== c?.physical) call('stock', { item: i.item, physical: Number(n) }); }} />
                {locked ? (
                  <input className={s.txt} type="number" min={0} inputMode="numeric" disabled={busy} aria-label={`Petpooja figure for ${i.item}`}
                    value={ppDraft[i.item] ?? (c?.petpooja != null ? String(c.petpooja) : '')}
                    onChange={e => setPpDraft(m => ({ ...m, [i.item]: e.target.value }))}
                    onBlur={e => { const n = e.target.value; if (n !== '' && Number(n) !== c?.petpooja) call('stock', { item: i.item, petpooja: Number(n) }); }} />
                ) : <span className={s.sub} style={{ textAlign: 'right' }}>after count</span>}
                {diff ? (
                  <div className={s.var}>
                    <span className={`${s.pill} ${diff < 0 ? s.bad : s.warn}`}>{diff > 0 ? '+' : ''}{diff}</span>
                    <select className={s.txt} aria-label="Reason for the difference" value={c?.reason ?? ''} disabled={busy}
                      onChange={e => call('stock', { item: i.item, reason: e.target.value })}>
                      <option value="">Pick a reason</option>
                      {varianceReasons.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {!locked ? (
          <button className={s.btn} disabled={busy || !allPhys} onClick={() => call('lockCounts')}>Counts done, now enter Petpooja figures</button>
        ) : (<>
          <PhotoBox label="Photo of the Petpooja stock screen" photo={v.stockScreenPhoto} onFile={async f => { if (await upload(f, 'stock_screen', v.id)) await call('state'); }} />
          <button className={s.btn} disabled={busy} onClick={async () => { if (await call('finish', { section: 'inv' })) go('hub'); }}>Save count</button>
        </>)}
        <button className={s.link} onClick={() => go('hub')}>Back</button>
      </div>
    );
  }

  if (v && view === 'todo') {
    const done = v.sectionsDone.includes('todo');
    const auto: string[] = [];
    if (!done) {
      items.forEach(i => { const a = v.audit[i.code]; if (a?.result === 'fail') auto.push(`${i.title}: ${a.note ?? ''}${a.owner ? ` (${a.owner}, by ${a.due})` : ''}${i.critical ? ' (critical)' : ''}`); });
      v.invItems.forEach(i => { const c = v.stock[i.item]; if (c && c.physical != null && c.petpooja != null && c.physical !== c.petpooja) auto.push(`${i.item}: ${c.physical - c.petpooja > 0 ? '+' : ''}${c.physical - c.petpooja} against Petpooja (${c.reason ?? ''})`); });
      orderChecks.forEach(o => { const x = v.orders[o.key]; if (x && x.pending > 0) auto.push(`${o.title}: ${x.pending} pending to clear`); });
    }
    return (
      <div className={s.app}>
        <div className={s.h}>To-dos for the store</div>
        <div className={s.sub}>Made from what you found. Add anything extra.</div>
        <Msgs />
        <div className={s.card}><div className={s.cardh}>{done ? `Saved · ${v.todos.length}` : `From this visit · ${auto.length}`}</div>
          {(done ? v.todos.map(t => t.text) : auto).map((t, k) => <div key={k} className={s.row}><div className={s.rowl}><b>{t}</b></div></div>)}
          {!done ? v.todos.filter(t => t.source === 'added').map(t => <div key={t.id} className={s.row}><div className={s.rowl}><b>{t.text}</b><span>added by you</span></div></div>) : null}
          {!done && !auto.length && !v.todos.length ? <div className={s.sub}>Nothing failed, no differences, nothing pending.</div> : null}
        </div>
        <label className={s.lbl} htmlFor="am-todo">Add a to-do</label>
        <textarea id="am-todo" className={s.txt} rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="For example: retrain the new packer on the packing standard" />
        <button className={s.link} disabled={busy || !text.trim()} onClick={async () => { if (await call('addTodo', { text })) setText(''); }}>+ Add</button>
        {!done ? <button className={s.btn} disabled={busy} onClick={async () => { if (await call('finish', { section: 'todo' })) go('hub'); }}>Save to-dos</button> : null}
        <button className={s.link} onClick={() => go('hub')}>Back</button>
      </div>
    );
  }

  if (v && view === 'next') {
    return (
      <div className={s.app}>
        <div className={s.h}>Check next visit</div>
        <div className={s.sub}>These become the open points the next time anyone checks in here.</div>
        <Msgs />
        <div className={s.card}>{v.nexts.length ? v.nexts.map(n => <div key={n.id} className={s.row}><div className={s.rowl}><b>{n.text}</b></div></div>) : <div className={s.sub}>Nothing added yet.</div>}</div>
        <label className={s.lbl} htmlFor="am-next">What to look at next time</label>
        <textarea id="am-next" className={s.txt} rows={2} value={text} onChange={e => setText(e.target.value)} />
        <button className={s.link} disabled={busy || !text.trim()} onClick={async () => { if (await call('addNext', { text })) setText(''); }}>+ Add</button>
        <button className={s.btn} disabled={busy} onClick={async () => { if (await call('finish', { section: 'next' })) go('hub'); }}>Save and back</button>
        <button className={s.link} onClick={() => go('hub')}>Back</button>
      </div>
    );
  }

  if (v && view === 'out') {
    const passed = items.filter(i => v.audit[i.code]?.result === 'pass').length;
    const crit = items.filter(i => i.critical && v.audit[i.code]?.result === 'fail').length;
    return (
      <div className={s.app}>
        <div className={s.h}>Check out · {short(v.store)}</div>
        <Msgs />
        <div className={s.card}>
          <div className={s.row}><div className={s.rowl}><b>Audit</b><span>{passed} of {items.length} passed</span></div><span className={`${s.pill} ${crit ? s.bad : s.good}`}>{crit ? `${crit} critical` : 'ok'}</span></div>
          <div className={s.row}><div className={s.rowl}><b>To-dos for the store</b><span>{v.todos.length} saved</span></div></div>
        </div>
        <div className={s.card}>
          <div className={s.row}><div className={s.rowl}><b>The in-charge has seen the to-do list</b><span>In the live app the in-charge taps this on their own phone. In the test, tap it once you have shown them.</span></div>
            {v.seenAt ? <span className={`${s.pill} ${s.good}`}>seen</span> : <button className={`${s.btn} ${s.small}`} disabled={busy} onClick={() => call('seen')}>Seen</button>}</div>
        </div>
        <button className={s.btn} disabled={busy || !v.seenAt} onClick={async () => {
          let loc: Loc | null = null;
          try { setBusy(true); loc = await locate(); } catch { loc = null; } finally { setBusy(false); }
          const info = { store: v.store, from: v.checkinAt };
          if (await call('checkOut', { lat: loc?.lat ?? null, lng: loc?.lng ?? null, acc: loc?.acc ?? null })) {
            setLastClosed({ store: info.store, minutes: Math.round((Date.now() - new Date(info.from).getTime()) / 60000), from: info.from, to: new Date().toISOString() });
            go('closed');
          }
        }}>Check out</button>
        <button className={s.link} onClick={() => go('hub')}>Back</button>
      </div>
    );
  }

  if (view === 'closed' && lastClosed) {
    return (
      <div className={s.app}>
        <div className={s.h}>Visit closed</div>
        <div className={s.card}><div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}><div><div className={s.big}>{lastClosed.minutes}</div><div className={s.sub}>minutes at {short(lastClosed.store)}</div></div><div className={s.sub}>{hm(lastClosed.from)} to {hm(lastClosed.to)}</div></div></div>
        <div className={s.sub}>Saved. It shows under All visits for review.</div>
        <button className={s.btn} onClick={() => go('day')}>Back to my day</button>
      </div>
    );
  }

  if (view === 'dayEnd') {
    const plan = st.plan;
    const visited = new Set(st.visits.filter(x => x.status === 'closed').map(x => x.store));
    const missedReason = (store: string) => plan?.changes.filter(c => c.kind === 'missed' && c.store === store).pop()?.reason ?? '';
    const missing = plan ? plan.stores.filter(x => !visited.has(x)) : [];
    const lines: string[] = [];
    lines.push(`Area Manager day: ${props.me}, ${st.date}`);
    lines.push(plan ? `Plan confirmed ${hm(plan.confirmedAt)}${plan.late ? ' (after 10:00)' : ''}` : 'NO PLAN FILED');
    lines.push('');
    const stops = plan ? [...plan.stores.map(x => ({ store: x, why: null as string | null })), ...plan.changes.filter(c => c.kind === 'added').map(c => ({ store: c.store, why: c.reason }))] : [];
    stops.forEach(sp => {
      const vv = st.visits.filter(x => x.store === sp.store && x.status === 'closed').pop();
      if (vv) lines.push(`• ${short(sp.store)}: ${hm(vv.checkinAt)} to ${hm(vv.checkoutAt)}, ${vv.minutes} min, audit ${vv.passed}/${items.length}${vv.critical ? `, ${vv.critical} CRITICAL` : ''}, ${vv.todos} to-dos${sp.why ? ` (unplanned: ${sp.why})` : ''}`);
      else lines.push(`• ${short(sp.store)}: NOT VISITED${missedReason(sp.store) ? ` (${missedReason(sp.store)})` : ''}`);
    });
    return (
      <div className={s.app}>
        <div className={s.h}>End of day</div>
        <Msgs />
        {missing.length ? (
          <div className={s.card}><div className={s.cardh}>Planned but not visited: pick a reason</div>
            {missing.map(m => (
              <div key={m}>
                <label className={s.lbl} htmlFor={`am-m-${m}`}>{short(m)}</label>
                <select id={`am-m-${m}`} className={s.txt} value={missedReason(m)} disabled={busy} onChange={e => e.target.value && call('missStop', { store: m, reason: e.target.value })}>
                  <option value="">Pick a reason</option>{missReasons.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            ))}
          </div>
        ) : null}
        <div className={s.card}><div className={s.cardh}>Evening mail, plan against actual</div><pre className={s.mail}>{lines.join('\n')}</pre></div>
        <div className={s.sub}>In the live app this goes to the review list each evening. The test shows it only.</div>
        <button className={s.btn} onClick={() => go('day')}>Back to my day</button>
      </div>
    );
  }

  // ---------------- my day ----------------
  const plan = st.plan;
  const ams = Array.from(new Set(stores.map(x => x.am)));
  return (
    <div className={s.app}>
      <Band />
      <Msgs />
      {v ? (<>
        <div className={s.info}>You are checked in at <b>{short(v.store)}</b> since {hm(v.checkinAt)}.</div>
        <button className={s.btn} onClick={() => go('hub')}>Continue the visit</button>
      </>) : null}
      {!plan ? (<>
        <div className={s.h}>Plan today</div>
        <div className={s.sub}>Pick the stores you will visit, in order. The plan locks at 10:00 and goes to the review list. For the test, the Test site (the Corporate Office in Sector 67) lets you check in without going to a store.</div>
        <div className={s.chips}>{ams.map(a => <button key={a} className={`${s.chip} ${a === amF ? s.chipon : ''}`} onClick={() => setAmF(a)}>{a === 'Test' ? 'Test site' : a}</button>)}</div>
        <div className={s.card}>
          {[...picking.map(p => stores.find(x => x.store === p)!).filter(Boolean), ...stores.filter(x => x.am === amF && !picking.includes(x.store))].map(x => {
            const pos = picking.indexOf(x.store);
            return (
              <button key={x.store} className={s.rowbtn} onClick={() => setPicking(p => (pos >= 0 ? p.filter(y => y !== x.store) : [...p, x.store]))}>
                <div className={s.rowl}><b>{pos >= 0 ? `${pos + 1}. ` : ''}{short(x.store)}</b><span>{x.needsCheck ? 'map pin to be confirmed' : 'map pin ok'}</span></div>
                <span className={`${s.pill} ${pos >= 0 ? s.good : s.grey}`}>{pos >= 0 ? 'picked' : 'tap to add'}</span>
              </button>
            );
          })}
        </div>
        <div className={s.sub}>{picking.length} picked{picking.length ? `: ${picking.map(short).join(', ')}` : ''}</div>
        <button className={s.btn} disabled={busy || !picking.length} onClick={async () => { if (await call('confirmPlan', { stores: picking })) { setPicking([]); setFlash('Plan confirmed. In the live app it is mailed now.'); } }}>Confirm plan and send</button>
      </>) : (<>
        <div className={s.h}>Today</div>
        <div className={s.sub}>Plan confirmed {hm(plan.confirmedAt)}{plan.late ? ' (after 10:00)' : ''}.</div>
        <div className={s.card}><div className={s.cardh}>Your stops</div>
          {[...plan.stores.map(x => ({ store: x, planned: true, reason: null as string | null })), ...plan.changes.filter(c => c.kind === 'added').map(c => ({ store: c.store, planned: false, reason: c.reason }))].map((sp, k) => {
            const done = st.visits.filter(x => x.store === sp.store && x.status === 'closed').pop();
            const live = v && v.store === sp.store;
            return (
              <div key={`${sp.store}${k}`} className={s.row}>
                <div className={s.rowl}><b>{short(sp.store)}</b><span>{sp.planned ? 'planned' : `added: ${sp.reason}`}{done ? ` · ${hm(done.checkinAt)} to ${hm(done.checkoutAt)}, ${done.minutes} min` : ''}</span></div>
                {done ? <span className={`${s.pill} ${s.good}`}>visited</span> : live ? <span className={`${s.pill} ${s.blue}`}>in progress</span> : v ? <span className={`${s.pill} ${s.grey}`}>later</span> :
                  <button className={`${s.btn} ${s.small}`} onClick={() => { setCi({ kind: 'am_visit', store: sp.store, planned: sp.planned, reason: sp.reason, loc: null, photo: null, preview: null }); go('checkin'); }}>Check in</button>}
              </div>
            );
          })}
        </div>
        {!unp.open ? <button className={s.link} onClick={() => setUnp({ open: true, store: stores[0]?.store ?? '', reason: '' })}>+ Add a store that was not in the plan</button> : (
          <div className={s.card}><div className={s.cardh}>Add an unplanned store</div>
            <label className={s.lbl} htmlFor="am-us">Store</label>
            <select id="am-us" className={s.txt} value={unp.store} onChange={e => setUnp({ ...unp, store: e.target.value })}>{stores.map(x => <option key={x.store} value={x.store}>{short(x.store)}</option>)}</select>
            <label className={s.lbl} htmlFor="am-ur">Why (one line)</label>
            <input id="am-ur" className={s.txt} value={unp.reason} onChange={e => setUnp({ ...unp, reason: e.target.value })} placeholder="For example: in-charge called about a fridge breakdown" />
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className={`${s.btn} ${s.small}`} disabled={busy || !unp.reason.trim()} onClick={async () => { if (await call('addStop', { store: unp.store, reason: unp.reason })) setUnp({ open: false, store: '', reason: '' }); }}>Add</button>
              <button className={s.link} onClick={() => setUnp({ open: false, store: '', reason: '' })}>Cancel</button>
            </div>
          </div>
        )}
        <button className={`${s.btn} ${s.ghost}`} onClick={() => go('dayEnd')}>End the day and see the evening mail</button>
      </>)}
      {!v ? (
        <div className={s.card}><div className={s.cardh}>Store audit</div>
          <div className={s.sub}>The same {items.length} items with a photo on each, no day plan needed. Check-in rules are the same: within the store&apos;s circle, store-front photo.</div>
          <div className={s.chips} style={{ marginTop: 6 }}>{(['am_audit', 'qa_audit', 'other_audit'] as const).map(k => <button key={k} className={`${s.chip} ${qaKind === k ? s.chipon : ''}`} onClick={() => setQaKind(k)}>{KIND[k]}</button>)}</div>
          <div className={s.sub} style={{ marginTop: 4 }}>{KIND_NOTE[qaKind]}</div>
          <label className={s.lbl} htmlFor="am-qa">Store</label>
          <select id="am-qa" className={s.txt} value={qaStore} onChange={e => setQaStore(e.target.value)}>{stores.map(x => <option key={x.store} value={x.store}>{short(x.store)}</option>)}</select>
          <button className={`${s.btn} ${s.small}`} style={{ marginTop: 8 }} disabled={!qaStore} onClick={() => { setCi({ kind: qaKind, store: qaStore, planned: false, reason: null, loc: null, photo: null, preview: null }); go('checkin'); }}>Start the audit</button>
        </div>
      ) : null}
    </div>
  );
}
