// Shared pieces of the Questions module (migration 234, 26 Sep 2026). Server
// safe, no hooks: the drawer on the daily pages and the cards on /questions
// use the same row box, the same trail and the same forms, so a question
// reads identically wherever it is opened. Layout follows the approved mock
// (erp-plan/questions-mock-area-v1.html).
import Script from 'next/script';
import {
  fmtIst, chipClass, chipLabel, statusWord, firstName, MAX_PHOTOS,
  type QuestionRow, type EventRow, type Field, type Cause, type Person,
} from '@/lib/questions';
import { askQuestion, answerQuestion, closeQuestion, pushBackQuestion, explainQuestion } from './actions';

export const PERSON_ROLES = ['Staff', 'Store manager', 'Packer', 'Rider', 'Kitchen', 'Other'];

// With an href the chip is a plain anchor carrying the question id: dash.js
// opens the thread that is already on the page, and only without the script
// does the browser follow the link to the server-rendered drawer.
export function Chip({ r, href }: { r: QuestionRow; href?: string }) {
  const inner = <><span className="dot" />{chipLabel(r)}</>;
  return href
    ? <a className={`qchip ${chipClass(r)}`} data-qid={r.id} href={href}>{inner}</a>
    : <span className={`qchip ${chipClass(r)}`}>{inner}</span>;
}

// The row a question was asked on, vertical, every column with its own label.
export function RowBox({ section, fields, small }: { section: string; fields: Field[]; small?: boolean }) {
  return (
    <div className="qd-row">
      <div className="qd-sec">The row this question is about</div>
      <div className="qd-sectitle">{section}</div>
      <table className={small ? 'vrow small' : 'vrow'}><tbody>
        {fields.map((f, i) => <tr key={i}><th>{f.label}</th><td>{f.value}</td></tr>)}
      </tbody></table>
    </div>
  );
}

export function Thread({ events }: { events: EventRow[] }) {
  return (
    <>
      {events.map(e => {
        if (e.action === 'asked') return (
          <div className="ev ask" key={e.id}>
            <div className="who"><b>{e.actor_name ?? e.actor}</b> {e.note === 'Explained without being asked.' ? 'explained this row without being asked' : 'asked'}, {fmtIst(e.at_iso)}</div>
            {e.note === 'Explained without being asked.' ? null : <p>{e.note ?? <i>No note, the row is the question.</i>}</p>}
          </div>);
        if (e.action === 'answered') return (
          <div className="ev answer" key={e.id}>
            <div className="who"><b>{e.actor_name ?? e.actor}</b> answered, {fmtIst(e.at_iso)}</div>
            <div className="lab">What happened</div><p>{e.what_happened}</p>
            <div className="lab">Cause</div><p>{e.cause_label ?? e.cause}</p>
            <div className="lab">Who was involved</div>
            <p>{e.person_name ? <>{e.person_name} <small className="muted">({e.person_role ?? 'role not recorded'})</small></> : <i>Nobody, a process problem</i>}</p>
            <div className="lab">So it does not repeat</div><p>{e.prevention}</p>
            {e.photo_ids?.length ? (
              <>
                <div className="lab">Photos</div>
                <div className="qphotos">
                  {e.photo_ids.map(id => (
                    <a key={id} href={`/questions/photo/${id}`} target="_blank" rel="noopener">
                      <img src={`/questions/photo/${id}`} alt="Photo sent with this answer" loading="lazy" />
                    </a>
                  ))}
                </div>
              </>
            ) : null}
          </div>);
        if (e.action === 'pushed_back') return (
          <div className="ev back" key={e.id}>
            <div className="who"><b>{e.actor_name ?? e.actor}</b> pushed back, {fmtIst(e.at_iso)}</div>
            <p>{e.note}</p>
          </div>);
        return (
          <div className="ev close" key={e.id}>
            <div className="who"><b>{e.actor_name ?? e.actor}</b> accepted and closed, {fmtIst(e.at_iso)}</div>
            {e.note ? <p>{e.note}</p> : null}
          </div>);
      })}
    </>
  );
}

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return <p className={err ? 'qflash err' : 'qflash ok'}>{err ?? ok}</p>;
}

// ---------- forms ----------
export function AskForm({ entry, back, to }: {
  entry: { key: string; anchor_type: string; outlet: string; page: string; pageDate: string; section: string;
           platform: string | null; businessDate: string | null; fields: Field[] };
  back: string; to: string;
}) {
  return (
    <form action={askQuestion} className="qform">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="anchor_key" value={entry.key} />
      <input type="hidden" name="anchor_type" value={entry.anchor_type} />
      <input type="hidden" name="outlet" value={entry.outlet} />
      <input type="hidden" name="page" value={entry.page} />
      <input type="hidden" name="page_date" value={entry.pageDate} />
      <input type="hidden" name="section" value={entry.section} />
      <input type="hidden" name="platform" value={entry.platform ?? ''} />
      <input type="hidden" name="business_date" value={entry.businessDate ?? ''} />
      <input type="hidden" name="snapshot" value={JSON.stringify(entry.fields)} />
      <label>What do you want to know? (optional, one line)</label>
      <textarea name="prompt" placeholder="e.g. Was the stock sent, or was it not switched on in the tablet?" />
      <label>Answer due</label>
      <input value="24 hours from now" readOnly />
      <div className="hint">Overdue turns red on {to}&apos;s page and on the Questions screen. Nothing closes by itself.</div>
      <button className="qbtn" type="submit">Ask {to}</button>
    </form>
  );
}

