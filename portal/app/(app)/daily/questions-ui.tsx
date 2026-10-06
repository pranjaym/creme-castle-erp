// The Questions layer of the daily pages (migration 234, 26 Sep 2026): one
// small cell at the end of a row, the side drawer, and the line at the top of
// "Where you are needed". Server components only; the drawer is opened and
// closed by the URL (?ask=<row key> or ?q=<question id>), so it needs no
// client script and survives every rail click (F58).
import Link from 'next/link';
import { questionPerms, type SessionUser } from '@/lib/session';
import {
  getQuestion, getEvents, getEventsFor, causes, peopleAt, peopleAtAny, chipClass, chipLabel, orderKey, dayKey, weekKey,
  type QuestionRow, type EventRow, type Field, type AnchorType, type Cause, type Person,
} from '@/lib/questions';
import { RowBox, Thread, Flash, AskForm, ExplainForm, AnswerForm, CloseForm, Chip } from '../questions/ui';

export interface CatalogEntry {
  key: string; anchor_type: AnchorType; outlet: string; page: 'area' | 'store'; pageDate: string;
  section: string; platform: 'Z' | 'S' | null; businessDate: string | null; fields: Field[];
}

export interface Kit {
  cell: (key: string, e: Omit<CatalogEntry, 'key' | 'page' | 'pageDate'>) => React.ReactNode;
  register: (key: string, e: Omit<CatalogEntry, 'key' | 'page' | 'pageDate'>) => void;
  cellFor: (key: string) => React.ReactNode;
  catalog: Record<string, CatalogEntry>;
  order: (app: 'Z' | 'S', oid: string | null | undefined, outlet: string, section: string, businessDate: string | null, fields: Field[]) => React.ReactNode;
  day: (outlet: string, date: string, app: 'Z' | 'S' | 'ZS', section: string, fields: Field[]) => React.ReactNode;
  week: (outlet: string, weekStart: string, metric: string, section: string, fields: Field[]) => React.ReactNode;
  qmap: Map<string, QuestionRow>;
  canAsk: boolean;
  canExplain: boolean;   // a field role, on this page's outlets (migration 241)
  codes: string[];       // the page's outlets, for the people list of the instant drawer
  back: string;
}

// One kit per page render. `back` is the page's own URL (path + date), which
// every link and every form returns to.
export function questionKit(o: {
  page: 'area' | 'store'; pageDate: string; basePath: string; user?: SessionUser | null;
  qmap: Map<string, QuestionRow>; codes?: string[];
}): Kit {
  const canAsk = !!o.user && questionPerms(o.user).ask;
  const canSee = !!o.user && questionPerms(o.user).view;
  const codes = o.codes ?? [];
  // the field may explain a row on its own outlets only
  const canExplain = !!o.user && questionPerms(o.user).explain;
  const mine = (outlet: string) => !!o.user && o.user.outletCodes.includes(outlet);
  const back = `${o.basePath}?date=${o.pageDate}`;
  const catalog: Record<string, CatalogEntry> = {};
  const register: Kit['register'] = (key, e) => { catalog[key] = { key, page: o.page, pageDate: o.pageDate, ...e }; };
  const cellFor: Kit['cellFor'] = (key) => {
    if (!canSee) return null;
    const r = o.qmap.get(key);
    if (r) return <Chip r={r} href={`${back}&q=${r.id}`} />;
    // data-qkey lets dash.js open the drawer on the spot from the catalog on
    // the page; the href is the same drawer served by the server, for the
    // moment before the script is bound. A plain anchor, not a router Link:
    // the router acts on the element before a document-level listener runs,
    // so a Link could not be stopped and the page navigated instead.
    if (canAsk && catalog[key]) return <a className="qask" data-qkey={key} href={`${back}&ask=${encodeURIComponent(key)}`}>Ask</a>;
    if (canExplain && catalog[key] && mine(catalog[key].outlet)) return <a className="qask" data-qkey={key} href={`${back}&explain=${encodeURIComponent(key)}`}>Explain</a>;
    return null;
  };
  const cell: Kit['cell'] = (key, e) => { register(key, e); return cellFor(key); };
  return {
    cell, register, cellFor, catalog, qmap: o.qmap, canAsk, canExplain, codes, back,
    order: (app, oid, outlet, section, businessDate, fields) => {
      if (!oid) return null;
      return cell(orderKey(app, oid), { anchor_type: 'order', outlet, section, platform: app, businessDate, fields });
    },
    day: (outlet, date, app, section, fields) =>
      cell(dayKey(outlet, date, app), { anchor_type: 'outlet_day', outlet, section, platform: app === 'ZS' ? null : app, businessDate: date, fields }),
    week: (outlet, weekStart, metric, section, fields) =>
      cell(weekKey(outlet, weekStart, metric), { anchor_type: 'outlet_week', outlet, section, platform: null, businessDate: weekStart, fields }),
  };
}

