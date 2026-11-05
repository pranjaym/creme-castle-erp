'use client';

// The maroon rail. Same composition as the dispatch console's Shell nav
// (cc-dispatch-console/app/src/components/Shell.tsx): brand at the top,
// grouped sections with small-caps labels, a coral pill on the active item,
// a foot line saying what you are looking at.
//
// The one addition the console does not need: on a phone the rail becomes a
// maroon bar with a Menu button, because store and area managers open this
// on a phone far more often than on a desktop.
//
// Open-and-close headings (Nov 2026, Rishabh): the central team and admin
// carry 21 to 22 links, which scrolls on a laptop. A heading with three or
// more links under it can be opened and closed, and starts closed. A heading
// with one or two links is drawn exactly as before, so a store or an area
// manager, who has no heading that long, sees no change at all.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { NavSection } from '@/lib/nav';

// A heading becomes open-and-close at this many links.
const COLLAPSE_FROM = 3;
// The headings this person opened by hand, remembered for as long as this tab
// stays open, a refresh included. A new tab or a reopened browser starts with
// every heading closed again (Rishabh, 5 Nov 2026: the first version kept them
// open for good on that browser, and the rail slowly filled back up).
const STORE_KEY = 'cc.nav.open';

function readPinned(): string[] {
  try {
    // The first version's permanent copy, cleared so nothing lingers.
    window.localStorage.removeItem(STORE_KEY);
    const v = JSON.parse(window.sessionStorage.getItem(STORE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function writePinned(titles: string[]) {
  // A private window or blocked storage must never break the rail.
  try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(titles)); } catch { /* not remembered, still works */ }
}

export default function Sidebar({ sections, foot, badges }:
  { sections: NavSection[]; foot: string; badges?: Record<string, { n: number; red: boolean }> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Headings opened by hand stay open from page to page, until the tab closes.
  const [pinned, setPinned] = useState<string[]>([]);
  // The heading that holds the current page opens by itself. Closing it by
  // hand holds only until the next page, so nobody loses where they are.
  const [dismissed, setDismissed] = useState(false);

  // Read after mount, not during render: the server cannot know what this
  // tab remembers, and the two must draw the same first frame.
  useEffect(() => { setPinned(readPinned()); }, []);

  // Following a link on a phone must close the menu, or the next page opens
  // underneath an open drawer.
  useEffect(() => { setOpen(false); setDismissed(false); }, [pathname]);

  // The link that matches the most of the path is the active one, so a
  // module's home ("/recipes") does not light up beside its own pages.
  const matches = (h: string) => h === '/' ? pathname === '/' : (pathname === h || pathname.startsWith(h + '/'));
  const best = sections.flatMap(x => x.items).filter(x => matches(x.href)).sort((a, b) => b.href.length - a.href.length)[0];

  const toggle = (title: string, isOpen: boolean, hasActive: boolean) => {
    const next = isOpen ? pinned.filter(t => t !== title) : [...pinned.filter(t => t !== title), title];
    setPinned(next);
    writePinned(next);
    if (hasActive) setDismissed(isOpen);
  };

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
        {sections.map((sec, i) => {
          const links = sec.items.map(item => {
            const active = !!best && best.href === item.href;
            return (
              <Link key={item.href} href={item.href}
                className={active ? 'nav-link active' : 'nav-link'}>
                {item.label}
                {badges?.[item.href]?.n
                  ? <span className={badges[item.href].red ? 'qbadge due' : 'qbadge'}>{badges[item.href].n}</span>
                  : null}
              </Link>
            );
          });

          // Short headings: exactly what the rail has always drawn.
          if (!sec.title || sec.items.length < COLLAPSE_FROM) {
            return (
              <div key={i}>
                {sec.title ? <div className="nav-section">{sec.title}</div> : null}
                {links}
              </div>
            );
          }

          const title = sec.title;
          const hasActive = !!best && sec.items.some(x => x.href === best.href);
          const isOpen = pinned.includes(title) || (hasActive && !dismissed);
          const groupId = `nav-group-${i}`;
          return (
            <div key={i}>
              <button type="button"
                className={hasActive ? 'nav-toggle has-active' : 'nav-toggle'}
                aria-expanded={isOpen} aria-controls={groupId}
                onClick={() => toggle(title, isOpen, hasActive)}>
                <span className="nav-toggle-label">{title}</span>
                {/* Closed, the heading says how many links it holds, so nothing looks missing. */}
                {isOpen ? null : <span className="nav-count" aria-hidden="true">{sec.items.length}</span>}
                <span className="nav-chev" aria-hidden="true" />
              </button>
              <div id={groupId} className="nav-group" hidden={!isOpen}>{links}</div>
            </div>
          );
        })}
      </div>

      <div className="nav-foot">{foot}</div>
    </nav>
  );
}
