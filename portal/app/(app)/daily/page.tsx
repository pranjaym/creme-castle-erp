import { redirect } from 'next/navigation';
import { requireAccess, portalAccess } from '@/lib/session';
import { spine } from '@/lib/supabase/service';

// /daily lands each role where they belong: store accounts on their store,
// area managers on their area, management on the central view. A role with no
// store pages at all (chef, controls) is sent home, never into a redirect loop.
export default async function DailyIndex() {
  const user = await requireAccess(a => a.ownStores);

  if (user.role === 'store' && user.outletCodes.length === 1) {
    redirect(`/daily/store/${encodeURIComponent(user.outletCodes[0])}`);
  }
  if (user.role === 'area_manager' && user.outletCodes.length > 0) {
    const { data } = await spine().from('outlets')
      .select('area_manager').eq('internal_code', user.outletCodes[0]).single();
    const am = (data as { area_manager?: string } | null)?.area_manager;
    if (am) redirect(`/daily/area/${encodeURIComponent(am)}`);
  }
  redirect(portalAccess(user).network ? '/daily/central' : '/');
}