// The header cell that goes with a question cell. Empty on purpose.
export const QCOL = '';

// The labelled fields of a row, exactly as the page prints them, for the
// snapshot. Empty and dash values are dropped so the box reads clean.
export function fields(pairs: [string, React.ReactNode | number | null | undefined][]): Field[] {
  const out: Field[] = [];
  for (const [label, v] of pairs) {
    if (v == null) continue;
    const s = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    if (!s || s === '-') continue;
    out.push({ label, value: s });
  }
  return out;
}

// The line at the top of "Where you are needed" / "Things for today".
export function QuestionsLine({ kit, user, scopeCodes }: { kit: Kit; user?: SessionUser | null; scopeCodes: string[] }) {
  if (!user || !questionPerms(user).view) return null;
  const mine = [...kit.qmap.values()].filter(r => scopeCodes.includes(r.outlet_code));
  const open = mine.filter(r => r.status === 'open');
  const overdue = open.filter(r => r.overdue);
  const answered = mine.filter(r => r.status === 'answered');
  const p = questionPerms(user);
  const door = (r: QuestionRow) => (
    <a key={r.id} data-qid={r.id} href={`${kit.back}&q=${r.id}`}>{r.outlet_code.replace(/^CC-/, '')}: {r.section.toLowerCase()}</a>
  );
  if (p.ask) {
    if (!answered.length && !open.length) return null;
    if (!answered.length) return (
      <li className="qline">
        <b>{open.length} question{open.length === 1 ? '' : 's'} open here</b>, waiting for the area manager
        {overdue.length ? <> (<span className="due">{overdue.length} overdue</span>)</> : null}.
        {' '}{open.map((r, i) => <span key={r.id}>{i ? ' · ' : ''}{door(r)}</span>)}
      </li>
    );
    return (
      <li className="qline">
        <b>{answered.length} answer{answered.length === 1 ? '' : 's'} waiting for your close</b>
        {answered.filter(r => r.started_by_field).length ? <> ({answered.filter(r => r.started_by_field).length} explained unasked)</> : null}, {open.length} still open here
        {overdue.length ? <> (<span className="due">{overdue.length} overdue</span>)</> : null}.
        {' '}{answered.map((r, i) => <span key={r.id}>{i ? ' · ' : ''}{door(r)}</span>)}
      </li>
    );
  }
  if (!open.length) return null;
  return (
    <li className="qline">
      <b>{open.length} question{open.length === 1 ? '' : 's'} waiting for your answer</b>
      {overdue.length ? <>, <span className="due">{overdue.length} overdue</span></> : null}.
      {' '}{open.map((r, i) => <span key={r.id}>{i ? ' · ' : ''}{door(r)}</span>)}
    </li>
  );
}

