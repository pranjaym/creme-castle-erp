import Link from 'next/link';
import Script from 'next/script';
import { type SessionUser, questionPerms } from '@/lib/session';
import { getLatestDate, dateLabel } from '@/lib/daily';
import { questionsForOutlets, type QuestionRow } from '@/lib/questions';
import {
  parseIssueFilters, issueQs, listIssues, inScope, sectionOf, issueFields, dayLabel,
  STATUS_WORDS, type IssueRow, type IssueFilters,
} from '@/lib/issues';
import { questionKit, QuestionDrawer } from '../questions-ui';
import { DashScript } from '../ui';
import { Flash } from '../../questions/ui';
import { askMany, closeMany } from './actions';

// "Issues to Ask", the central work queue (team prototype 14 Oct 2026, built on
// Pranjay's "yes to all four"). Every issue row the daily pages highlight,
// across the network, grouped area manager > outlet > rows, each row carrying
// the question loop. Central works the list; area managers answer from their
// own pages. The body lives here so the local harness can render it without a
// session, the same split as the other daily pages.

type RowStatus = 'none' | 'open' | 'overdue' | 'answered' | 'unasked' | 'closed';
function rowStatus(qr: QuestionRow | undefined): RowStatus {
  if (!qr) return 'none';
  if (qr.status === 'open') return qr.overdue ? 'overdue' : 'open';
  if (qr.status === 'answered') return qr.started_by_field ? 'unasked' : 'answered';
  return 'closed';
}
const KIND_CLASS: Record<string, string> = { Complaint: 'ik-c', Rejection: 'ik-r', 'Online visibility': 'ik-o' };
const PRESETS: { key: IssueFilters['days']; label: string }[] = [
  { key: '1', label: 'Latest day' }, { key: '3', label: 'Last 3 days' }, { key: '7', label: 'Last 7 days' },
  { key: '14', label: 'Last 14 days' }, { key: 'custom', label: 'Custom' },
];
const uniq = (xs: string[]) => [...new Set(xs)].sort();

