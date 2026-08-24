'use client';

// The left menu: grouped sections with small-caps titles, maroon pill on the
// active item, same behaviour as the OMS sidebar.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavSection } from '@/lib/nav';

export default function Sidebar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  return (
    <nav className="sidenav">
      {sections.map((sec, i) => (
        <div key={i} className="sidesec">
          {sec.title ? <div className="sidetitle">{sec.title}</div> : null}
          {sec.items.map(item => {
            const active = item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link key={item.href} href={item.href}
                className={active ? 'sideitem active' : 'sideitem'}>
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
