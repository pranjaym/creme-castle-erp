// Every Area Manager visit, newest first (AM visit app, in test). For the owner
// and anyone with the am:review grant. Each row opens the visit in full.
import Link from 'next/link';
import { requireAccess } from '@/lib/session';
import { allVisits, checklist } from '@/lib/am';
import { q } from '@/lib/db';
import s from '../../_fieldapp/am.module.css';

export const dynamic = 'force-dynamic';

function when(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export default async function AmReview() {
  await requireAccess(a => a.am.review);
  const [visits, items, plans, pins] = await Promise.all([
    allVisits('visit'),
    checklist(1),
    q<{ person_name: string | null; plan_date: string; stores: string[]; confirmed_at: string; late: boolean; added: number; missed: number }>(
      `select p.person_name, p.plan_date, p.stores, p.confirmed_at, p.late,
              (select count(*) from am.plan_change c where c.plan_id = p.id and c.kind = 'added')::int added,
              (select count(*) from am.plan_change c where c.plan_id = p.id and c.kind = 'missed')::int missed
         from am.plan p where p.voided_at is null order by p.confirmed_at desc limit 50`),
    q<{ store: string; reported_by_name: string | null; dist_m: number | null; reported_at: string }>(
      'select store, reported_by_name, dist_m, reported_at from am.store_pin_report order by id desc limit 30'),
  ]);
  return (
    <div className={s.wide}>
      <div className={s.testband}><b>Test version.</b> Everything here is test data and will be cleared from all reports before the app goes live.</div>
      <div className={s.h}>All visits</div>
      <div className={s.card}><div className={s.scroll}>
        <table className={s.table}>
          <thead><tr><th>Checked in</th><th>Store</th><th>By</th><th>Minutes</th><th>Audit</th><th>To-dos</th><th>Status</th></tr></thead>
          <tbody>
            {visits.length ? visits.map(v => (
              <tr key={v.id}>
                <td><Link href={`/area-manager-visit/review/${v.id}`}>{when(v.checkinAt)}</Link></td>
                <td>{v.store.replace(/^CC-/, '')}{v.planned ? '' : ' (unplanned)'}</td>
                <td>{v.personName}</td>
                <td>{v.minutes ?? ''}</td>
                <td>{v.passed}/{items.length}{v.critical ? <span className={`${s.pill} ${s.bad}`} style={{ marginLeft: 6 }}>{v.critical} critical</span> : null}</td>
                <td>{v.todos}</td>
                <td><span className={`${s.pill} ${v.status === 'closed' ? s.good : s.blue}`}>{v.status === 'closed' ? 'closed' : 'in progress'}</span></td>
              </tr>
            )) : <tr><td colSpan={7}>No visits yet.</td></tr>}
          </tbody>
        </table>
      </div></div>
      <div className={s.h}>Day plans</div>
      <div className={s.card}><div className={s.scroll}>
        <table className={s.table}>
          <thead><tr><th>Day</th><th>By</th><th>Confirmed</th><th>Stops</th><th>Added</th><th>Missed</th></tr></thead>
          <tbody>
            {plans.length ? plans.map((p, i) => (
              <tr key={i}><td>{p.plan_date}</td><td>{p.person_name}</td><td>{when(p.confirmed_at)}{p.late ? ' (late)' : ''}</td><td>{p.stores.map(x => x.replace(/^CC-/, '')).join(', ')}</td><td>{p.added}</td><td>{p.missed}</td></tr>
            )) : <tr><td colSpan={6}>No plans yet.</td></tr>}
          </tbody>
        </table>
      </div></div>
      <div className={s.h}>Store pins reported as wrong</div>
      <div className={s.card}>
        {pins.length ? pins.map((p, i) => <div key={i} className={s.row}><div className={s.rowl}><b>{p.store}</b><span>{p.reported_by_name} · {when(p.reported_at)} · app said {p.dist_m ?? '?'} m away</span></div></div>)
          : <div className={s.sub}>None reported.</div>}
      </div>
    </div>
  );
}
