import Link from 'next/link';
import { requireAdmin, type Role } from '@/lib/session';
import { spine } from '@/lib/supabase/service';
import UserForm, { type Outlet } from '../UserForm';
import { ROLE_DEFS } from '../roles';

// Add a person: role first, then only the fields that role needs.
export const dynamic = 'force-dynamic';

export default async function NewUserPage({ searchParams }:
  { searchParams: Promise<{ role?: string; ok?: string; err?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;

  const chosen = ROLE_DEFS.some(d => d.role === sp.role) ? (sp.role as Role) : null;

  const { data: outlets } = await spine().from('outlets')
    .select('internal_code, area_manager').eq('active', true).order('internal_code');

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        <Link href="/users">People and access</Link> / add
      </p>
      <h1 className="page">Add a person</h1>
      <p className="hint">
        Two steps. Say what they are, then fill in the little that role needs.
      </p>
      {sp.err ? <p className="err">{sp.err}</p> : null}

      <UserForm basePath="/users/new" chosen={chosen} outlets={(outlets ?? []) as Outlet[]} />
    </>
  );
}
