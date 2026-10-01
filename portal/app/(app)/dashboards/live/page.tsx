import Link from 'next/link';
import { requireAccess } from '@/lib/session';
import { readStatus, listPaints, freshness, isPaintPath } from '@/lib/livewall';
import Watcher from './Watcher';

// Always read the bucket fresh: a cached answer here would be a stale wall.
export const dynamic = 'force-dynamic';

// The Live status wall: the newest spot check the Petpooja robot painted, with
// when it was painted, whether the next one is late, and today's earlier paints.
// Same audience as the daily sales dashboard.
export default async function LiveStatus({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  await requireAccess(a => a.sales);
  const { f } = await searchParams;
  const status = await readStatus();

  if (!status) {
    return (
      <main>
        <div className="frameback">
          <Link className="ghostbtn" href="/dashboards">All dashboards</Link>
        </div>
        <h1 className="page">Live status</h1>
        <div className="empty">
          Nothing painted yet. The first paint appears after the robot&apos;s next spot
          check, once &quot;ERP wall&quot; is set to Live in its control panel.
        </div>
      </main>
    );
  }

  const fresh = freshness(status);
  const paints = await listPaints(status.latest.date);
  const shown = f && isPaintPath(f) ? f : status.latest.path;
  const shownPaint = paints.find(p => p.path === shown);
  const viewingOlder = shown !== status.latest.path;

  return (
    <main>
      <div className="frameback spread">
        <span>
          <Link className="ghostbtn" href="/dashboards">All dashboards</Link>
          <span style={{ marginLeft: 12, fontWeight: 600 }}>Live status</span>
        </span>
        <span className="small muted">
          Painted at <b>{status.latest.time}</b> on {status.latest.date} ({fresh.ageText}) by {status.latest.machine}
        </span>
      </div>

      {fresh.stale ? (
        <div className="err" style={{ maxWidth: 'none' }}>{fresh.message}</div>
      ) : fresh.notToday ? (
        <p className="hint warn" style={{ maxWidth: 'none' }}>{fresh.message}</p>
      ) : (
        <p className="hint" style={{ margin: '0 0 8px' }}>{fresh.message}</p>
      )}

      <Watcher latest={status.latest.path} />

      {paints.length > 1 && (
        <p className="small" style={{ margin: '0 0 8px' }}>
          <span className="muted">Paints on {status.latest.date}: </span>
          {paints.map(p => (
            <Link
              key={p.path}
              href={p.path === status.latest.path ? '/dashboards/live' : `/dashboards/live?f=${encodeURIComponent(p.path)}`}
              className={p.path === shown ? 'chip okc' : 'chip'}
              style={{ marginRight: 6 }}
            >
              {p.time}
            </Link>
          ))}
        </p>
      )}
      {viewingOlder && (
        <p className="hint warn" style={{ maxWidth: 'none' }}>
          You are looking at the {shownPaint?.time ?? 'earlier'} paint, not the newest.{' '}
          <Link href="/dashboards/live">Back to the newest</Link>
        </p>
      )}

      <iframe
        className="dash"
        src={`/dashboards/live/view?f=${encodeURIComponent(shown)}`}
        title="Live status"
      />
    </main>
  );
}
