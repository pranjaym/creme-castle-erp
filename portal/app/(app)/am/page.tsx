// Area Manager app, the phone screen (migration 256, 13 Nov 2026, in test).
// The server reads today's state once; the client component does the rest
// through /am/api, which re-checks every write.
import { requireAccess } from '@/lib/session';
import * as am from '@/lib/am';
import AmApp from './AmApp';

export const dynamic = 'force-dynamic';

export default async function AmPage() {
  const u = await requireAccess(a => a.am.use);
  const [state, stores, items] = await Promise.all([am.dayState(u.id), am.stores(), am.checklist(1)]);
  return (
    <AmApp
      initial={state}
      stores={stores}
      items={items}
      orderChecks={am.ORDER_CHECKS.map(o => ({ ...o }))}
      varianceReasons={am.VARIANCE_REASONS}
      missReasons={am.MISS_REASONS}
      me={u.fullName ?? u.email}
    />
  );
}
