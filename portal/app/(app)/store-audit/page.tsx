// Store audit app (13 Nov 2026, in test): its own screen, separate from the AM
// visit app. Anyone with audit:use runs an AM monthly, QA surprise or other
// audit at a store; same 28 items and tables (schema am), audit kinds only.
import { requireAccess } from '@/lib/session';
import * as am from '@/lib/am';
import AmApp from '../_fieldapp/AmApp';

export const dynamic = 'force-dynamic';

export default async function StoreAuditPage() {
  const u = await requireAccess(a => a.audit.use);
  const [state, stores, items] = await Promise.all([am.dayState(u.id, 'audit'), am.stores(), am.checklist(1)]);
  return (
    <AmApp mode="audit" initial={state} stores={stores} items={items} orderChecks={am.ORDER_CHECKS.map(o => ({ ...o }))}
      varianceReasons={am.VARIANCE_REASONS} missReasons={am.MISS_REASONS} me={u.fullName ?? u.email} />
  );
}
