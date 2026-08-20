// Department screen (server): one page per production department. Sponges and
// Liquids first; Breads/Cakes/Desserts get screens in a later build. Loads the
// department's own items (skus.made_by_location_id), the destinations it can
// send to, its pending receipts inbox, its requests (both directions), and the
// day ledger for the chosen glance date (?glance=YYYY-MM-DD, default open day).
import { notFound, redirect } from 'next/navigation';
import DeptClient from './DeptClient';
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, ymdAddDays, weekdayForYmd } from '@/lib/business-day';
import { currentDeptDay } from '@/lib/dept-day.mjs';
import { requireKitchenUser, mayUseDept } from '@/lib/session';
import { getPlanData } from './plan-data';
import { getKitchenMode } from '@/lib/mode';

export const dynamic = 'force-dynamic';

const DEPTS_WITH_SCREENS = ['CK-SPONGE', 'CK-LIQUID'];

export default async function DeptPage({ params, searchParams }: {
  params: Promise<{ dept: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dept: raw } = await params;
  const sp = await searchParams;
  const deptCode = decodeURIComponent(raw).toUpperCase();
  if (!DEPTS_WITH_SCREENS.includes(deptCode)) notFound();

  // A department account is pinned to its own screen; management roles roam.
  const user = await requireKitchenUser();
  if (!mayUseDept(user, deptCode)) redirect(user.deptCode ? `/dept/${user.deptCode}` : '/login');

  const db = spine();
  const mode = await getKitchenMode();
  const { data: deptLoc } = await db.from('locations').select('id, code, name').eq('code', deptCode).single();
  if (!deptLoc) notFound();
  const { data: settings } = await db
    .from('department_settings').select('day_start_time, closing_before')
    .eq('location_id', deptLoc.id).single();

  const [{ data: skus }, { data: depts }, { data: spokes }, { data: reasons }] = await Promise.all([
    db.from('skus').select('code, name, category, uom, typical_qty_per_day')
      .eq('made_by_location_id', deptLoc.id).eq('active', true).order('sort_order'),
    db.from('locations').select('id, code, name').eq('type', 'kitchen_department').neq('code', deptCode).order('name'),
    db.from('locations').select('code, name').eq('type', 'assembly_spoke').order('name'),
    db.from('waste_reasons').select('code, label_en, label_hi').eq('active', true),
  ]);

  // What can be REQUESTED: the other departments' own item lists (pull flow).
  // Only departments that actually make something appear as request targets.
  const otherDeptIds = (depts ?? []).map((d) => d.id);
  const { data: otherItems } = otherDeptIds.length
    ? await db.from('skus').select('code, name, category, uom, typical_qty_per_day, made_by_location_id')
        .in('made_by_location_id', otherDeptIds).eq('active', true).order('sort_order')
    : { data: [] as any[] };
  const requestables = (depts ?? [])
    .map((d) => ({
      deptCode: d.code, deptName: d.name,
      items: (otherItems ?? []).filter((s) => s.made_by_location_id === d.id)
        .map((s) => ({ code: s.code, name: s.name, category: s.category, uom: s.uom, typical_qty_per_day: s.typical_qty_per_day })),
    }))
    .filter((d) => d.items.length > 0);

  // Requests addressed to THIS department (for the team to fulfil) and raised
  // BY this department (to track). State is derived in v_request_status.
  const [{ data: incomingReqs }, { data: outgoingReqs }] = await Promise.all([
    db.from('v_request_status').select('*').eq('maker_code', deptCode)
      .in('state', ['open', 'partial']).order('entered_at', { ascending: true }),
    db.from('v_request_status').select('*').eq('requester_code', deptCode)
      .order('entered_at', { ascending: false }).limit(25),
  ]);

  // Pending receipts addressed to THIS department (the receiving inbox).
  const { data: inbox } = await db
    .from('v_pending_receipts').select('*').eq('to_code', deptCode)
    .order('sent_at', { ascending: false }).limit(100);

  // Day picker: today or yesterday (calendar), with the department's OPEN day
  // (by its own day_start_time) highlighted as the default.
  const now = new Date();
  const today = istCalendarDate(now);
  const yesterday = ymdAddDays(today, -1);
  const openDay = settings ? currentDeptDay(now, settings.day_start_time) : today;
  const dateChoices = [
    { date: today, weekday: weekdayForYmd(today), relative: 'Today' },
    { date: yesterday, weekday: weekdayForYmd(yesterday), relative: 'Yesterday' },
  ];

  // The glance date: default the open day, any past date selectable (?glance=).
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const glanceDay = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.glance)) && one(sp.glance) <= today
    ? one(sp.glance) : openDay;
  const glanceChoices = Array.from({ length: 15 }, (_, i) => {
    const d = ymdAddDays(today, -i);
    return { date: d, weekday: weekdayForYmd(d) };
  });

  const { data: ledger } = await db
    .from('v_dept_day_ledger').select('*')
    .eq('dept_code', deptCode).eq('business_date', glanceDay)
    .order('sku_code');

  // Production plan inputs for the two plannable days (today default, tomorrow
  // for planning ahead). Suggestion arithmetic lives server-side in plan-data.
  const tomorrow = ymdAddDays(today, 1);
  const [planToday, planTomorrow] = await Promise.all([
    getPlanData(deptCode, today), getPlanData(deptCode, tomorrow),
  ]);

  // Recent raw entries so the team sees what has been punched, newest first.
  const { data: entries } = await db
    .from('v_production_log_current')
    .select('id, business_date, action, qty, uom, sku_id, to_location_id, reason_code, entered_by, entered_at')
    .eq('from_location_id', deptLoc.id).in('business_date', [today, yesterday])
    .order('entered_at', { ascending: false }).limit(60);
  const skuIds = [...new Set((entries ?? []).map((e) => e.sku_id))];
  const locIds = [...new Set((entries ?? []).map((e) => e.to_location_id).filter(Boolean))];
  const [{ data: skuNames }, { data: locNames }] = await Promise.all([
    skuIds.length ? db.from('skus').select('id, name').in('id', skuIds) : Promise.resolve({ data: [] as any[] }),
    locIds.length ? db.from('locations').select('id, name').in('id', locIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const skuName = new Map((skuNames ?? []).map((s) => [s.id, s.name]));
  const locName = new Map((locNames ?? []).map((l) => [l.id, l.name]));
  const recentEntries = (entries ?? []).map((e) => ({
    id: e.id, businessDate: e.business_date, action: e.action, qty: Number(e.qty), uom: e.uom,
    skuName: skuName.get(e.sku_id) ?? '?', destName: e.to_location_id ? (locName.get(e.to_location_id) ?? null) : null,
    reasonCode: e.reason_code, enteredBy: e.entered_by, enteredAt: e.entered_at,
  }));

  const mapReq = (r: any) => ({
    id: r.id, skuCode: r.sku_code, skuName: r.sku_name, uom: r.uom,
    requestedQty: Number(r.requested_qty), sentQty: Number(r.sent_qty), remainingQty: Number(r.remaining_qty),
    state: r.state, neededBy: r.needed_by, note: r.note, cancelReason: r.cancel_reason,
    requesterCode: r.requester_code, requesterName: r.requester_name,
    makerCode: r.maker_code, makerName: r.maker_name,
    enteredBy: r.entered_by, enteredAt: r.entered_at,
  });

  return (
    <DeptClient
      account={{ email: user.email, role: user.role }}
      mode={mode}
      dept={{ code: deptLoc.code, name: deptLoc.name }}
      settings={{
        dayStart: settings?.day_start_time ?? '00:00',
        closingBefore: settings?.closing_before ?? '23:30',
      }}
      skus={skus ?? []}
      destinations={[...(depts ?? []).map((d) => ({ code: d.code, name: d.name })), ...(spokes ?? [])]}
      reasons={reasons ?? []}
      requestables={requestables}
      incomingRequests={(incomingReqs ?? []).map(mapReq)}
      outgoingRequests={(outgoingReqs ?? []).map(mapReq)}
      inbox={(inbox ?? []).map((r: any) => ({
        logId: r.production_log_id, skuName: r.sku_name, skuCode: r.sku_code,
        qty: Number(r.sent_qty), uom: r.uom, fromName: r.from_name,
        sentAt: r.sent_at, sentBy: r.sent_by, businessDate: r.business_date,
      }))}
      ledger={(ledger ?? []).map((r: any) => ({
        date: r.business_date, skuCode: r.sku_code, skuName: r.sku_name, uom: r.uom,
        planned: r.planned != null ? Number(r.planned) : null,
        opening: r.opening != null ? Number(r.opening) : null,
        made: Number(r.made), received: Number(r.received), pending: Number(r.receipts_pending),
        sent: Number(r.sent), wasted: Number(r.wasted),
        closing: r.closing != null ? Number(r.closing) : null,
        gap: r.gap != null ? Number(r.gap) : null,
      }))}
      planDatas={[planToday, planTomorrow].filter(Boolean) as any}
      recentEntries={recentEntries}
      dateChoices={dateChoices}
      openDay={openDay}
      glanceDay={glanceDay}
      glanceChoices={glanceChoices}
    />
  );
}