export default async function IssuesView({ user, sp }: { user: SessionUser; sp: Record<string, string | undefined> }) {
  const latest = await getLatestDate();
  const f = parseIssueFilters(sp, latest);
  const all = await listIssues(f.from, f.to);
  // The outlet lists for the selects narrow with the filters above them, so a
  // filter can never name an empty set.
  const byRegion = all.filter(r => !f.region || r.region === f.region);
  const byCity = byRegion.filter(r => !f.city || r.city === f.city);
  const byAm = byCity.filter(r => !f.am || r.am === f.am);
  const scoped = all.filter(r => inScope(r, f));
  const listed = scoped.filter(r => r.issue_kind === 'Listed, not trading');
  const live = scoped.filter(r => r.issue_kind !== 'Listed, not trading');
  const codes = uniq(live.map(r => r.outlet_code));
  const qmap = await questionsForOutlets(codes);
  const st = (r: IssueRow) => rowStatus(qmap.get(r.anchor_key));
  const rows = live.filter(r => !f.status || st(r) === f.status || (f.status === 'open' && st(r) === 'overdue') || (f.status === 'answered' && st(r) === 'unasked'));

  const base = '/daily/issues';
  const here = base + issueQs(f);
  const p = questionPerms(user);
  const kit = questionKit({ page: 'issues', pageDate: f.to, basePath: base, user, qmap, codes });
  kit.back = here;
  for (const r of rows) {
    kit.register(r.anchor_key, { anchor_type: r.order_id ? 'order' : 'outlet_day', outlet: r.outlet_code, section: sectionOf(r),
      platform: r.platform, businessDate: r.business_date, fields: issueFields(r) });
  }

  const counts: Record<RowStatus, number> = { none: 0, open: 0, overdue: 0, answered: 0, unasked: 0, closed: 0 };
  for (const r of rows) counts[st(r)]++;
  const groups = new Map<string, Map<string, IssueRow[]>>();
  for (const r of rows) {
    if (!groups.has(r.am)) groups.set(r.am, new Map());
    const m = groups.get(r.am)!;
    if (!m.has(r.outlet_code)) m.set(r.outlet_code, []);
    m.get(r.outlet_code)!.push(r);
  }
  const sel = (name: string, cur: string, vals: string[], label: string, strip = false) => (
    <select name={name} defaultValue={cur}>
      <option value="">{label}</option>
      {vals.map(v => <option key={v} value={v}>{strip ? v.replace(/^CC-/, '') : v}</option>)}
    </select>
  );
  const amp = here.includes('?') ? '&' : '?';
  const window = f.from === f.to ? dateLabel(f.from) : `${dayLabel(f.from)} to ${dayLabel(f.to)}`;

  return (
    <main className="issues">
      <h1 className="page">Issues to Ask</h1>
      <p className="hint">Every outlet-day and order the daily pages highlight, across the network, grouped by area manager and outlet,
        with the question loop on each row. Tick rows to ask or close many at once. Area managers answer from their own pages.</p>

      <form method="get" action={base} className="ibar">
        <div className="f"><label>Days</label>
          <div className="presets">
            {PRESETS.map(x => <Link key={x.key} className={f.days === x.key ? 'on' : ''} href={base + issueQs({ ...f, days: x.key })}>{x.label}</Link>)}
          </div></div>
        {f.days === 'custom' ? (
          <div className="f"><label>From / to</label>
            <div className="range">
              <input type="hidden" name="days" value="custom" />
              <input type="date" name="from" defaultValue={f.from} min="2026-08-01" max={latest} />
              <span className="dim">to</span>
              <input type="date" name="to" defaultValue={f.to} min="2026-08-01" max={latest} />
            </div></div>
        ) : f.days !== '1' ? <input type="hidden" name="days" value={f.days} /> : null}
        <div className="f"><label>Region</label>{sel('region', f.region, uniq(all.map(r => r.region)), 'All')}</div>
        <div className="f"><label>City</label>{sel('city', f.city, uniq(byRegion.map(r => r.city)), 'All')}</div>
        <div className="f"><label>Area manager</label>{sel('am', f.am, uniq(byCity.map(r => r.am)), 'All')}</div>
        <div className="f"><label>Outlet</label>{sel('store', f.store, uniq(byAm.map(r => r.outlet_code)), 'All', true)}</div>
        <div className="f"><label>Platform</label>
          <select name="plat" defaultValue={f.plat}><option value="">Both</option><option value="Z">Zomato</option><option value="S">Swiggy</option></select></div>
        <div className="f"><label>Issue</label>
          <select name="type" defaultValue={f.type}><option value="">All</option>
            <option>Online visibility</option><option>Complaint</option><option>Rejection</option></select></div>
        <div className="f"><label>Status</label>
          <select name="status" defaultValue={f.status}><option value="">All</option>
            {(Object.keys(STATUS_WORDS) as (keyof typeof STATUS_WORDS)[]).map(k => <option key={k} value={k}>{STATUS_WORDS[k]}</option>)}</select></div>
        <div className="f"><label>&nbsp;</label>
          <div className="range">
            <button className="rfilter" type="submit">Apply</button>
            <Link className="rfilter" href={base}>Clear</Link>
            <a className="rfilter csv" href={`${base}/download${issueQs(f)}`}>Download CSV</a>
          </div></div>
      </form>

      <Flash ok={sp.ok} err={sp.err} />

      <p className="isum">
        <b>{rows.length}</b> issue rows, {window}, <b>{codes.length}</b> outlets in scope
        <span className="sep">&middot;</span><b>{counts.none}</b> not asked
        <span className="sep">&middot;</span><b>{counts.open + counts.overdue}</b> waiting for the area manager{counts.overdue ? <> (<span className="red">{counts.overdue} overdue</span>)</> : null}
        <span className="sep">&middot;</span><b>{counts.answered + counts.unasked}</b> waiting for central{counts.unasked ? <> ({counts.unasked} explained unasked)</> : null}
        <span className="sep">&middot;</span><b>{counts.closed}</b> closed
        {listed.length ? <><span className="sep">&middot;</span><span className="dim">{listed.length} Lucknow Zomato listed-not-trading days kept out</span></> : null}
      </p>
      <p className="note">Settled data only: the newest day offered is two days back. Row keys are the Questions module&apos;s own, so a status here is the same status on the area page and on the Questions screen.</p>

      {p.ask ? (
        <div className="ibulk" id="ibulk" hidden>
          <span className="n" id="ibulk-n">0 selected</span>
          <form action={askMany} className="inline" id="ibulk-ask">
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="page_date" value={f.to} />
            <input type="hidden" name="keys" value="" />
            <input name="prompt" className="prompt" defaultValue="What happened here, and what has been done so it does not repeat?" aria-label="Your question" />
            <button className="qbtn" type="submit" id="ibulk-askbtn">Ask selected</button>
          </form>
          <form action={closeMany} className="inline" id="ibulk-close">
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="page_date" value={f.to} />
            <input type="hidden" name="keys" value="" />
            <input name="note" className="prompt" defaultValue="Seen, no explanation needed." aria-label="Closing note" />
            <button className="qbtn ghost" type="submit" id="ibulk-closebtn">Close selected</button>
          </form>
          <button className="rfilter" type="button" id="ibulk-clear">Clear selection</button>
          <span className="dim" id="ibulk-hint"></span>
        </div>
      ) : null}
      {p.close ? (
        <form action={closeMany} id="iseen" hidden>
          <input type="hidden" name="back" value={here} />
          <input type="hidden" name="page_date" value={f.to} />
          <input type="hidden" name="note" value="Seen, no explanation needed." />
        </form>
      ) : null}

      <div className="itools">
        <button className="rfilter" type="button" data-fold="close">Collapse all outlets</button>
        <button className="rfilter" type="button" data-fold="open">Expand all outlets</button>
        <span className="legend">
          <span className="qchip none"><span className="dot" />Not asked</span>
          <span className="qchip open"><span className="dot" />Asked, waiting for the area manager</span>
          <span className="qchip overdue"><span className="dot" />Overdue</span>
          <span className="qchip answered"><span className="dot" />Explained, waiting for central</span>
          <span className="qchip closed"><span className="dot" />Closed</span>
        </span>
      </div>

      {rows.length === 0 ? <p className="dim">No issue rows for these filters.</p> : null}
      {[...groups.keys()].sort().map(am => {
        const stores = groups.get(am)!;
        const amRows = [...stores.values()].flat();
        return (
          <section className="group" key={am}>
            <div className="amhead">
              {p.ask ? <input type="checkbox" data-selam={am} aria-label={`Select every row of ${am}`} /> : null}
              <span>{am}</span>
              <span className="counts">{stores.size} outlet{stores.size === 1 ? '' : 's'} &middot; {amRows.length} rows &middot; {amRows.filter(r => st(r) === 'none').length} not asked &middot; {amRows.filter(r => st(r) === 'answered' || st(r) === 'unasked').length} waiting for central</span>
            </div>
            {[...stores.keys()].sort().map(code => {
              const list = stores.get(code)!;
              return (
                <div className="store" key={code}>
                  <div className="sthead">
                    {p.ask ? <input type="checkbox" data-selstore={code} aria-label={`Select every row of ${code}`} /> : null}
                    <span className="chev">&#9662;</span>
                    <span>{code.replace(/^CC-/, '')}</span>
                    <span className="counts">{list[0].city} &middot; {list.length} rows &middot; {list.filter(r => r.issue_type === 'Online visibility').length} visibility &middot; {list.filter(r => r.issue_type === 'Complaint').length} complaints &middot; {list.filter(r => r.issue_type === 'Rejection').length} rejections</span>
                  </div>
                  <div className="rows scroll-x">
                    <table>
                      <thead><tr>{p.ask ? <th className="chk"></th> : null}<th>Day</th><th>Time</th><th>App</th><th>Issue</th><th>What the page shows</th><th>Order no.</th><th>What was ordered</th><th>Status</th><th></th></tr></thead>
                      <tbody>
                        {list.map(r => {
                          const qr = qmap.get(r.anchor_key); const s = st(r);
                          return (
                            <tr key={r.anchor_key}>
                              {p.ask ? <td className="chk"><input type="checkbox" className="isel" data-key={r.anchor_key} data-am={am} data-store={code} data-status={s} aria-label="Select row" /></td> : null}
                              <td className="date">{dayLabel(r.business_date)}</td>
                              <td className="date">{r.order_time ?? ''}</td>
                              <td><span className={`app ${r.platform}`}>{r.platform === 'Z' ? 'ZOMATO' : 'SWIGGY'}</span></td>
                              <td><span className={`ik ${r.issue_kind.startsWith('Shop shut') ? 'ik-shut' : KIND_CLASS[r.issue_type]}`}>{r.issue_kind}</span></td>
                              <td className="detail">{r.detail}{r.value ? <> &middot; Rs. {Math.round(r.value).toLocaleString('en-IN')}</> : null}{r.refund ? <> &middot; refund Rs. {Math.round(r.refund).toLocaleString('en-IN')}</> : null}</td>
                              <td className="oid">{r.order_id ?? ''}</td>
                              <td className="what">
                                {r.basket ? <span className="basket" title={r.basket}>{r.basket}</span> : null}
                                {r.customer_asked ? <span className="askedfor">Asked for: {r.customer_asked}</span> : null}
                                {r.customer_words ? <span className="words">&ldquo;{r.customer_words}&rdquo;</span> : null}
                              </td>
                              <td className="status">{s === 'none' ? <span className="qchip none"><span className="dot" />Not asked</span> : kit.cellFor(r.anchor_key)}</td>
                              <td className="acts">
                                {s === 'none' ? kit.cellFor(r.anchor_key) : null}
                                {qr && qr.status !== 'closed' && p.close ? <a className="qask" data-qid={qr.id} href={`${here}${amp}q=${qr.id}`}>Close</a> : null}
                                {s === 'none' && p.close ? <button className="qask ghost" type="submit" form="iseen" name="key" value={r.anchor_key} title="Mark seen, no explanation needed">Seen</button> : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      <div className="dfoot">
        <p>Issue rows: Zomato online below 100% (a day at 0% with no orders is &ldquo;listed, not trading&rdquo;, kept out of the counts); Swiggy hours short of ideal;
          complaints tagged wrong item or item missing, plus complaints whose written review says a message, name, candle, knife or note was wrong or absent;
          store-caused Zomato rejections with shop-shut ones marked, and Swiggy cancellations charged to the store. The table behind this page is rebuilt
          by the morning and evening pulls for the last ten days.</p>
      </div>
      <DashScript />
      <Script src="/dash-issues.js" strategy="afterInteractive" />
      <QuestionDrawer kit={kit} user={user} sp={sp} />
    </main>
  );
}
