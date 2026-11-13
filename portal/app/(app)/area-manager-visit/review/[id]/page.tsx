// One AM visit in full (AM visit app, in test).
import { requireAccess } from '@/lib/session';
import VisitDetailPage from '../../../_fieldapp/VisitDetailPage';

export const dynamic = 'force-dynamic';

export default async function AmVisitDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess(a => a.am.review);
  return <VisitDetailPage id={Number((await params).id)} mode="visit" back="/area-manager-visit/review" backLabel="All visits" />;
}
