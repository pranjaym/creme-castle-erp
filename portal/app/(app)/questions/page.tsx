import { requireAccess } from '@/lib/session';
import QuestionsView from './view';

// The Questions screen (migration 234, 26 Sep 2026). Auth here, body in view.tsx.
export const dynamic = 'force-dynamic';

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAccess(a => a.questions.view);
  const sp = await searchParams;
  return <QuestionsView user={user} sp={sp} />;
}
