import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { spine } from '@/lib/supabase/service';
import ItemRow from '../ItemRow';

// The item glossary screen. (F39, step 4)
//
// It does NOT open on a table of 323 mappings. It opens on the short list of items
// nobody has answered yet, worst first by the money behind them, because that is the
// only ordering that puts the Nutella Cookie Tin at Rs 13.58 lakh above a Rs 99 rakhi
// thread. The full list is underneath, for editing something already decided.
export const dynamic = 'force-dynamic';

const OCCASIONS = ['Rakhi', 'Christmas', 'Valentine', 'Friendship Day', "Mother's Day",
                   "Father's Day", 'Diwali', 'New Year', 'Holi'];

function rs(n: number | null | undefined): string {
  if (!n) return '0';
  return Math.round(n).toLocaleString('en-IN');
}

export default async function ItemGlossaryPage({ searchParams }:
  { searchParams: Promise<{ ok?: string; err?: string; all?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const showAll = sp.all === '1';
  const canEdit = user.role === 'admin' || user.role === 'central';

  const db = spine();
  const [gapsRes, allRes] = await Promise.all([
    db.from('item_glossary_gaps').select('*')
      .eq('tracked', true).order('revenue_tracked', { ascending: false }).limit(200),
    db.from('item_glossary').select('*').order('item_name').limit(2000),
  ]);
  const gaps = gapsRes.data ?? [];
  const all = allRes.data ?? [];

  // Channels Pranjay does not analyse get their own screen. Thousands of rows in this
  // queue would bury the few decisions that do need a person. Counted here only so the
  // number is never hidden. Tracked is by CHANNEL, not by which file the row arrived in:
  // the D2C custom-cake business is booked on the Petpooja POS, so a source-based filter
  // missed it entirely (migration 203).
  const { data: untrackedRows } = await db.from('item_glossary_gaps')
    .select('item_name, revenue').eq('tracked', false);
  const untrackedCount = untrackedRows?.length ?? 0;

  const categories = Array.from(new Set(all.map(r => r.category as string).filter(Boolean))).sort();
  const aliases = Array.from(new Set(all.map(r => r.alias as string).filter(Boolean))).sort();
  const queueRevenue = gaps.reduce((s, r) => s + Number(r.revenue_tracked_30d ?? 0), 0);

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        Glossary / <b>Items</b> &nbsp;·&nbsp; <Link href="/glossary/outlets">Outlets</Link>
      </p>
      <h1 className="page">Item glossary</h1>
      <p className="hint">
        What each item on the menu is called, and what kind of thing it is. Two names for
        one product share an <b>alias</b>, so a renamed item keeps one history. The{' '}
        <b>category</b> is the product type. An <b>occasion</b> is a separate tag, so a
        Rakhi cookie tin counts under Cookies and under Rakhi at the same time.
      </p>

      {sp.ok ? <p className="callout">{sp.ok}</p> : null}
      {sp.err ? <p className="err">{sp.err}</p> : null}

      <div className="tiles" style={{ marginBottom: 18 }}>
        <div className="tile">
          <div className="tlabel">Waiting on you</div>
          <div className="mval">{gaps.length}</div>
          <div className="muted">items with no mapping</div>
        </div>
        <div className="tile">
          <div className="tlabel">Money behind them</div>
          <div className="mval">Rs {rs(queueRevenue)}</div>
          <div className="muted">last 30 days</div>
        </div>
        <div className="tile">
          <div className="tlabel">Already mapped</div>
          <div className="mval">{all.length}</div>
          <div className="muted">items, {aliases.length} products</div>
        </div>
      </div>

      <h2 className="sec-head">Needs your attention</h2>
      <p className="hint">
        Sold on <b>Zomato or Swiggy</b> in the last 180 days with no mapping, biggest
        first. Until an item is mapped it still counts in every total, but it never joins
        its category and never merges with its other spellings. Channels you do not
        track are not listed here.
      </p>

      {gaps.length === 0 ? (
        <p className="empty">
          Nothing waiting. Every item sold on Zomato or Swiggy in the last 180 days is
          mapped. New menu items will appear here as they sell.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="sheet">
            <thead><tr>
              <th>Item, as Petpooja sends it</th>
              <th colSpan={4}>Alias, category, occasion, shelf life</th>
            </tr></thead>
            <tbody>
              {gaps.map(g => (
                <ItemRow
                  key={g.item_name}
                  itemName={g.item_name}
                  aliases={aliases}
                  categories={categories}
                  occasions={OCCASIONS}
                  back="/glossary/items"
                  context={
                    <>
                      Rs {rs(Number(g.revenue_tracked))} on tracked channels since {g.first_sold}
                      {' '}· {Math.round(Number(g.qty))} sold · {g.outlets} outlets
                      {g.channels ? <> · {g.channels}</> : null}
                      {g.petpooja_category ? <> · Petpooja files it under &ldquo;{g.petpooja_category}&rdquo;</> : null}
                    </>
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {untrackedCount > 0 ? (
        <p className="hint" style={{ marginTop: 14 }}>
          Items sold only on channels you do not track (pick up, website, WhatsApp,
          B2B, dine in) are kept out of this queue.{' '}
          <Link className="linkbtn" href="/glossary/items/d2c">
            See them separately ({untrackedCount.toLocaleString('en-IN')})
          </Link>
        </p>
      ) : null}

      <h2 className="sec-head" style={{ marginTop: 26 }}>
        Everything already mapped ({all.length})
      </h2>
      {!showAll ? (
        <p className="hint">
          <Link className="linkbtn" href="/glossary/items?all=1">Show the full list</Link>
          {' '}to correct something already decided.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="sheet">
            <thead><tr>
              <th>Item, as Petpooja sends it</th>
              <th colSpan={4}>Alias, category, occasion, shelf life</th>
            </tr></thead>
            <tbody>
              {all.map(r => (
                <ItemRow
                  key={r.item_name}
                  itemName={r.item_name}
                  alias={r.alias}
                  category={r.category}
                  occasion={r.occasion}
                  shelfLife={r.shelf_life}
                  aliases={aliases}
                  categories={categories}
                  occasions={OCCASIONS}
                  back="/glossary/items?all=1"
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <datalist id="cc-aliases">
        {aliases.map(a => <option key={a} value={a} />)}
      </datalist>

      {!canEdit ? (
        <p className="hint" style={{ marginTop: 16 }}>
          You can see this list but not change it. Ask an admin to make an edit.
        </p>
      ) : null}
    </>
  );
}
