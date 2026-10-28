import Link from 'next/link';
import { questionPerms, type SessionUser } from '@/lib/session';
import {
  parseListFilters, listQs, listQuestions, counts, filterOptions, touchLastSeen, causes, statusWord, pushBackNotes,
  type QuestionRow,
} from '@/lib/questions';
import { QuestionCard } from './ui';
import { questionKit, QuestionDrawer } from '../daily/questions-ui';
import { DashScript } from '../daily/ui';

// The Questions screen (approved layout, 26 Sep 2026): five counters, the
// filters, then one card per question grouped Overdue, Open, Answered,
// Closed. Every card is a door to the same drawer the daily pages use. The
// CSV carries every column. "New since you last looked" is a per-person
// cursor that moves to now on every visit, so it means exactly that.
const GROUPS: { key: string; title: string }[] = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'open', title: 'Open, waiting for an answer' },
  { key: 'answered', title: 'Answered, waiting for a close' },
  { key: 'closed', title: 'Closed' },
];

// Auth lives in page.tsx; the body is here so it can be rendered in a local
// harness without a session, the same split as the daily pages.
export default async function QuestionsView({ user, sp }: { user: SessionUser; sp: Record<string, string | undefined> }) {
  const f = parseListFilters(sp);
  // The cursor moves only when the person arrives at the list. Every link the
  // list makes carries `since`, so the renders that follow (a filter, a
  // submit, a reload) keep the same marks (27 Oct 2026: the first card opened
  // used to wipe every "new" mark, and with that filter on, empty the list).
  const lastSeen = f.since || await touchLastSeen(user.email);
  f.since = lastSeen ?? '';
  const [rows, c, opts, cs] = await Promise.all([listQuestions(user, f, lastSeen), counts(user), filterOptions(user), causes()]);
  const p = questionPerms(user);
  const isNew = (r: QuestionRow) => !!lastSeen && r.latest_event_at_iso > lastSeen;
  const newCount = rows.filter(isNew).length;
  const base = '/questions';
  const here = base + listQs(f);
  // the drawer's kit: no rows to ask on here, only the threads of the listed
  // questions, and every card opens its thread on the spot, as on the daily
  // pages since 6 Oct (27 Oct 2026, Sanjeev: opening a card reloaded the list,
  // jumped to the top, and on a slow phone looked as if nothing had opened).
  // The open and answered threads sit hidden on the page with their forms. A
  // closed thread is fetched only when its card is tapped (thread/[id]):
  // hiding all of them nearly tripled the page (1.2 MB to 3.3 MB for an area
  // manager), and most cards are closed.
  const live = rows.filter(r => statusWord(r) !== 'closed');
  const qmap = new Map(live.map(r => [String(r.id), r]));
  const codes = [...new Set(live.map(r => r.outlet_code))];
  const pushed = await pushBackNotes(live.filter(r => r.status === 'open' && r.push_backs > 0).map(r => r.id));
  const kit = questionKit({ page: 'area', pageDate: '', basePath: base, user, qmap, codes });
  kit.back = here;   // back to this same filtered list

  const sel = (name: string, cur: string, all: string[], label: string) => (
    <select name={name} defaultValue={cur}>
      <option value="">{label}</option>
      {all.map(v => <option key={v} value={v}>{v}</option>)}
    </select>
  );

  return (
    <main className="qx">
      <h1 className="page">Questions</h1>
      <p className="sub">
        {p.ask
          ? 'Every question asked on the daily pages, with its answer and its trail. Every card opens the question; the CSV carries every column.'
          : 'Questions asked of you on the daily pages. Answer them here or from the row on your page.'}
      </p>

      <div className="kpis">
        <div className="k"><div className="l">Open</div><div className="v">{c.open}</div></div>
        <div className="k"><div className="l">Overdue</div><div className={c.overdue ? 'v red' : 'v'}>{c.overdue}</div></div>
        <div className="k"><div className="l">Answered, waiting close</div><div className="v">{c.answered}</div></div>
        <div className="k"><div className="l">Closed this week</div><div className="v">{c.closed_wk}</div></div>
        <div className="k"><div className="l">Median hours to answer</div><div className="v">{c.median_hours ?? '-'}</div></div>
        <div className="k"><div className="l">Explained unasked, this week</div><div className="v">{c.explained_wk}</div></div>
      </div>

      <form method="get" action={base} className="qtools">
        <Link className={f.newonly ? 'rfilter on' : 'rfilter'} href={base + listQs({ ...f, newonly: !f.newonly })}>
          New since you last looked ({newCount})
        </Link>
        <select name="status" defaultValue={f.status}>
          <option value="">Any status</option>
          <option value="overdue">overdue</option><option value="open">open</option>
          <option value="answered">answered</option><option value="closed">closed</option>
        </select>
        {sel('store', f.store, opts.stores, 'All stores')}
        {p.ask ? sel('am', f.am, opts.ams, 'All area managers') : null}
        {sel('section', f.section, opts.sections, 'All sections')}
        <select name="cause" defaultValue={f.cause}>
          <option value="">Any cause</option>
          {cs.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}
        </select>
        {sel('person', f.person, opts.people, 'Anyone')}
        <Link className={f.explained ? 'rfilter on' : 'rfilter'} href={base + listQs({ ...f, explained: !f.explained })}>Explained unasked</Link>
        {f.newonly ? <input type="hidden" name="new" value="1" /> : null}
        {f.explained ? <input type="hidden" name="explained" value="1" /> : null}
        {f.since ? <input type="hidden" name="since" value={f.since} /> : null}
        <button className="rfilter" type="submit">Apply</button>
        {(f.status || f.store || f.am || f.section || f.cause || f.person || f.newonly || f.explained)
          ? <Link className="rfilter" href={base + listQs({ ...parseListFilters({}), since: f.since })}>Clear</Link> : null}
        <a className="rfilter csv" href={'/questions/download' + listQs(f)}>Download CSV</a>
      </form>

      {rows.length === 0 ? <p className="dim">Nothing matches these filters.</p> : null}
      {GROUPS.map(g => {
        const grp = rows.filter(r => statusWord(r) === g.key);
        if (!grp.length) return null;
        return (
          <section key={g.key}>
            <h2 className="qgrp"><span className={`qchip ${g.key}`}><span className="dot" />{g.title}</span><span className="cnt">{grp.length}</span></h2>
            {grp.map(r => <QuestionCard key={r.id} r={r} href={`${here}${here.includes('?') ? '&' : '?'}q=${r.id}`} isNew={isNew(r)}
              pushedBack={pushed.get(String(r.id))}
              thread={g.key === 'closed' ? `/questions/thread/${r.id}?back=${encodeURIComponent(here)}` : undefined} />)}
          </section>
        );
      })}

      <QuestionDrawer kit={kit} user={user} sp={sp} />
      <DashScript />
    </main>
  );
}
