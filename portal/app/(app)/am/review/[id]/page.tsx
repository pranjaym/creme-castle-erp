// One Area Manager app visit in full, with every photo (migration 256, in test).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccess } from '@/lib/session';
import { visitDetail, checklist, ORDER_CHECKS } from '@/lib/am';
import s from '../../am.module.css';

export const dynamic = 'force-dynamic';

function when(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export default async function AmVisit({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess(a => a.am.review);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [v, items] = await Promise.all([visitDetail(id), checklist(1)]);
  if (!v) notFound();
  const passed = items.filter(i => v.audit[i.code]?.result === 'pass').length;
  const crit = items.filter(i => i.critical && v.audit[i.code]?.result === 'fail').length;
  const mins = v.checkoutAt ? Math.round((new Date(v.checkoutAt).getTime() - new Date(v.checkinAt).getTime()) / 60000) : null;
  const img = (pid: number | null, label: string, tag?: string) => pid
    ? <a key={`${pid}`} href={`/am/photo/${pid}`} target="_blank" rel="noopener" title={label}><img loading="lazy" src={`/am/photo/${pid}`} alt={label} />{tag ? <span>{tag}</span> : null}</a>
    : null;
  return (
    <div className={s.wide}>
      <Link href="/am/review" className={s.link}>‹ All visits</Link>
      <div className={s.h}>{v.store} · {v.personName}</div>
      <div className={s.sub}>
        Checked in {when(v.checkinAt)}, {v.checkinDist} m from the pin (GPS ±{v.checkinAcc} m)
        {v.checkoutAt ? <> · out {when(v.checkoutAt)}{v.checkoutDist != null ? `, ${v.checkoutDist} m from the pin` : ', no location at check-out'} · <b>{mins} min</b></> : ' · still in progress'}
        {v.planned ? ' · planned' : ` · unplanned: ${v.unplannedReason}`}
        {v.seenAt ? ` · in-charge saw the to-dos ${when(v.seenAt)}` : ''}
      </div>
      <div className={s.card}><div className={s.cardh}>Store front</div><div className={s.thumbs}>{img(v.frontPhoto, 'Store front') ?? <span className={s.sub}>none</span>}</div></div>
      <div className={s.card}>
        <div className={s.cardh}>Audit · {passed} of {items.length} passed{crit ? ` · ${crit} critical` : ''}</div>
        <div className={s.thumbs}>{items.map(i => { const a = v.audit[i.code]; return a ? img(a.photo, i.title, `${i.code} ${a.result === 'fail' ? '✗' : '✓'}`) : null; })}</div>
        {items.filter(i => v.audit[i.code]?.result === 'fail').map(i => (
          <div key={i.code} className={s.row}><div className={s.rowl}><b>{i.code} {i.title}</b><span>{v.audit[i.code]!.note}</span></div><span className={`${s.pill} ${i.critical ? s.bad : s.warn}`}>{i.critical ? 'critical' : 'fail'}</span></div>
        ))}
        {items.filter(i => !v.audit[i.code]).length ? <div className={s.sub}>Not answered: {items.filter(i => !v.audit[i.code]).map(i => i.code).join(', ')}</div> : null}
      </div>
      <div className={s.card}><div className={s.cardh}>Order checks</div>
        {ORDER_CHECKS.map(o => { const x = v.orders[o.key]; return (
          <div key={o.key} className={s.row}><div className={s.rowl}><b>{o.title}</b><span>{x ? `${x.pending} pending` : 'not done'}</span></div><div className={s.thumbs} style={{ width: 60 }}>{x ? img(x.photo, o.title) : null}</div></div>
        ); })}
      </div>
      <div className={s.card}><div className={s.cardh}>Random count</div>
        {v.invItems.map(i => { const c = v.stock[i.item]; const d = c && c.physical != null && c.petpooja != null ? c.physical - c.petpooja : null; return (
          <div key={i.item} className={s.row}><div className={s.rowl}><b>{i.item}</b><span>counted {c?.physical ?? '-'} · Petpooja {c?.petpooja ?? '-'}{d ? ` · ${c?.reason ?? 'no reason'}` : ''}</span></div><span className={`${s.pill} ${d == null ? s.grey : d === 0 ? s.good : s.warn}`}>{d == null ? 'open' : `${d > 0 ? '+' : ''}${d}`}</span></div>
        ); })}
        <div className={s.thumbs} style={{ marginTop: 6 }}>{img(v.stockScreenPhoto, 'Petpooja stock screen', 'Petpooja')}</div>
      </div>
      <div className={s.card}><div className={s.cardh}>To-dos · {v.todos.length}</div>
        {v.todos.map(t => <div key={t.id} className={s.row}><div className={s.rowl}><b>{t.text}</b><span>{t.source}</span></div>{t.critical ? <span className={`${s.pill} ${s.bad}`}>critical</span> : null}</div>)}
        {v.nexts.length ? <><div className={s.cardh} style={{ marginTop: 8 }}>Check next visit</div>{v.nexts.map(n => <div key={n.id} className={s.row}><div className={s.rowl}><b>{n.text}</b></div></div>)}</> : null}
      </div>
      <div className={s.card}><div className={s.cardh}>Open points from earlier visits</div>
        {v.openPoints.length ? v.openPoints.map(p => <div key={`${p.kind}${p.id}`} className={s.row}><div className={s.rowl}><b>{p.text}</b></div><span className={`${s.pill} ${p.mark === 'done' ? s.good : p.mark === 'open' ? s.warn : s.grey}`}>{p.mark ?? 'not marked'}</span></div>) : <div className={s.sub}>None.</div>}
      </div>
    </div>
  );
}
