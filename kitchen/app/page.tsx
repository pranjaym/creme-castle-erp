import Link from 'next/link';
import { businessDay, istWeekday } from '@/lib/business-day';

export default function Home() {
  const d = new Date();
  return (
    <main>
      <h1>Creme Castle Kitchen</h1>
      <p style={{ color: 'var(--muted)' }}>
        Business day {businessDay(d)} ({istWeekday(d)}). Spine module.
      </p>
      <Link className="big-btn" href="/log">Logbook (batch made, taken out, sent to spoke, wasted)</Link>
      <Link className="big-btn" href="/buffer">Frozen buffer (today and current level)</Link>
      <Link className="big-btn" href="/recon">D2C reconciliation (three buckets, per store)</Link>
    </main>
  );
}
