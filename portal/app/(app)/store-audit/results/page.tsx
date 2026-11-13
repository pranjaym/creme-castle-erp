// Store audit app results (in test): every store audit, newest first, and this
// month's points by store. For the owner and anyone with audit:review.
import Link from 'next/link';
import { requireAccess } from '@/lib/session';
import { allVisits, checklist, storeResults, KIND_NAMES, type VisitKind } from '@/lib/am';
import s from '../../_fieldapp/am.module.css';

export const dynamic = 'force-dynamic';

function when(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export default async function StoreAuditResults({ searchParams }: { searchParams: Promise<{ am?: string }> }) {
  const amF = (await searchParams).am ?? '';
  await requireAccess(a => a.audit.review);
  const [visits, items, results] = await Promise.all([allVisits('audit'), checklist(1), storeResults()]);

  const kindName = (k: string) => KIND_NAMES[k as VisitKind] ?? k;
  const ams = Array.from(new Set(results.map(r => r.am)));
  const shown = results.filter(r => !amF || r.am === amF);
  const pts = (p: number | null, stand: boolean) => (p == null ? '' : `${p} of 15${stand ? ' (stands in)' : ''}`);
  return (
    <div className={s.wide}>
      <div className={s.testband}><b>Test version.</b> Everything here is test data and will be cleared from all reports before the app goes live.</div>
      <div className={s.h}>Audit results by store, this month</div>
      <div className={s.sub}>Latest closed AM monthly audit and latest QA surprise audit per store; Other visits score nothing. Points on the proposed line: 15 at 25 or more of {items.length} passed, 0 at 19 or fewer, straight line between. If one audit is missing the other counts for both. Any critical fail this month caps the store&apos;s month at 60.</div>
      <div className={s.chips}>
        <Link href="/store-audit/results" className={`${s.chip} ${!amF ? s.chipon : ''}`}>All</Link>
        {ams.map(a => <Link key={a} href={`/store-audit/results?am=${encodeURIComponent(a)}`} className={`${s.chip} ${a === amF ? s.chipon : ''}`}>{a}</Link>)}
      </div>
      <div className={s.card}><div className={s.scroll}>
        <table className={s.table}>
          <thead><tr><th>Area Manager</th><th>Store</th><th>AM audit</th><th>AM points</th><th>QA audit</th><th>QA points</th><th>Critical</th><th>Audits</th></tr></thead>
          <tbody>
            {shown.length ? shown.map(r => (
              <tr key={r.store}>
                <td>{r.am}</td><td>{r.store.replace(/^CC-/, '')}</td>
                <td>{r.amVisit ? <Link href={`/store-audit/results/${r.amVisit.id}`}>{r.amVisit.passed}/{items.length}, {when(r.amVisit.at)}</Link> : 'none'}</td>
                <td><b>{pts(r.amPoints, r.standIn === 'qa')}</b></td>
                <td>{r.qaVisit ? <Link href={`/store-audit/results/${r.qaVisit.id}`}>{r.qaVisit.passed}/{items.length}, {when(r.qaVisit.at)}</Link> : 'none'}</td>
                <td><b>{pts(r.qaPoints, r.standIn === 'am')}</b></td>
                <td>{r.capped ? <span className={`${s.pill} ${s.bad}`}>{r.critical} fail, month capped at 60</span> : <span className={`${s.pill} ${s.good}`}>none</span>}</td>
                <td>{r.audits}</td>
              </tr>
            )) : <tr><td colSpan={8}>No closed audits this month yet.</td></tr>}
          </tbody>
        </table>
      </div></div>
      <div className={s.h}>All store audits</div>
      <div className={s.card}><div className={s.scroll}>
        <table className={s.table}>
          <thead><tr><th>Started</th><th>Type</th><th>Store</th><th>By</th><th>Minutes</th><th>Passed</th><th>To-dos</th><th>Status</th></tr></thead>
          <tbody>
            {visits.length ? visits.map(v => (
              <tr key={v.id}>
                <td><Link href={`/store-audit/results/${v.id}`}>{when(v.checkinAt)}</Link></td>
                <td>{kindName(v.kind)}</td>
                <td>{v.store.replace(/^CC-/, '')}</td>
                <td>{v.personName}</td>
                <td>{v.minutes ?? ''}</td>
                <td>{v.passed}/{items.length}{v.critical ? <span className={`${s.pill} ${s.bad}`} style={{ marginLeft: 6 }}>{v.critical} critical</span> : null}</td>
                <td>{v.todos}</td>
                <td><span className={`${s.pill} ${v.status === 'closed' ? s.good : s.blue}`}>{v.status === 'closed' ? 'closed' : 'in progress'}</span></td>
              </tr>
            )) : <tr><td colSpan={8}>No audits yet.</td></tr>}
          </tbody>
        </table>
      </div></div>
    </div>
  );
}
