// Build 3a logbook page (server, desktop table entry). Loads intermediates and
// issue destinations (cake and dessert departments, plus spokes) from the master.
import LogClient from './LogClient';
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, ymdAddDays, weekdayForYmd } from '@/lib/business-day';

export const dynamic = 'force-dynamic';

export default async function LogPage() {
  const db = spine();
  const { data: skus } = await db
    .from('skus').select('code, name, category, uom, typical_qty_per_day')
    .eq('sku_type', 'intermediate').eq('active', true).order('sort_order');
  const { data: depts } = await db
    .from('locations').select('code, name').in('code', ['CK-CAKE', 'CK-DESSERT']).order('name');
  const { data: spokes } = await db
    .from('locations').select('code, name').eq('type', 'assembly_spoke').order('name');
  const { data: reasons } = await db
    .from('waste_reasons').select('code, label_en, label_hi').eq('active', true);

  // The kitchen is a 24-hour back-of-house: no 04:00 sales cutoff applies here, the
  // production day is the plain IST calendar date. Production runs across midnight,
  // so the chef chooses which day a batch belongs to. Window: today (calendar) or
  // the day before it (yesterday only). Real dates are shown so there is no
  // relative-word ambiguity. The server re-validates this same window on write.
  const today = istCalendarDate(new Date());
  const yesterday = ymdAddDays(today, -1);
  const dateChoices = [
    { date: today, weekday: weekdayForYmd(today), relative: 'Today' },
    { date: yesterday, weekday: weekdayForYmd(yesterday), relative: 'Yesterday' },
  ];
  return (
    <main>
      <LogClient
        skus={skus ?? []}
        destinations={[...(depts ?? []), ...(spokes ?? [])]}
        reasons={reasons ?? []}
        enteredBy="sponge-dept"
        dateChoices={dateChoices}
      />
    </main>
  );
}
