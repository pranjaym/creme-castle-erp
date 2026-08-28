import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { spine } from '@/lib/supabase/service';

// Items on channels Pranjay does not track. Kept out of the item queue on purpose.
//
// Pranjay, 28 Aug 2026: "I don't track them anyway, and it is not part of my analysis
// anymore, but it shows up in bulk in my unmapped item glossary."
//
// The first attempt at this filtered on item_source (which FILE the row arrived in) and
// missed the biggest part of it: the D2C custom-cake business is booked on the Petpooja
// POS as order type "Pick Up", so it looked like a Petpooja row and stayed in the queue.
// The switch is now on CHANNEL, held in public.item_channel_tracking (migration 203).
//
// Removed from the queue, NOT hidden. Silently dropping crores out of sight is how the
// original problem happened, so every number stays one click away.
export const dynamic = 'force-dynamic';

function rs(n: number | null | undefined): string {
  if (!n) return '0';
  return Math.round(n).toLocaleString('en-IN');
}

export default async function UntrackedItemsPage({ searchParams }:
  { searchParams: Promise<{ n?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const limit = Math.min(Math.max(Number(sp.n ?? 100), 25), 2000);

  const db = spine();
  const [rowsRes, allRes, chRes] = await Promise.all([
    db.from('item_glossary_gaps').select('*')
      .eq('tracked', false).order('revenue', { ascending: false }).limit(limit),
    db.from('item_glossary_gaps').select('item_name, revenue, revenue_30d, channels')
      .eq('tracked', false),
    db.from('item_channel_tracking').select('*').order('tracked', { ascending: false }),
  ]);
  const rows = rowsRes.data ?? [];
  const all = allRes.data ?? [];
  const channels = chRes.data ?? [];

  const total = all.length;
  const rev180 = all.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
  const rev30 = all.reduce((s, r) => s + Number(r.revenue_30d ?? 0), 0);

  // Which channels these items came through, by how many item names each covers.
  const byChannel = new Map<string, number>();
  for (const r of all) {
    for (const c of String(r.channels ?? '').split(', ').filter(Boolean)) {
      byChannel.set(c, (byChannel.get(c) ?? 0) + 1);
    }
  }
  const channelRows = Array.from(byChannel.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        Glossary / <Link href="/glossary/items">Items</Link> / <b>Not tracked</b>
        &nbsp;·&nbsp; <Link href="/glossary/outlets">Outlets</Link>
      </p>
      <h1 className="page">Items on channels you do not track</h1>
      <p className="hint">
        Pick up (the custom cake business), the website, WhatsApp, B2B and dine in.
        These are <b>deliberately kept out of the item queue</b>, because they are not
        part of your analysis. Nothing is deleted and nothing is hidden: they are stored,
        counted and listed here.
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

      <h2 className="sec-head">Which channels these came through</h2>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr><th>Channel</th><th>Unmapped item names</th></tr></thead>
          <tbody>
            {channelRows.map(([c, n]) => (
              <tr key={c}><td>{c}</td><td>{n.toLocaleString('en-IN')}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="sec-head" style={{ marginTop: 26 }}>What counts as tracked</h2>
      <p className="hint">
        This is a setting, not something buried in code. A channel with no row here is
        treated as <b>tracked</b> on purpose, so a new way of selling shows up in your
        queue instead of disappearing.
      </p>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr><th>Channel</th><th>Shown as</th><th>Tracked</th><th>Why</th></tr></thead>
          <tbody>
            {channels.map(c => (
              <tr key={c.channel_key}>
                <td>{c.channel_key}</td>
                <td>{c.label}</td>
                <td>{c.tracked ? 'Yes' : 'No'}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 460 }} className="muted">{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="sec-head" style={{ marginTop: 26 }}>
        The biggest {Math.min(limit, total)} items by revenue
      </h2>
      <div className="scroll-x">
        <table className="sheet">
          <thead><tr>
            <th>Item</th><th>Channels</th><th>Revenue, 180d</th><th>Revenue, 30d</th>
            <th>Sold</th><th>Outlets</th><th>First sold</th><th>Last sold</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.item_name}>
                <td>{r.item_name}</td>
                <td className="muted">{r.channels}</td>
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
        If any of this is ever worth mapping, the right way is from the source catalogue
        in one pass, not by typing {total.toLocaleString('en-IN')} rows by hand.
      </p>
    </>
  );
}
