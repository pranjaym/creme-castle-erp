// One store audit in full (store audit app, in test).
import { requireAccess } from '@/lib/session';
import VisitDetailPage from '../../../_fieldapp/VisitDetailPage';

export const dynamic = 'force-dynamic';

export default async function StoreAuditDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess(a => a.audit.review);
  return <VisitDetailPage id={Number((await params).id)} mode="audit" back="/store-audit/results" backLabel="Audit results" />;
}
