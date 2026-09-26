// Every Questions screen renders inside .qx so its own classes stay scoped to
// this module (F56: an unscoped class once flattened the daily pages). The
// drawer and chip classes are deliberately global, because the daily pages
// use them too.
import { redirect } from 'next/navigation';
import { requireUser, questionPerms } from '@/lib/session';

export default async function QuestionsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!questionPerms(user).view) redirect('/');
  return <div className="qxroot">{children}</div>;
}
