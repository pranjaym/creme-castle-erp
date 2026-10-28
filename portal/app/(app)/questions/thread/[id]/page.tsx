import { requireAccess } from '@/lib/session';
import { questionKit, QuestionDrawer } from '../../../daily/questions-ui';

// One closed question's drawer on its own (27 Oct 2026). /questions keeps the
// open and answered threads hidden on the page, because those carry the forms;
// a closed thread never changes and has no form, so dash.js fetches it from
// here only when its card is tapped and shows it on the spot. Opened directly
// it is the same drawer over an empty page, and close goes back to the list.
// The outlet scope is checked inside QuestionDrawer, as everywhere.
export const dynamic = 'force-dynamic';

export default async function QuestionThreadPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAccess(a => a.questions.view);
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const kit = questionKit({ page: 'area', pageDate: '', basePath: '/questions', user, qmap: new Map() });
  kit.back = sp.back?.startsWith('/questions') ? sp.back : '/questions';   // back to the list it was opened from
  return <main className="qx"><QuestionDrawer kit={kit} user={user} sp={{ q: id }} /></main>;
}