// The drawer. Rendered last on the page so the catalog is complete.
export async function QuestionDrawer({ kit, user, sp }: {
  kit: Kit; user?: SessionUser | null; sp: { q?: string; ask?: string; explain?: string; ok?: string; err?: string };
}) {
  if (!user || !questionPerms(user).view) return null;
  const p = questionPerms(user);
  const closeHref = kit.back;

  if (sp.ask) {
    if (!p.ask) return null;
    const e = kit.catalog[sp.ask];
    if (!e) return null;
    const live = kit.qmap.get(sp.ask);
    return (
      <Drawer closeHref={closeHref} title={e.outlet} sub="New question to the area manager">
        <Flash ok={sp.ok} err={sp.err} />
        <RowBox section={e.section} fields={e.fields} />
        {live && live.status !== 'closed'
          ? <div className="readonly">There is already an open question on this row. <Link href={`${kit.back}&q=${live.id}`}>Open it</Link>.</div>
          : <AskForm entry={e} back={kit.back} to="the area manager" />}
      </Drawer>
    );
  }

  // the field explaining a row unasked (server-rendered fallback of the instant drawer)
  if (sp.explain) {
    if (!p.explain) return null;
    const e = kit.catalog[sp.explain];
    if (!e || !user.outletCodes.includes(e.outlet)) return null;
    const live = kit.qmap.get(sp.explain);
    const [cs, people] = await Promise.all([causes(), peopleAt(e.outlet)]);
    return (
      <Drawer closeHref={closeHref} title={e.outlet} sub="Explain this row to central">
        <Flash ok={sp.ok} err={sp.err} />
        <RowBox section={e.section} fields={e.fields} />
        {live && live.status !== 'closed'
          ? <div className="readonly">There is already a question on this row. <Link href={`${kit.back}&q=${live.id}`}>Open it</Link>.</div>
          : <ExplainForm entry={e} back={kit.back} causes={cs} people={people} />}
      </Drawer>
    );
  }

  const id = Number(sp.q);
  if (!id) {
    // No drawer asked for by the URL: the Ask/Explain template, plus every
    // question on this page as a hidden drawer with its full trail, so a chip
    // opens it on the spot with no page load (6 Oct 2026, Pranjay: clicking a
    // chip scrolled the page to the top and reset the store-mistake filter,
    // and closing took as long as a page load).
    const all = [...kit.qmap.values()];
    const [evmap, cs, people] = await Promise.all([getEventsFor(all.map(r => r.id)), causes(), peopleAtAny(kit.codes)]);
    return (
      <>
        {(p.ask || kit.canExplain) ? <AskTemplate kit={kit} /> : null}
        {all.map(r => (
          <div key={r.id} id={`qthread-${r.id}`} className="qwrap" hidden>
            <Drawer closeHref={closeHref} title={r.outlet_code} sub={subFor(r)} chip={<span className={`qchip ${chipClass(r)}`}><span className="dot" />{chipLabel(r)}</span>}>
              <ThreadBody r={r} events={evmap.get(String(r.id)) ?? []} cs={cs} people={people.filter(x => x.outlet_code === r.outlet_code)} user={user} kit={kit} />
            </Drawer>
          </div>
        ))}
      </>
    );
  }
  const r = await getQuestion(id);
  if (!r) return null;
  // scope: a field role sees only its own outlets' questions
  if ((user.role === 'area_manager' || user.role === 'store') && !user.outletCodes.includes(r.outlet_code)) return null;
  const [events, cs, people] = await Promise.all([getEvents(id), causes(), peopleAt(r.outlet_code)]);
  return (
    <div className="qwrap">
      <Drawer closeHref={closeHref} title={r.outlet_code} sub={subFor(r)}
        chip={<span className={`qchip ${chipClass(r)}`}><span className="dot" />{chipLabel(r)}</span>}>
        <Flash ok={sp.ok} err={sp.err} />
        <ThreadBody r={r} events={events} cs={cs} people={people} user={user} kit={kit} />
      </Drawer>
    </div>
  );
}

function subFor(r: QuestionRow): string {
  return `Question #${r.id} · due ${new Date(r.due_at_iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}`;
}

