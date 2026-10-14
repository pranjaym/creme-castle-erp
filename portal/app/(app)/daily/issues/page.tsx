import { requireAccess } from '@/lib/session';
import IssuesView from './view';

// "Issues to Ask" (14 Oct 2026): the central work queue. Auth here, body in
// view.tsx. Only those who may ask questions (admin, central, operations) see
// it; area managers and stores answer from their own daily pages.
export const dynamic = 'force-dynamic';

export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAccess(a => a.network && a.questions.ask, '/daily');
  const sp = await searchParams;
  return <IssuesView user={user} sp={sp} />;
}
