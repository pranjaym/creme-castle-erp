'use client';

// The maroon rail. Same composition as the dispatch console's Shell nav
// (cc-dispatch-console/app/src/components/Shell.tsx): brand at the top,
// grouped sections with small-caps labels, a coral pill on the active item,
// a foot line saying what you are looking at.
//
// The one addition the console does not need: on a phone the rail becomes a
// maroon bar with a Menu button, because store and area managers open this
// on a phone far more often than on a desktop.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { NavSection } from '@/lib/nav';

export default function Sidebar({ sections, foot }:
  { sections: NavSection[]; foot: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Following a link on a phone must close the menu, or the next page opens
  // underneath an open drawer.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <nav className={open ? 'nav open' : 'nav'}>
      <div className="nav-head">
        <Link className="nav-brand" href="/">
          Creme Castle
          <small>ERP Portal</small>
        </Link>
        <button type="button" className="nav-burger" aria-expanded={open}
          onClick={() => setOpen(v => !v)}>
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      <div className="nav-links">
        {sections.map((sec, i) => (
          <div key={i}>
            {sec.title ? <div className="nav-section">{sec.title}</div> : null}
            {sec.items.map(item => {
              const active = item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link key={item.href} href={item.href}
                  className={active ? 'nav-link active' : 'nav-link'}>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="nav-foot">{foot}</div>
    </nav>
  );
}
