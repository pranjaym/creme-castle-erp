// The app shell: OMS composition. Header (product name, IST date, user with
// role and outlet, log out), left sidebar (role-filtered nav), content area.
// Every signed-in page renders inside this; /login lives outside the group.
import { requireUser } from '@/lib/session';
import { navSectionsFor, ROLE_LABELS } from '@/lib/nav';
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
  const scope = user.role === 'store' && user.outletCodes.length
    ? user.outletCodes[0]
    : user.role === 'area_manager' && user.outletCodes.length
      ? `${user.outletCodes.length} stores` : null;

  return (
    <div className="shell">
      <header className="shellhead">
        <div className="shellbrand">
          <span className="brandname">Creme Castle ERP</span>
          <span className="branddate">{istToday()} IST</span>
        </div>
        <div className="shelluser">
          <div className="who-block">
            <div className="who-name">{user.fullName || user.email}</div>
            <div className="who-role">{ROLE_LABELS[user.role]}{scope ? ` · ${scope}` : ''}</div>
          </div>
          <form action={logout}>
            <button className="smallbtn ghost" type="submit">Log out</button>
          </form>
        </div>
      </header>
      <div className="shellbody">
        <aside className="shellside"><Sidebar sections={sections} /></aside>
        <main className="shellmain">{children}</main>
      </div>
    </div>
  );
}
