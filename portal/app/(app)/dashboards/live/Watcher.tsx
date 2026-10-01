'use client';
import { useEffect, useState } from 'react';

// Keeps an open wall honest: asks for the newest paint every two minutes and,
// when one has arrived since the page was opened, offers it. It never swaps the
// frame by itself, so nobody loses their place mid-read.
export default function Watcher({ latest }: { latest: string | null }) {
  const [newer, setNewer] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch('/dashboards/live/status', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (!stop && j.file && j.file !== latest) setNewer(j.time ?? 'just now');
      } catch {
        // Offline for a moment: try again next round.
      }
    };
    const id = setInterval(check, 120_000);
    return () => { stop = true; clearInterval(id); };
  }, [latest]);

  if (!newer) return null;
  return (
    <div className="ok" style={{ maxWidth: 'none' }}>
      A newer paint arrived ({newer}).{' '}
      <a href="/dashboards/live">Show it</a>
    </div>
  );
}
