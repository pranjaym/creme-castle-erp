// Admin · Today: the compass, not the workplace (the OMS OutletBrief
// principle). One glance per department: did yesterday close, do the counts
// tie out, what is unconfirmed, what is being asked for, what went to waste.
// Every tile is a DOOR into the filtered view that explains its number; green
// tiles need no visit. All green = the kitchen's morning is over.
import Link from 'next/link';
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, ymdAddDays, weekdayForYmd } from '@/lib/business-day';
import { currentDeptDay } from '@/lib/dept-day.mjs';

export const dynamic = 'force-dynamic';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

export default async function AdminTodayPage() {
  const db = spine();
  const now = new Date();
  const today = istCalendarDate(now);

  const { data: depts } = await db
    .from('department_settings')
    .select('location_id, day_start_time, closing_before, sort_order, locations(id, code, name)')
    .eq('active', true).order('sort_order');

  const blocks = await Promise.all((depts ?? []).map(async (d: any) => {
    const code: string = d.locations.code;
    const name: string = d.locations.name;
    const openDay = currentDeptDay(now, d.day_start_time);
    const lastClosedDay = ymdAddDays(openDay, -1);

    const [{ data: ledToday }, { data: ledPrev }, { count: pendingN }, { count: openReqN }, { count: closedRowsN }] =
      await Promise.all([
        db.from('v_dept_day_ledger').select('made, sent, wasted, receipts_pending').eq('dept_code', code).eq('business_date', openDay),
        db.from('v_dept_day_ledger').select('gap, closing').eq('dept_code', code).eq('business_date', lastClosedDay),
        db.from('v_pending_receipts').select('*', { count: 'exact', head: true }).eq('to_code', code),
        db.from('v_request_status').select('*', { count: 'exact', head: true }).eq('maker_code', code).in('state', ['open', 'partial']),
        db.from('v_closing_effective').select('*', { count: 'exact', head: true })
          .eq('location_id', d.locations.id).eq('business_date', lastClosedDay),
      ]);

    const madeItems = (ledToday ?? []).filter((r: any) => Number(r.made) > 0).length;
    const madeQty = (ledToday ?? []).reduce((s: number, r: any) => s + Number(r.made), 0);
    const sentQty = (ledToday ?? []).reduce((s: number, r: any) => s + Number(r.sent), 0);
    const wasteQty = (ledToday ?? []).reduce((s: number, r: any) => s + Number(r.wasted), 0);
    const closingDone = (closedRowsN ?? 0) > 0;
    const gaps = (ledPrev ?? []).filter((r: any) => r.gap != null && Number(r.gap) !== 0).length;

    return {
      code, name, openDay, lastClosedDay,
      dayStart: String(d.day_start_time).slice(0, 5),
      madeItems, madeQty, sentQty, wasteQty,
      closingDone, gaps, pendingN: pendingN ?? 0, openReqN: openReqN ?? 0,
    };
  }));

  const ledgerHref = (code: string, day: string) => `/admin/ledger?dept=${code}&from=${day}&to=${day}`;

  return (
    <>
      <div className="adminhead">
        <span className="title">Today</span>
        <span className="blurb">{weekdayForYmd(today)} {today} · every tile opens the view that explains it · all green = the kitchen is clean</span>
      </div>
      <div className="adminbody">
        {blocks.map((b) => (
          <div className="deptblock" key={b.code}>
            <div className="dephead">
              <span className="nm">{b.name}</span>
              <span className="dy">production day {b.openDay} (starts {b.dayStart}) · previous day {b.lastClosedDay}</span>
            </div>
            <div className="doorgrid">
              <Link className="door" href={ledgerHref(b.code, b.openDay)}>
                <div className="k">Made today</div>
                <div className="v">{fmt(b.madeQty)}</div>
                <div className="s">{b.madeItems} item{b.madeItems === 1 ? '' : 's'} · open ledger ›</div>
              </Link>
              <Link className={`door ${b.closingDone ? 'good' : 'warn'}`} href={ledgerHref(b.code, b.lastClosedDay)}>
                <div className="k">Closing {b.lastClosedDay.slice(5)}</div>
                <div className="v">{b.closingDone ? 'Done' : 'Missing'}</div>
                <div className="s">{b.closingDone ? 'counted · see the day ›' : 'no count saved yet ›'}</div>
              </Link>
              <Link className={`door ${!b.closingDone ? '' : b.gaps ? 'bad' : 'good'}`} href={ledgerHref(b.code, b.lastClosedDay)}>
                <div className="k">Gaps {b.lastClosedDay.slice(5)}</div>
                <div className="v">{b.closingDone ? b.gaps : '?'}</div>
                <div className="s">{b.closingDone ? (b.gaps ? 'counts disagree with entries ›' : 'everything ties out ›') : 'needs a closing first ›'}</div>
              </Link>
              <Link className={`door ${b.pendingN ? 'warn' : 'good'}`} href={`/admin/transfers?dept=${b.code}`}>
                <div className="k">Unconfirmed in</div>
                <div className="v">{b.pendingN}</div>
                <div className="s">{b.pendingN ? 'sent to them, not confirmed ›' : 'all receipts confirmed ›'}</div>
              </Link>
              <Link className={`door ${b.openReqN ? 'warn' : 'good'}`} href={`/admin/requests?state=open&maker=${b.code}`}>
                <div className="k">Asked of them</div>
                <div className="v">{b.openReqN}</div>
                <div className="s">{b.openReqN ? 'purchase requests waiting ›' : 'no open requests ›'}</div>
              </Link>
              <Link className={`door ${b.wasteQty > 0 ? 'warn' : 'good'}`} href={ledgerHref(b.code, b.openDay)}>
                <div className="k">Waste today</div>
                <div className="v">{fmt(b.wasteQty)}</div>
                <div className="s">{b.wasteQty > 0 ? 'reason-coded · see items ›' : 'nothing wasted ›'}</div>
              </Link>
            </div>
          </div>
        ))}
        <p className="hint">
          Numbers are live for each department&rsquo;s own production day (its day starts at its own hour, not midnight).
          The team screens stay the workplace; this page is the compass.
        </p>
      </div>
    </>
  );
}
