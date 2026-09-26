// Shared pieces of the Questions module (migration 234, 26 Sep 2026). Server
// safe, no hooks: the drawer on the daily pages and the cards on /questions
// use the same row box, the same trail and the same forms, so a question
// reads identically wherever it is opened. Layout follows the approved mock
// (erp-plan/questions-mock-area-v1.html).
import Link from 'next/link';
import {
  fmtIst, chipClass, chipLabel, statusWord, firstName,
  type QuestionRow, type EventRow, type Field, type Cause, type Person,
} from '@/lib/questions';
import { askQuestion, answerQuestion, closeQuestion, pushBackQuestion } from './actions';

export const PERSON_ROLES = ['Staff', 'Store manager', 'Packer', 'Rider', 'Kitchen', 'Other'];

export function Chip({ r, href }: { r: QuestionRow; href?: string }) {
  const inner = <><span className="dot" />{chipLabel(r)}</>;
  return href
    ? <Link className={`qchip ${chipClass(r)}`} href={href}>{inner}</Link>
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
            <div className="who"><b>{e.actor_name ?? e.actor}</b> asked, {fmtIst(e.at_iso)}</div>
            <p>{e.note ?? <i>No note, the row is the question.</i>}</p>
          </div>);
        if (e.action === 'answered') return (
          <div className="ev answer" key={e.id}>
            <div className="who"><b>{e.actor_name ?? e.actor}</b> answered, {fmtIst(e.at_iso)}</div>
            <div className="lab">What happened</div><p>{e.what_happened}</p>
            <div className="lab">Cause</div><p>{e.cause_label ?? e.cause}</p>
            <div className="lab">Who was involved</div>
            <p>{e.person_name ? <>{e.person_name} <small className="muted">({e.person_role ?? 'role not recorded'})</small></> : <i>Nobody, a process problem</i>}</p>
            <div className="lab">So it does not repeat</div><p>{e.prevention}</p>
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

export function AnswerForm({ q, back, causes, people }: { q: QuestionRow; back: string; causes: Cause[]; people: Person[] }) {
  return (
    <form action={answerQuestion} className="qform">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="id" value={q.id} />
      <label>What happened</label>
      <textarea name="what" required />
      <label>What was the cause</label>
      <select name="cause" required defaultValue="">
        <option value="" disabled>Pick one</option>
        {causes.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
      </select>
      <label>Who was involved (optional)</label>
      <input name="person" list="qpeople" autoComplete="off" placeholder={`Start typing a name at ${q.outlet_code}`} />
      <datalist id="qpeople">
        {people.map(p => <option key={p.id} value={p.name}>{p.role}</option>)}
      </datalist>
      <div className="hint">Pick a name already listed at this store, or type a new one and it is added. Leave it empty if nobody was involved and it was a process problem.</div>
      <label>If this is a new name, their role</label>
      <select name="person_role" defaultValue="Staff">
        {PERSON_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <label>What you did so it does not repeat</label>
      <textarea name="prevention" required />
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
          <form action={pushBackQuestion} style={{ marginTop: 8 }}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="note" value="" />
            <button className="qbtn danger" type="submit">Push back, not an answer</button>
          </form>
          <div className="hint">Push back reopens it with a fresh 24 hours and your note goes on the trail.</div>
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
export function QuestionCard({ r, href, isNew }: { r: QuestionRow; href: string; isNew: boolean }) {
  const st = statusWord(r);
  const right = st === 'closed' ? `Closed ${fmtIst(r.closed_at_iso)}`
    : st === 'answered' ? `Answered ${fmtIst(r.answered_at_iso)}`
    : `Due ${fmtIst(r.due_at_iso)}`;
  return (
    <Link className={`qcard${isNew ? ' new' : ''}`} href={href}>
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
          <div className="meta"><b>{r.raised_by_name ?? r.raised_by}</b> asked, {fmtIst(r.raised_at_iso)}</div>
          <p>{r.prompt ?? <i className="dim">No note, the row is the question.</i>}</p>
          {r.push_backs > 0 ? <div className="meta red">Pushed back {r.push_backs} time{r.push_backs === 1 ? '' : 's'}</div> : null}
        </div>
        <div className="qc-col">
          <h4>Answer</h4>
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
    </Link>
  );
}
