import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { spine } from '@/lib/supabase/service';
import { saveOutlet } from '../actions';

// The outlet glossary screen. (F39, step 4)
//
// An outlet missing its city, store type or location code does not error and does not
// warn: it silently drops out of every city and store-type view on the dashboard.
// CC-DL-South Campus and CC-PB-Ludhiana sat like that for 40 and 17 days. This screen
// is the queue for exactly that, plus the outlet watch's own open questions.
export const dynamic = 'force-dynamic';

const STORE_TYPES = ['Dark Store', 'Spoke Kitchen'];

function rs(n: number | null | undefined): string {
  if (!n) return '0';
  return Math.round(n).toLocaleString('en-IN');
}

const WATCH_SAYS: Record<string, string> = {
  unmapped: 'Not in the outlet master, so its orders belong to no store',
  new: 'New name. Is this a new store, a rename, or a relocation?',
  quiet: 'No orders for over a week. Closed, renamed, or a feed problem?',
  reopening: 'Shut, expected back on the date below',
  overdue: 'Was due back and is still not trading',
};

export default async function OutletGlossaryPage({ searchParams }:
  { searchParams: Promise<{ ok?: string; err?: string; all?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const showAll = sp.all === '1';
  const canEdit = user.role === 'admin' || user.role === 'central';

  const db = spine();
  const [gapsRes, watchRes, allRes, renameRes] = await Promise.all([
    db.from('outlet_glossary_gaps').select('*').order('revenue', { ascending: false }),
    db.from('outlet_watch').select('*').neq('status', 'ok').order('status'),
    db.from('outlets').select('*').order('internal_code'),
    db.from('outlet_rename_suspects').select('*'),
  ]);
  const gaps = gapsRes.data ?? [];
  const watch = watchRes.data ?? [];
  const all = allRes.data ?? [];
  const renames = renameRes.data ?? [];

  const areas = Array.from(new Set(all.map(r => r.area_manager as string).filter(Boolean))).sort();
  const cities = Array.from(new Set(all.map(r => r.city as string).filter(Boolean))).sort();

  const row = (o: Record<string, unknown>, back: string, note?: React.ReactNode) => (
    <tr key={String(o.internal_code)}>
      <td style={{ minWidth: 200 }}>
        <div style={{ fontWeight: 600 }}>{String(o.internal_code)}</div>
        {note ? <div className="muted" style={{ fontSize: 11.5 }}>{note}</div> : null}
      </td>
      <td colSpan={5}>
        <form action={saveOutlet} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="hidden" name="internal_code" value={String(o.internal_code)} />
          <input type="hidden" name="back" value={back} />
          <input name="city" list="cc-cities" defaultValue={(o.city as string) ?? ''}
                 placeholder="City" style={{ width: 130 }} />
          <select name="store_type" defaultValue={(o.store_type as string) ?? ''} style={{ minWidth: 130 }}>
            <option value="">Store type</option>
            {STORE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input name="location_code" defaultValue={(o.location_code as string) ?? ''}
                 placeholder="Code" style={{ width: 100 }} />
          <select name="area_manager" defaultValue={(o.area_manager as string) ?? ''} style={{ minWidth: 140 }}>
            <option value="">Area manager</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn btn-primary smallbtn" type="submit">Save</button>
        </form>
      </td>
    </tr>
  );

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        Glossary / <Link href="/glossary/items">Items</Link> &nbsp;·&nbsp; <b>Outlets</b>
      </p>
      <h1 className="page">Outlet glossary</h1>
      <p className="hint">
        What each store is, and where it is. A store missing its city, type or code does
        not break anything visibly: it just disappears from every city and store-type
        view without a word. This page is where that gets fixed.
      </p>

      {sp.ok ? <p className="callout">{sp.ok}</p> : null}
      {sp.err ? <p className="err">{sp.err}</p> : null}

      <div className="tiles" style={{ marginBottom: 18 }}>
        <div className="tile">
          <div className="tlabel">Missing something</div>
          <div className="mval">{gaps.length}</div>
          <div className="muted">outlets the dashboard needs more about</div>
        </div>
        <div className="tile">
          <div className="tlabel">Watch is asking</div>
          <div className="mval">{watch.length}</div>
          <div className="muted">names with an open question</div>
        </div>
        <div className="tile">
          <div className="tlabel">In the master</div>
          <div className="mval">{all.length}</div>
          <div className="muted">outlets</div>
        </div>
      </div>

      {renames.length > 0 ? (
        <p className="callout">
          <b>Possible rename or relocation.</b>{' '}
          {renames.map(r => `${r.went_quiet} went quiet on ${r.last_traded} and ${r.appeared} appeared on ${r.first_traded}`).join('; ')}.
          {' '}If that is one store that moved, it must stay ONE store with a new dated site,
          never two. Tell me and I will record the move.
        </p>
      ) : null}

      <h2 className="sec-head">Missing something the dashboard needs</h2>
      {gaps.length === 0 ? (
        <p className="empty">Nothing missing. Every outlet that traded recently has a city, a type, a code and an area manager.</p>
      ) : (
        <div className="scroll-x">
          <table className="sheet">
            <thead><tr>
              <th>Outlet, as the feed sends it</th>
              <th colSpan={5}>City, type, code, area manager</th>
            </tr></thead>
            <tbody>
              {gaps.map(g => row(
                { internal_code: g.outlet_raw, city: g.city, store_type: g.store_type,
                  location_code: g.location_code, area_manager: g.area_manager },
                '/glossary/outlets',
                <>
                  <b>{g.missing}</b> · {g.orders} orders, Rs {rs(Number(g.revenue))} since {g.first_seen}
                </>,
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="sec-head" style={{ marginTop: 26 }}>The watch is asking about these</h2>
      {watch.length === 0 ? (
        <p className="empty">Nothing open. No outlet name has appeared or gone quiet unexpectedly.</p>
      ) : (
        <div className="scroll-x">
          <table className="sheet">
            <thead><tr>
              <th>Outlet</th><th>What is odd</th><th>First traded</th><th>Last traded</th>
              <th>Orders, 30d</th><th>Due back</th>
            </tr></thead>
            <tbody>
              {watch.map(w => (
                <tr key={w.outlet_raw}>
                  <td style={{ fontWeight: 600 }}>{w.outlet_raw}</td>
                  <td>{WATCH_SAYS[w.status as string] ?? w.status}</td>
                  <td>{w.first_seen}</td>
                  <td>{w.last_seen}</td>
                  <td>{w.orders_30d}</td>
                  <td>{w.expected_reopen_on ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="sec-head" style={{ marginTop: 26 }}>Every outlet ({all.length})</h2>
      {!showAll ? (
        <p className="hint">
          <Link className="linkbtn" href="/glossary/outlets?all=1">Show the full list</Link>
          {' '}to correct something already decided.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="sheet">
            <thead><tr>
              <th>Outlet</th><th colSpan={5}>City, type, code, area manager</th>
            </tr></thead>
            <tbody>
              {all.map(o => row(o, '/glossary/outlets?all=1',
                o.active ? undefined : <>not active</>))}
            </tbody>
          </table>
        </div>
      )}

      <datalist id="cc-cities">
        {cities.map(c => <option key={c} value={c} />)}
      </datalist>

      {!canEdit ? (
        <p className="hint" style={{ marginTop: 16 }}>
          You can see this list but not change it. Ask an admin to make an edit.
        </p>
      ) : null}
    </>
  );
}
