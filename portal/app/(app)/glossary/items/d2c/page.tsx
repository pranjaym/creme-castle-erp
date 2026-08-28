import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { spine } from '@/lib/supabase/service';

// D2C items, kept out of the item queue on purpose.
//
// Pranjay, 28 Aug 2026: "I don't track them anyway, and it is not part of my analysis
// anymore, but it shows up in bulk in my unmapped item glossary. We need to remove it
// and show it separately."
//
// So: removed from the queue, NOT hidden. 4,273 names against a few dozen real
// decisions would bury the ones that matter, but silently dropping a crore of revenue
// out of sight is how the original problem happened. This page is the middle: the
// number is always one click away, and the switch that put it here is a row in
// public.item_source_tracking, not a hard-coded filter.
export const dynamic = 'force-dynamic';

function rs(n: number | null | undefined): string {
  if (!n) return '0';
  return Math.round(n).toLocaleString('en-IN');
}

export default async function D2CItemsPage({ searchParams }:
  { searchParams: Promise<{ n?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const limit = Math.min(Math.max(Number(sp.n ?? 100), 25), 2000);

  const db = spine();
  const [rowsRes, allRes, srcRes] = await Promise.all([
    db.from('item_glossary_gaps').select('*')
      .eq('tracked', false).order('revenue', { ascending: false }).limit(limit),
    db.from('item_glossary_gaps').select('item_name, revenue, revenue_30d').eq('tracked', false),
    db.from('item_source_tracking').select('*').eq('tracked', false),
  ]);
  const rows = rowsRes.data ?? [];
  const all = allRes.data ?? [];
  const sources = srcRes.data ?? [];

  const total = all.length;
  const rev180 = all.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
  const rev30 = all.reduce((s, r) => s + Number(r.revenue_30d ?? 0), 0);

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        Glossary / <Link href="/glossary/items">Items</Link> / <b>D2C</b>
        &nbsp;·&nbsp; <Link href="/glossary/outlets">Outlets</Link>
      </p>
      <h1 className="page">D2C items, not tracked</h1>
      <p className="hint">
        These come from the website and are <b>deliberately kept out of the item queue</b>,
        because you do not analyse them. Nothing is deleted and nothing is hidden: they
        are stored, counted and listed here. If you ever want them back in the queue it
        is one row in <code>item_source_tracking</code>, not a code change.
      </p>

      <div className="tiles" style={{ marginBottom: 18 }}>
        <div className="tile">
          <div className="tlabel">Unmapped names</div>
          <div className="mval">{total.toLocaleString('en-IN')}</div>
          <div className="muted">last 180 days</div>
        </div>
        <div className="tile">
          <div className="tlabel">Revenue, 30 days</div>
          <div className="mval">Rs {rs(rev30)}</div>
          <div className="muted">not in any category view</div>
        </div>
        <div className="tile">
          <div className="tlabel">Revenue, 180 days</div>
          <div className="mval">Rs {rs(rev180)}</div>
          <div className="muted">the size of the gap</div>
        </div>
      </div>

      {sources.map(s => (
        <p key={s.item_source} className="callout">
          <b>{s.label}</b> ({s.item_source}): {s.note}
        </p>
      ))}

      <h2 className="sec-head">The biggest {Math.min(limit, total)} by revenue</h2>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr>
            <th>Item</th><th>Revenue, 180d</th><th>Revenue, 30d</th>
            <th>Sold</th><th>Outlets</th><th>First sold</th><th>Last sold</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.item_name}>
                <td>{r.item_name}</td>
                <td>Rs {rs(Number(r.revenue))}</td>
                <td>Rs {rs(Number(r.revenue_30d))}</td>
                <td>{Math.round(Number(r.qty ?? 0)).toLocaleString('en-IN')}</td>
                <td>{r.outlets}</td>
                <td>{r.first_sold}</td>
                <td>{r.last_sold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > rows.length ? (
        <p className="hint" style={{ marginTop: 12 }}>
          Showing {rows.length} of {total.toLocaleString('en-IN')}.{' '}
          <Link className="linkbtn" href={`/glossary/items/d2c?n=${Math.min(limit * 5, 2000)}`}>
            Show more
          </Link>
        </p>
      ) : null}

      <p className="hint" style={{ marginTop: 18 }}>
        If these are ever worth mapping, the right way is from the OMS product catalogue
        in one pass, not by typing {total.toLocaleString('en-IN')} rows by hand.
      </p>
    </>
  );
}