// The answer boxes, shared by AnswerForm (a question central asked) and
// ExplainForm (the field starting the record itself). Same words both ways.
// `prev` is the answer central pushed back: its words are filled in so the
// area manager corrects it rather than typing it all again (27 Oct 2026).
// A new answer is still a new record; the pushed-back one stays on the trail.
function AnswerFields({ outlet, causes, people, listId, prev }:
  { outlet: string; causes: Cause[]; people: Person[]; listId: string; prev?: QuestionRow }) {
  return (
    <>
      <label>What happened</label>
      <textarea name="what" required defaultValue={prev?.what_happened ?? undefined} />
      <label>What was the cause</label>
      <select name="cause" required defaultValue={prev?.cause ?? ''}>
        <option value="" disabled>Pick one</option>
        {causes.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
      </select>
      <label>Who was involved (optional)</label>
      <input name="person" list={listId} autoComplete="off" defaultValue={prev?.person_name ?? undefined} placeholder={outlet ? `Start typing a name at ${outlet}` : 'Start typing a name'} />
      <datalist id={listId}>
        {people.map(p => <option key={p.id} value={p.name}>{p.role}{p.outlet_code && p.outlet_code !== outlet ? ` · ${p.outlet_code}` : ''}</option>)}
      </datalist>
      <div className="hint">Pick a name already listed at this store, or type a new one and it is added. Leave it empty if nobody was involved and it was a process problem.</div>
      <label>If this is a new name, their role</label>
      <select name="person_role" defaultValue={prev?.person_role && PERSON_ROLES.includes(prev.person_role) ? prev.person_role : 'Staff'}>
        {PERSON_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <label>What you did so it does not repeat</label>
      <textarea name="prevention" required defaultValue={prev?.prevention ?? undefined} />
      <label>Photos (optional, up to {MAX_PHOTOS})</label>
      {prev ? <div className="hint">Photos sent with the earlier answer stay on the trail above; add new ones only if they help.</div> : null}
      <input type="file" name="photos" accept="image/*" multiple data-qphoto="1" />
      <div className="qphoto-picked" data-qphoto-picked="1" />
      <div className="hint">For example the dispatch photo. Take one or pick from the gallery. They are made smaller before sending.</div>
      <Script src="/qphoto.js" strategy="afterInteractive" />
    </>
  );
}

// The field role starting the record unasked (migration 241, 29 Sep 2026):
// the row, the same four answers, and it lands in central's close queue.
export function ExplainForm({ entry, back, causes, people }: {
  entry: { key: string; anchor_type: string; outlet: string; page: string; pageDate: string; section: string;
           platform: string | null; businessDate: string | null; fields: Field[] };
  back: string; causes: Cause[]; people: Person[];
}) {
  return (
    <form action={explainQuestion} className="qform">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="anchor_key" value={entry.key} />
      <input type="hidden" name="anchor_type" value={entry.anchor_type} />
      <input type="hidden" name="outlet" value={entry.outlet} />
      <input type="hidden" name="page" value={entry.page} />
      <input type="hidden" name="page_date" value={entry.pageDate} />
      <input type="hidden" name="section" value={entry.section} />
      <input type="hidden" name="platform" value={entry.platform ?? ''} />
      <input type="hidden" name="business_date" value={entry.businessDate ?? ''} />
      <input type="hidden" name="snapshot" value={JSON.stringify(entry.fields)} />
      <AnswerFields outlet={entry.outlet} causes={causes} people={people} listId="qpeople-x" />
      <div className="hint">Central sees this as waiting for their close, the same as an answer.</div>
      <button className="qbtn" type="submit">Send explanation to central</button>
    </form>
  );
}

export function AnswerForm({ q, back, causes, people }: { q: QuestionRow; back: string; causes: Cause[]; people: Person[] }) {
  // open with an answer on it means central pushed that answer back
  const prev = q.push_backs > 0 && q.what_happened ? q : undefined;
  return (
    <form action={answerQuestion} className="qform">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="id" value={q.id} />
      {prev ? <div className="hint">Central pushed your answer back; their note is on the trail above. Your answer is filled in below: change what is wrong and send it again.</div> : null}
      <AnswerFields outlet={q.outlet_code} causes={causes} people={people} listId={`qpeople-${q.id}`} prev={prev} />
      <button className="qbtn" type="submit">Send answer to {firstName(q.raised_by_name)}</button>
    </form>
  );
}

export function CloseForm({ q, back, answered }: { q: QuestionRow; back: string; answered: boolean }) {
  return (
    <div className="qform">
      {answered ? (
        <>
          <form action={closeQuestion} id={`close-${q.id}`}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="id" value={q.id} />
            <label>Your note (optional)</label>
            <textarea name="note" />
            <button className="qbtn" type="submit">Accept and close</button>
          </form>
          {/* 27 Oct 2026: push back used to post an empty note, so the area
              manager only ever read the default line and could not tell what
              to fix. The note is now required. */}
          <form action={pushBackQuestion} style={{ marginTop: 14 }}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="id" value={q.id} />
            <label>Not an answer? Say what is wrong</label>
            <textarea name="note" required placeholder="e.g. The name is wrong: Ravi was on leave that day. Check the KOT and the dispatch photo." />
            <button className="qbtn danger" type="submit">Push back to {q.am ?? 'the area manager'}</button>
          </form>
          <div className="hint">Push back reopens it with a fresh 24 hours. Your note goes on the trail, and their earlier answer comes back filled in for them to correct.</div>
        </>
      ) : (
        <>
          <div className="readonly">Waiting for {q.am ?? 'the area manager'}. They see this at the top of their page and on the Questions screen. You can close it yourself if it is no longer needed.</div>
          <form action={closeQuestion}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="note" value="Closed without an answer." />
            <button className="qbtn ghost" type="submit" style={{ marginLeft: 0 }}>Close without an answer</button>
          </form>
        </>
      )}
    </div>
  );
}

// ---------- the card on /questions ----------
// A plain anchor carrying the question id, like the chip: dash.js opens the
// thread that is already on the page, and only without the script does the
// browser follow the link to the server-rendered drawer (27 Oct 2026). A
// closed card's thread is not on the page; `thread` is where dash.js fetches it.
export function QuestionCard({ r, href, isNew, thread, pushedBack }: {
  r: QuestionRow; href: string; isNew: boolean; thread?: string;
  pushedBack?: { note: string | null; by: string | null; at_iso: string };   // open again after a push-back
}) {
  const st = statusWord(r);
  const right = st === 'closed' ? `Closed ${fmtIst(r.closed_at_iso)}`
    : st === 'answered' ? `Answered ${fmtIst(r.answered_at_iso)}`
    : `Due ${fmtIst(r.due_at_iso)}`;
  return (
    <a className={`qcard${isNew ? ' new' : ''}`} data-qid={r.id} data-qthread={thread} href={href}>
      <div className="qc-head">
        <b>{r.outlet_code}</b><span className="sep">&middot;</span><span>{r.section}</span>
        <span className="sep">&middot;</span><span className="dim">#{r.id}</span>
        {r.am ? <><span className="sep">&middot;</span><span className="dim">{r.am}</span></> : null}
        <span className={`right${st === 'overdue' ? ' red' : ''}`}>{right}</span>
      </div>
      <div className="qc-body">
        <div className="qc-col">
          <h4>The row it was asked on</h4>
          <table className="vrow small"><tbody>
            {r.row_snapshot.map((f, i) => <tr key={i}><th>{f.label}</th><td>{f.value}</td></tr>)}
          </tbody></table>
        </div>
        <div className="qc-col">
          <h4>Question</h4>
          {r.started_by_field ? (
            <>
              <div className="meta"><b>{r.raised_by_name ?? r.raised_by}</b> explained this row, {fmtIst(r.raised_at_iso)}</div>
              <p><span className="ptag">Explained without being asked</span></p>
            </>
          ) : (
            <>
              <div className="meta"><b>{r.raised_by_name ?? r.raised_by}</b> asked, {fmtIst(r.raised_at_iso)}</div>
              <p>{r.prompt ?? <i className="dim">No note, the row is the question.</i>}</p>
            </>
          )}
          {r.push_backs > 0 ? <div className="meta red">Pushed back {r.push_backs} time{r.push_backs === 1 ? '' : 's'}</div> : null}
        </div>
        <div className="qc-col">
          <h4>{pushedBack && r.what_happened ? 'Answer, not accepted' : 'Answer'}</h4>
          {pushedBack && r.what_happened ? (
            <div className="meta red">
              <b>{pushedBack.by ?? 'Central'}</b> pushed back, {fmtIst(pushedBack.at_iso)}: {pushedBack.note}
              {' '}Waiting for a new answer from {r.am ?? 'the area manager'}.
            </div>
          ) : null}
          {r.what_happened ? (
            <>
              <div className="meta"><b>{r.answered_by_name}</b> answered, {fmtIst(r.answered_at_iso)}</div>
              <p>{r.what_happened}</p>
              <div className="tags">
                <span className="ptag">{r.cause_label ?? r.cause}</span>
                <span className="ptag">{r.person_name ? `${r.person_name} · ${r.person_role ?? ''}` : 'Nobody, a process problem'}</span>
              </div>
              <div className="meta" style={{ marginTop: 8 }}>So it does not repeat</div>
              <p>{r.prevention}</p>
            </>
          ) : <p className="dim"><i>Waiting for {r.am ?? 'the area manager'}.</i></p>}
          {st === 'closed' ? <div className="meta green"><b>{r.closed_by_name}</b> accepted and closed, {fmtIst(r.closed_at_iso)}</div> : null}
        </div>
      </div>
    </a>
  );
}
