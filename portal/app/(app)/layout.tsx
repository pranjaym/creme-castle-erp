// The app shell, taken from the dispatch console (app/src/components/Shell.tsx):
// a full-height MAROON rail on the left carrying the brand and the role-filtered
// navigation, and a white column on the right made of a sticky topbar plus the
// content. The topbar's left half is the console's "what am I looking at" line,
// which here is the data date; its right half is who you are and Log out.
// Every signed-in page renders inside this. /login lives outside the group.
import { requireUser } from '@/lib/session';
import { navSectionsFor, ROLE_LABELS } from '@/lib/nav';
import { getLatestDate, dateLabel } from '@/lib/daily';
import { logout } from '@/app/login/actions';
import Sidebar from './sidebar';

function istToday(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sections = navSectionsFor(user);

  // The data date is a fact the whole app depends on, so it sits in the shell
  // rather than being repeated on every page. If the spine is unreachable the
  // shell must still render, so this never throws the page away.
  let latest: string | null = null;
  try { latest = await getLatestDate(); } catch { latest = null; }

  const scope = user.role === 'store' && user.outletCodes.length
    ? user.outletCodes[0]
    : user.role === 'area_manager' && user.outletCodes.length
      ? `${user.outletCodes.length} stores` : null;

  return (
    <div className="shell">
      <Sidebar
        sections={sections}
        foot={latest ? `Data settled to ${dateLabel(latest)}` : 'Data date unavailable'}
      />
      <div className="main">
        <header className="topbar">
          <div className="ctx">
            {latest
              ? <>Showing <b>{dateLabel(latest)}</b>, the newest settled day <span className="also"> &middot; today is {istToday()} IST</span></>
              : <>Today is {istToday()} IST</>}
          </div>
          <div className="who">
            <div className="who-block">
              <div className="who-name">{user.fullName || user.email}</div>
              {scope ? <div className="who-role">{scope}</div> : null}
            </div>
            <span className="who-pill">{ROLE_LABELS[user.role]}</span>
            <form action={logout}>
              <button className="btn btn-secondary btn-row" type="submit">Log out</button>
            </form>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