// The inside of a question's drawer: the row, the trail, and whichever form
// this person may use. Shared by the server-rendered drawer and the hidden
// ones on the page.
function ThreadBody({ r, events, cs, people, user, kit }:
  { r: QuestionRow; events: EventRow[]; cs: Cause[]; people: Person[]; user: SessionUser; kit: Kit }) {
  const p = questionPerms(user);
  const answerable = p.answer && (user.role === 'admin' || user.outletCodes.includes(r.outlet_code)) && r.status === 'open';
  return (
    <>
      <RowBox section={r.section} fields={r.row_snapshot} />
      <Thread events={events} />
      {answerable ? <AnswerForm q={r} back={kit.back} causes={cs} people={people} /> : null}
      {p.close && r.status !== 'closed' ? <CloseForm q={r} back={kit.back} answered={r.status === 'answered'} /> : null}
      {!answerable && !p.close && r.status === 'answered'
        ? <div className="readonly">Sent. Waiting for {r.raised_by_name ?? 'central'} to accept or push back.</div> : null}
      {r.status === 'closed' ? <div className="readonly">Closed. The trail stays here for good; nothing is ever deleted.</div> : null}
    </>
  );
}

// The instant Ask drawer (26 Sep 2026, Pranjay: "very slow"). Opening the
// server-rendered drawer costs a whole page round trip, and asking is the
// thing central does most. So every row's labelled fields are on the page
// once, as JSON, and one hidden drawer with a real AskForm sits ready;
// dash.js fills it from the clicked row and shows it. The submit is the same
// server action as before. Without the script the links still work.
// For a field role the same hidden drawer carries the Explain form instead
// (migration 241): the answer boxes, with the people of every outlet on this
// page in the picker, because an area page spans the area.
async function AskTemplate({ kit }: { kit: Kit }) {
  const json = JSON.stringify(kit.catalog).replace(/</g, '\\u003c');
  const empty = { key: '', anchor_type: 'order', outlet: '', page: 'area', pageDate: kit.back.split('date=')[1] ?? '', section: '',
    platform: null, businessDate: null, fields: [] as Field[] };
  const explaining = !kit.canAsk && kit.canExplain;
  const [cs, people] = explaining ? await Promise.all([causes(), peopleAtAny(kit.codes)]) : [[], []];
  return (
    <>
      <script type="application/json" id="qcatalog" dangerouslySetInnerHTML={{ __html: json }} />
      <div id="qask-tpl" className="qwrap" hidden>
        <a className="qoverlay" href={kit.back} data-qclose="1" aria-label="Close" />
        <aside className="qdrawer">
          <a className="qd-close" href={kit.back} data-qclose="1" aria-label="Close">&times;</a>
          <div className="qd-head"><div className="sub">{explaining ? 'Explain this row to central' : 'New question to the area manager'}</div><h3 data-qtitle="1"></h3></div>
          <div className="qd-body">
            <div className="qd-row"><div className="qd-sec">The row this question is about</div><div className="qd-sectitle" data-qsection="1"></div>
              <table className="vrow"><tbody data-qfields="1"></tbody></table></div>
            {explaining
              ? <ExplainForm entry={empty} back={kit.back} causes={cs} people={people} />
              : <AskForm entry={empty} back={kit.back} to="the area manager" />}
          </div>
        </aside>
      </div>
    </>
  );
}

// Overlay and close are plain anchors: dash.js hides the drawer on the spot
// and tidies the URL; without the script the link reloads the page without
// the drawer, which is the same thing one page load later.
export function Drawer({ closeHref, title, sub, chip, children }:
  { closeHref: string; title: string; sub: string; chip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <a className="qoverlay" href={closeHref} data-qclose="1" aria-label="Close" />
      <aside className="qdrawer">
        <a className="qd-close" href={closeHref} data-qclose="1" aria-label="Close">&times;</a>
        <div className="qd-head">
          {chip ?? <div className="sub">{sub}</div>}
          <h3>{title}</h3>
          {chip ? <div className="sub">{sub}</div> : null}
        </div>
        <div className="qd-body">{children}</div>
      </aside>
    </>
  );
}
