import Link from 'next/link';
import { logout } from '@/app/login/actions';
import type { SessionUser } from '@/lib/session';

// Shared header on every signed-in page. Shows who is logged in, their role, and
// a sign-out button (a server action, so no client JS needed).
export default function TopBar({ user }: { user: SessionUser }) {
  return (
    <div className="topbar">
      <span className="brand"><Link href="/">Creme Castle ERP</Link></span>
      <span className="sub">the spine, for the team</span>
      <span className="who">
        <span>{user.fullName || user.email}</span>
        <span className="pill">{user.role}</span>
        <form action={logout}>
          <button className="linkbtn" type="submit">Sign out</button>
        </form>
      </span>
    </div>
  );
}
