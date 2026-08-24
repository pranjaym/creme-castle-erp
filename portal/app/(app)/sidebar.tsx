'use client';

// The left menu, same behaviour as the OMS sidebar: active item gets the
// maroon pill, everything else is muted. Client component only for the
// active-path highlight.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/nav';

export default function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="sidenav">
      {items.map(item => {
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
    </nav>
  );
}
