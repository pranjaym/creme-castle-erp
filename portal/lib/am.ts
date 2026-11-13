// Area Manager app (migration 256, 13 Nov 2026): reads and writes for the day
// plan, check-in, the visit sections and check-out. Server only. Every write
// appends; nothing is updated in place except the visit's own progress fields
// (sections done, check-out, the in-charge's "seen"), and nothing is deleted.
// Design record: erp-plan/store-scorecard-plan.md sections 25 to 31.
import 'server-only';
import { q, one, tx } from '@/lib/db';

export const SECTIONS = ['last', 'qs', 'audit', 'ord', 'inv', 'todo', 'next'] as const;
export type Section = (typeof SECTIONS)[number];
// A store audit (QA, or any auditor) is the same 28 items without the visit's
// other sections; the to-dos still come from its fails (section 31).
export type VisitKind = 'am_visit' | 'qa_audit';
export const sectionsFor = (kind: string): readonly Section[] => (kind === 'qa_audit' ? ['audit', 'todo'] : SECTIONS);
// Store KPI line 7 and 8 (proposed): full 15 at 25 or more of 28, zero at 19 or fewer, straight line between.
export const auditPoints = (passed: number): number => Math.round(Math.max(0, Math.min(1, (passed - 19) / 6)) * 150) / 10;
export const ORDER_CHECKS = [
  { key: 'pp_po', title: 'Petpooja purchase orders', hint: 'Every purchase order received at this store checked and marked in Petpooja' },
  { key: 'pp_to', title: 'Petpooja transfer orders', hint: 'Every transfer from the kitchen received and matched in Petpooja' },
  { key: 'sn_po', title: 'SupplyNote purchase orders', hint: 'Open purchase orders for this store checked in SupplyNote' },
  { key: 'sn_so', title: 'SupplyNote sales orders', hint: 'Open sales orders for this store checked in SupplyNote' },
] as const;
const ADD_ONS = ['Birthday candles (pack)', 'Happy Birthday topper', 'Party popper', 'Cake knife'];
const GOODS = ['Tiramisu Pastry', 'Classic Walnut Brownie', 'Nutella Bomb Cookie', 'Chocolate Truffle Cake (500 Gm)', 'Blueberry Baked Cheesecake', 'Butter Croissant', 'Overload Brownie (1 Pc)', 'Eggless Biscoff Brownie', 'Lotus Biscoff Cheesecake', 'Chocolate Mousse Pastry', 'Almond Biscotti (80 Gm)', 'Belgian Chocolate Tart Slice'];
export const VARIANCE_REASONS = ['Sale not punched', 'Wastage not punched', 'Transfer not received in Petpooja', 'Counting error, recounted', 'Unknown'];
export const MISS_REASONS = ['Store emergency elsewhere', 'Called to the kitchen or office', 'Traffic or distance', 'Store was shut', 'Rescheduled to tomorrow', 'Other'];

export interface StoreRow { store: string; am: string; lat: number; lng: number; radius: number; needsCheck: boolean; testSite: boolean; pinNote: string | null }
export interface AuditItem { code: string; sort: number; grp: string; title: string; passLine: string; critical: boolean }
export interface PlanChange { kind: 'added' | 'missed'; store: string; reason: string; at: string }
export interface Plan { id: number; planDate: string; stores: string[]; confirmedAt: string; late: boolean; changes: PlanChange[] }
export interface VisitSummary { id: number; kind: string; store: string; personName: string | null; planned: boolean; status: string; checkinAt: string; checkoutAt: string | null; minutes: number | null; passed: number; failed: number; critical: number; todos: number }
export interface OpenPoint { kind: 'todo' | 'next_check'; id: number; text: string; from: string; mark: 'done' | 'open' | null }
export interface QuestionRow { id: number; prompt: string; raisedAt: string; status: string; overdue: boolean; seen: boolean }
export interface VisitDetail {
  id: number; kind: string; store: string; am: string; personName: string | null; planned: boolean; unplannedReason: string | null;
  checkinAt: string; checkinDist: number | null; checkinAcc: number | null;
  checkoutAt: string | null; checkoutDist: number | null; status: string; seenAt: string | null;
  sectionsDone: string[]; invItems: { item: string; kind: string }[]; invLockedAt: string | null;
  frontPhoto: number | null; stockScreenPhoto: number | null;
  audit: Record<string, { result: 'pass' | 'fail'; note: string | null; photo: number | null }>;
  orders: Record<string, { pending: number; photo: number | null }>;
  stock: Record<string, { physical: number | null; petpooja: number | null; reason: string | null }>;
  todos: { id: number; text: string; source: string; critical: boolean }[];
  nexts: { id: number; text: string }[];
  openPoints: OpenPoint[];
  questions: QuestionRow[];
}

export const istDate = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const istHour = (): number => new Date(Date.now() + 330 * 60_000).getUTCHours();

export function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export async function stores(): Promise<StoreRow[]> {
  const rows = await q<{ store: string; am: string | null; lat: number; lng: number; radius_m: number; needs_check: boolean; is_test_site: boolean; note: string | null }>(
    `select p.store, o.area_manager as am, p.lat, p.lng, p.radius_m, p.needs_check, p.is_test_site, p.note
       from am.store_pin p left join public.outlets o on o.internal_code = p.store and o.active
      where p.is_test_site or o.internal_code is not null
      order by p.is_test_site desc, o.area_manager, p.store`);
  return rows.map(r => ({ store: r.store, am: r.am ?? 'Test', lat: Number(r.lat), lng: Number(r.lng), radius: r.radius_m, needsCheck: r.needs_check, testSite: r.is_test_site, pinNote: r.note }));
}

export async function checklist(version = 1): Promise<AuditItem[]> {
  const rows = await q<{ code: string; sort: number; grp: string; title: string; pass_line: string; critical: boolean }>(
    'select code, sort, grp, title, pass_line, critical from am.audit_item where version = $1 order by sort', [version]);
  return rows.map(r => ({ code: r.code, sort: r.sort, grp: r.grp, title: r.title, passLine: r.pass_line, critical: r.critical }));
}

export async function planFor(person: string, date: string): Promise<Plan | null> {
  const p = await one<{ id: string; plan_date: string; stores: string[]; confirmed_at: string; late: boolean }>(
    'select id, plan_date, stores, confirmed_at, late from am.plan where person = $1 and plan_date = $2 and voided_at is null', [person, date]);
  if (!p) return null;
  const ch = await q<{ kind: 'added' | 'missed'; store: string; reason: string; at: string }>(
    'select kind, store, reason, at from am.plan_change where plan_id = $1 order by id', [p.id]);
  return { id: Number(p.id), planDate: p.plan_date, stores: p.stores, confirmedAt: p.confirmed_at, late: p.late, changes: ch };
}

export async function confirmPlan(person: string, name: string, picked: string[]): Promise<void> {
  const known = new Set((await stores()).map(s => s.store));
  const clean = picked.filter((s, i) => known.has(s) && picked.indexOf(s) === i);
  if (!clean.length) throw new Error('Pick at least one store.');
  await q(`insert into am.plan (person, person_name, plan_date, stores, late) values ($1,$2,$3,$4,$5)`,
    [person, name, istDate(), clean, istHour() >= 10]);
}

export async function planChange(person: string, kind: 'added' | 'missed', store: string, reason: string): Promise<void> {
  const p = await planFor(person, istDate());
  if (!p) throw new Error('Confirm today\'s plan first.');
  if (!reason.trim()) throw new Error('Give a reason.');
  await q('insert into am.plan_change (plan_id, kind, store, reason) values ($1,$2,$3,$4)', [p.id, kind, store, reason.trim()]);
}

const summarySql = `
  select v.id, v.kind, v.store, v.person_name, v.planned, v.status, v.checkin_at, v.checkout_at,
         case when v.checkout_at is null then null else round(extract(epoch from (v.checkout_at - v.checkin_at)) / 60)::int end as minutes,
         coalesce(a.passed,0) passed, coalesce(a.failed,0) failed, coalesce(a.crit,0) crit,
         (select count(*) from am.todo t where t.visit_id = v.id)::int todos
    from am.visit v
    left join lateral (
      select count(*) filter (where c.result='pass')::int passed, count(*) filter (where c.result='fail')::int failed,
             count(*) filter (where c.result='fail' and i.critical)::int crit
        from (select distinct on (item_code) item_code, result from am.audit_answer where visit_id = v.id order by item_code, id desc) c
        join am.audit_item i on i.version = v.checklist_version and i.code = c.item_code
    ) a on true
   where v.voided_at is null`;
type SumRow = { id: string; kind: string; store: string; person_name: string | null; planned: boolean; status: string; checkin_at: string; checkout_at: string | null; minutes: number | null; passed: number; failed: number; crit: number; todos: number };
const toSummary = (r: SumRow): VisitSummary => ({ id: Number(r.id), kind: r.kind, store: r.store, personName: r.person_name, planned: r.planned, status: r.status, checkinAt: r.checkin_at, checkoutAt: r.checkout_at, minutes: r.minutes, passed: r.passed, failed: r.failed, critical: r.crit, todos: r.todos });

export async function myVisitsToday(person: string): Promise<VisitSummary[]> {
  const rows = await q<SumRow>(`${summarySql} and v.person = $1 and (v.checkin_at at time zone 'Asia/Kolkata')::date = $2 order by v.checkin_at`, [person, istDate()]);
  return rows.map(toSummary);
}
export async function allVisits(limit = 300): Promise<VisitSummary[]> {
  const rows = await q<SumRow>(`${summarySql} order by v.checkin_at desc limit $1`, [limit]);
  return rows.map(toSummary);
}
export async function openVisitId(person: string): Promise<number | null> {
  const r = await one<{ id: string }>(`select id from am.visit where person = $1 and status = 'in_progress' and voided_at is null order by checkin_at desc limit 1`, [person]);
  return r ? Number(r.id) : null;
}

export async function checkIn(person: string, name: string, args: { kind: VisitKind; store: string; allowed: string[] | null; planned: boolean; reason: string | null; lat: number; lng: number; acc: number; frontPhoto: number }): Promise<number> {
  const pin = (await stores()).find(s => s.store === args.store);
  if (!pin) throw new Error('That store has no map pin yet.');
  if (args.allowed && !pin.testSite && !args.allowed.includes(args.store)) throw new Error('That store is not one of yours.');
  if (await openVisitId(person)) throw new Error('You are already checked in somewhere. Check out there first.');
  const dist = metres(args.lat, args.lng, pin.lat, pin.lng);
  if (dist > pin.radius) throw new Error(`You are ${dist} m from the store. Check in works within ${pin.radius} m.`);
  const qa = args.kind === 'qa_audit';
  const plan = qa ? null : await planFor(person, istDate());
  const inv = qa ? [] : [
    ...shuffle(ADD_ONS).slice(0, 2).map(item => ({ item, kind: 'add_on' })),
    ...shuffle(GOODS).slice(0, 6).map(item => ({ item, kind: 'finished_good' })),
  ];
  return tx(async c => {
    const v = await c.q<{ id: string }>(
      `insert into am.visit (kind, person, person_name, store, plan_id, planned, unplanned_reason, checkin_lat, checkin_lng, checkin_acc_m, checkin_dist_m, inv_items)
       values ($12,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [person, name, args.store, plan?.id ?? null, qa ? false : args.planned, qa ? null : args.reason, args.lat, args.lng, args.acc, dist, JSON.stringify(inv), qa ? 'qa_audit' : 'am_visit']);
    const id = Number(v[0].id);
    const ph = await c.q(`update am.photo set visit_id = $1 where id = $2 and taken_by = $3 and visit_id is null and purpose = 'front' returning id`, [id, args.frontPhoto, person]);
    if (!ph.length) throw new Error('The store-front photo was not found. Take it again.');
    return id;
  });
}

function shuffle<T>(a: T[]): T[] { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

export async function visitDetail(id: number): Promise<VisitDetail | null> {
  const v = await one<{ id: string; kind: string; store: string; am: string | null; person_name: string | null; planned: boolean; unplanned_reason: string | null; checkin_at: string; checkin_dist_m: number | null; checkin_acc_m: number | null; checkout_at: string | null; checkout_dist_m: number | null; status: string; seen_at: string | null; sections_done: string[]; inv_items: { item: string; kind: string }[]; inv_locked_at: string | null; checklist_version: number }>(
    `select v.*, o.area_manager as am from am.visit v left join public.outlets o on o.internal_code = v.store where v.id = $1 and v.voided_at is null`, [id]);
  if (!v) return null;
  const [photos, audit, orders, stock, todos, nexts] = await Promise.all([
    q<{ id: string; purpose: string }>(`select id, purpose from am.photo where visit_id = $1 and voided_at is null order by id`, [id]),
    q<{ item_code: string; result: 'pass' | 'fail'; note: string | null; photo_id: string | null }>(`select distinct on (item_code) item_code, result, note, photo_id from am.audit_answer where visit_id = $1 order by item_code, id desc`, [id]),
    q<{ check_key: string; pending: number; photo_id: string | null }>(`select distinct on (check_key) check_key, pending, photo_id from am.order_check where visit_id = $1 order by check_key, id desc`, [id]),
    q<{ item: string; physical: string | null; petpooja: string | null; reason: string | null }>(`select distinct on (item) item, physical, petpooja, reason from am.stock_count where visit_id = $1 order by item, id desc`, [id]),
    q<{ id: string; text: string; source: string; critical: boolean }>(`select id, text, source, critical from am.todo where visit_id = $1 order by id`, [id]),
    q<{ id: string; text: string }>(`select id, text from am.next_check where visit_id = $1 order by id`, [id]),
  ]);
  const lastPhoto = (purpose: string) => { const p = photos.filter(x => x.purpose === purpose).pop(); return p ? Number(p.id) : null; };
  const open = await openPointsFor(v.store, Number(v.id));
  const qs = v.store.startsWith('TEST-') || v.kind === 'qa_audit' ? [] : await questionsFor(v.store, Number(v.id));
  return {
    id: Number(v.id), kind: v.kind, store: v.store, am: v.am ?? 'Test', personName: v.person_name, planned: v.planned, unplannedReason: v.unplanned_reason,
    checkinAt: v.checkin_at, checkinDist: v.checkin_dist_m, checkinAcc: v.checkin_acc_m, checkoutAt: v.checkout_at, checkoutDist: v.checkout_dist_m,
    status: v.status, seenAt: v.seen_at, sectionsDone: v.sections_done ?? [], invItems: v.inv_items ?? [], invLockedAt: v.inv_locked_at,
    frontPhoto: lastPhoto('front'), stockScreenPhoto: lastPhoto('stock_screen'),
    audit: Object.fromEntries(audit.map(a => [a.item_code, { result: a.result, note: a.note, photo: a.photo_id ? Number(a.photo_id) : null }])),
    orders: Object.fromEntries(orders.map(o => [o.check_key, { pending: o.pending, photo: o.photo_id ? Number(o.photo_id) : null }])),
    stock: Object.fromEntries(stock.map(s => [s.item, { physical: s.physical == null ? null : Number(s.physical), petpooja: s.petpooja == null ? null : Number(s.petpooja), reason: s.reason }])),
    todos: todos.map(t => ({ id: Number(t.id), text: t.text, source: t.source, critical: t.critical })),
    nexts: nexts.map(n => ({ id: Number(n.id), text: n.text })),
    openPoints: open,
    questions: qs,
  };
}

// Open points for a store: to-dos and "check next time" notes from its earlier
// visits whose latest mark is not "done", with this visit's own mark if any.
async function openPointsFor(store: string, visitId: number): Promise<OpenPoint[]> {
  const rows = await q<{ kind: 'todo' | 'next_check'; id: string; text: string; from_at: string; latest: string | null; here: 'done' | 'open' | null }>(
    `with pts as (
       select 'todo'::text kind, t.id, t.text, v.checkin_at from_at from am.todo t join am.visit v on v.id = t.visit_id
        where t.store = $1 and t.visit_id <> $2 and v.voided_at is null
       union all
       select 'next_check', n.id, n.text, v.checkin_at from am.next_check n join am.visit v on v.id = n.visit_id
        where n.store = $1 and n.visit_id <> $2 and v.voided_at is null)
     select p.kind, p.id, p.text, p.from_at,
            (select m.status from am.point_mark m where m.ref_kind = p.kind and m.ref_id = p.id and m.visit_id <> $2 order by m.id desc limit 1) latest,
            (select m.status from am.point_mark m where m.ref_kind = p.kind and m.ref_id = p.id and m.visit_id = $2 order by m.id desc limit 1) here
       from pts p order by p.from_at, p.id`, [store, visitId]);
  return rows.filter(r => r.latest !== 'done' || r.here !== null)
    .map(r => ({ kind: r.kind, id: Number(r.id), text: r.text, from: r.from_at, mark: r.here }));
}

async function questionsFor(store: string, visitId: number): Promise<QuestionRow[]> {
  // Only Questions still waiting on the field (status open). Answered ones wait
  // on central, closed ones are done.
  const rows = await q<{ id: string; prompt: string | null; section: string | null; platform: string | null; business_date: string | null; raised_at: string; status: string; overdue: boolean | null; seen: boolean }>(
    `select qv.id, qv.prompt, qv.section, qv.platform, qv.business_date, qv.raised_at, qv.status, qv.overdue,
            exists (select 1 from am.question_seen s where s.visit_id = $2 and s.question_id = qv.id) seen
       from ops.v_question qv where qv.outlet_code = $1 and qv.status = 'open' order by qv.raised_at desc limit 15`, [store, visitId]);
  const app = (p: string | null) => (p === 'Z' ? 'Zomato' : p === 'S' ? 'Swiggy' : p === 'D' ? 'D2C' : null);
  const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null);
  return rows.map(r => ({
    id: Number(r.id),
    prompt: [r.section, app(r.platform), day(r.business_date)].filter(Boolean).join(' · ') + (r.prompt ? `: ${r.prompt}` : ''),
    raisedAt: r.raised_at, status: r.status, overdue: !!r.overdue, seen: r.seen,
  }));
}

// ---------- writes inside a visit (each checks the visit is the person's and open) ----------
async function ownOpen(person: string, visitId: number): Promise<{ store: string; inv_locked_at: string | null; inv_items: { item: string; kind: string }[] }> {
  const v = await one<{ store: string; inv_locked_at: string | null; inv_items: { item: string; kind: string }[]; person: string; status: string }>(
    'select store, inv_locked_at, inv_items, person, status from am.visit where id = $1 and voided_at is null', [visitId]);
  if (!v || v.person !== person) throw new Error('This visit is not yours.');
  if (v.status !== 'in_progress') throw new Error('This visit is already checked out.');
  return v;
}
async function ownPhoto(person: string, visitId: number, photoId: number | null, purpose: string): Promise<void> {
  if (photoId == null) throw new Error('Take the photo first.');
  const p = await one<{ visit_id: string | null; taken_by: string; purpose: string }>('select visit_id, taken_by, purpose from am.photo where id = $1', [photoId]);
  if (!p || p.taken_by !== person || Number(p.visit_id) !== visitId || p.purpose !== purpose) throw new Error('That photo does not belong to this item. Take it again.');
}

export async function markPoint(person: string, visitId: number, kind: 'todo' | 'next_check', refId: number, status: 'done' | 'open') {
  await ownOpen(person, visitId);
  await q('insert into am.point_mark (ref_kind, ref_id, visit_id, status, by_person) values ($1,$2,$3,$4,$5)', [kind, refId, visitId, status, person]);
}
export async function questionSeen(person: string, visitId: number, questionId: number) {
  await ownOpen(person, visitId);
  await q('insert into am.question_seen (visit_id, question_id, by_person) values ($1,$2,$3)', [visitId, questionId, person]);
}
export async function answerAudit(person: string, visitId: number, code: string, result: 'pass' | 'fail', note: string | null, photo: number | null) {
  await ownOpen(person, visitId);
  if (result !== 'pass' && result !== 'fail') throw new Error('Pass or fail only.');
  if (result === 'fail' && !(note ?? '').trim()) throw new Error('Say in one line what must be fixed.');
  await ownPhoto(person, visitId, photo, `audit:${code}`);
  const ok = await one('select 1 from am.audit_item where version = 1 and code = $1', [code]);
  if (!ok) throw new Error('Unknown audit item.');
  await q('insert into am.audit_answer (visit_id, item_code, result, note, photo_id, answered_by) values ($1,$2,$3,$4,$5,$6)',
    [visitId, code, result, result === 'fail' ? note!.trim() : null, photo, person]);
}
export async function orderCheck(person: string, visitId: number, key: string, pending: number, photo: number | null) {
  await ownOpen(person, visitId);
  if (!ORDER_CHECKS.some(o => o.key === key)) throw new Error('Unknown order check.');
  if (!Number.isInteger(pending) || pending < 0) throw new Error('Pending must be 0 or more.');
  await ownPhoto(person, visitId, photo, `order:${key}`);
  await q('insert into am.order_check (visit_id, check_key, pending, photo_id, by_person) values ($1,$2,$3,$4,$5)', [visitId, key, pending, photo, person]);
}
export async function stockCount(person: string, visitId: number, item: string, physical: number | null, petpooja: number | null, reason: string | null) {
  const v = await ownOpen(person, visitId);
  const it = v.inv_items.find(i => i.item === item);
  if (!it) throw new Error('That item is not in this count.');
  if (petpooja != null && !v.inv_locked_at) throw new Error('Lock your counts before entering Petpooja figures.');
  if (physical != null && v.inv_locked_at) throw new Error('Your counts are locked.');
  const cur = await one<{ physical: string | null; petpooja: string | null; reason: string | null }>(
    'select physical, petpooja, reason from am.stock_count where visit_id = $1 and item = $2 order by id desc limit 1', [visitId, item]);
  await q('insert into am.stock_count (visit_id, item, item_kind, physical, petpooja, reason, by_person) values ($1,$2,$3,$4,$5,$6,$7)',
    [visitId, item, it.kind, physical ?? cur?.physical ?? null, petpooja ?? cur?.petpooja ?? null, reason ?? cur?.reason ?? null, person]);
}
export async function lockCounts(person: string, visitId: number) {
  const v = await ownOpen(person, visitId);
  const d = await visitDetail(visitId);
  if (!d || v.inv_items.some(i => d.stock[i.item]?.physical == null)) throw new Error('Count every item first.');
  await q('update am.visit set inv_locked_at = now(), updated_at = now() where id = $1 and inv_locked_at is null', [visitId]);
}
export async function addNext(person: string, visitId: number, text: string) {
  const v = await ownOpen(person, visitId);
  if (!text.trim()) throw new Error('Type what to check.');
  await q('insert into am.next_check (visit_id, store, text, created_by) values ($1,$2,$3,$4)', [visitId, v.store, text.trim(), person]);
}
export async function addTodo(person: string, visitId: number, text: string) {
  const v = await ownOpen(person, visitId);
  if (!text.trim()) throw new Error('Type the to-do.');
  await q(`insert into am.todo (visit_id, store, text, source, created_by) values ($1,$2,$3,'added',$4)`, [visitId, v.store, text.trim(), person]);
}

// Marks a section done after checking it really is complete.
export async function finishSection(person: string, visitId: number, section: Section) {
  const v = await ownOpen(person, visitId);
  const d = (await visitDetail(visitId))!;
  const items = await checklist(1);
  const problem = (() => {
    switch (section) {
      case 'last': return d.openPoints.some(p => !p.mark) ? 'Mark every open point done or still open.' : null;
      case 'qs': return d.questions.some(x => !x.seen) ? 'Mark every open Question as discussed.' : null;
      case 'audit': return items.some(i => !d.audit[i.code]) ? 'Answer every audit item.' : null;
      case 'ord': return ORDER_CHECKS.some(o => !d.orders[o.key]) ? 'Finish all four order checks.' : null;
      case 'inv': {
        if (!d.invLockedAt) return 'Lock your counts first.';
        for (const i of d.invItems) {
          const s = d.stock[i.item];
          if (!s || s.physical == null || s.petpooja == null) return 'Enter the Petpooja figure for every item.';
          if (s.physical !== s.petpooja && !s.reason) return 'Give a reason for every difference.';
        }
        return d.stockScreenPhoto ? null : 'Take the photo of the Petpooja stock screen.';
      }
      default: return null;
    }
  })();
  if (problem) throw new Error(problem);
  await tx(async c => {
    if (section === 'todo' && !d.sectionsDone.includes('todo')) {
      // the store's to-dos are born from what this visit found
      for (const i of items) {
        const a = d.audit[i.code];
        if (a?.result === 'fail') await c.q(`insert into am.todo (visit_id, store, text, source, critical, created_by) values ($1,$2,$3,$4,$5,$6)`,
          [visitId, v.store, `${i.title}: ${a.note ?? 'fix'}`, `audit:${i.code}`, i.critical, person]);
      }
      for (const it of d.invItems) {
        const s = d.stock[it.item];
        if (s && s.physical != null && s.petpooja != null && s.physical !== s.petpooja) {
          const diff = s.physical - s.petpooja;
          await c.q(`insert into am.todo (visit_id, store, text, source, created_by) values ($1,$2,$3,'stock',$4)`,
            [visitId, v.store, `${it.item}: ${diff > 0 ? '+' : ''}${diff} against Petpooja (${s.reason ?? 'no reason'})`, person]);
        }
      }
      for (const o of ORDER_CHECKS) {
        const x = d.orders[o.key];
        if (x && x.pending > 0) await c.q(`insert into am.todo (visit_id, store, text, source, created_by) values ($1,$2,$3,$4,$5)`,
          [visitId, v.store, `${o.title}: ${x.pending} pending to clear`, `order:${o.key}`, person]);
      }
    }
    await c.q(`update am.visit set sections_done = (select array(select distinct unnest(sections_done || array[$2::text]))), updated_at = now() where id = $1`, [visitId, section]);
  });
}

export async function markSeen(person: string, visitId: number) {
  await ownOpen(person, visitId);
  await q('update am.visit set seen_at = coalesce(seen_at, now()), updated_at = now() where id = $1', [visitId]);
}

export async function checkOut(person: string, visitId: number, lat: number | null, lng: number | null, acc: number | null) {
  const v = await ownOpen(person, visitId);
  const d = (await visitDetail(visitId))!;
  if (sectionsFor(d.kind).some(s => !d.sectionsDone.includes(s))) throw new Error('Finish every section first.');
  if (!d.seenAt) throw new Error('The in-charge has to see the to-do list first.');
  const pin = (await stores()).find(s => s.store === v.store);
  const dist = pin && lat != null && lng != null ? metres(lat, lng, pin.lat, pin.lng) : null;
  await q(`update am.visit set status = 'closed', checkout_at = now(), checkout_lat = $2, checkout_lng = $3, checkout_acc_m = $4, checkout_dist_m = $5, updated_at = now() where id = $1`,
    [visitId, lat, lng, acc, dist]);
}

export async function reportPin(person: string, name: string, store: string, lat: number | null, lng: number | null, acc: number | null, dist: number | null, note: string | null) {
  await q('insert into am.store_pin_report (store, lat, lng, accuracy_m, dist_m, note, reported_by, reported_by_name) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [store, lat, lng, acc, dist, note, person, name]);
}

export async function photoFor(id: number): Promise<{ storage_path: string; content_type: string; visit_id: string | null; taken_by: string } | null> {
  return one('select storage_path, content_type, visit_id, taken_by from am.photo where id = $1 and voided_at is null', [id]);
}

// This month's audit results by store (store KPI lines 7 and 8, proposed):
// the latest closed AM audit (the audit inside an AM visit) and the latest
// closed QA surprise audit; if one is missing the other counts for both. Any
// critical fail in any closed audit this month caps the store's month at 60.
export interface StoreResult {
  store: string; am: string;
  amVisit: { id: number; at: string; by: string | null; passed: number; points: number } | null;
  qaVisit: { id: number; at: string; by: string | null; passed: number; points: number } | null;
  amPoints: number | null; qaPoints: number | null; standIn: 'am' | 'qa' | null;
  critical: number; capped: boolean; audits: number;
}
export async function storeResults(): Promise<StoreResult[]> {
  const month = istDate().slice(0, 7);
  const rows = await q<SumRow & { am: string | null }>(
    `select s.*, o.area_manager am from (${summarySql} and v.status = 'closed'
        and to_char(v.checkin_at at time zone 'Asia/Kolkata', 'YYYY-MM') = $1) s
       left join public.outlets o on o.internal_code = s.store
      order by s.checkin_at desc`, [month]);
  const by = new Map<string, StoreResult>();
  for (const r of rows) {
    const x = by.get(r.store) ?? { store: r.store, am: r.am ?? 'Test', amVisit: null, qaVisit: null, amPoints: null, qaPoints: null, standIn: null, critical: 0, capped: false, audits: 0 };
    x.audits += 1; x.critical += r.crit;
    const one = { id: Number(r.id), at: r.checkin_at, by: r.person_name, passed: r.passed, points: auditPoints(r.passed) };
    if (r.kind === 'qa_audit') { if (!x.qaVisit) x.qaVisit = one; } else if (!x.amVisit) x.amVisit = one;
    by.set(r.store, x);
  }
  return [...by.values()].map((x): StoreResult => {
    const a = x.amVisit?.points ?? null, b = x.qaVisit?.points ?? null;
    return { ...x, amPoints: a ?? b, qaPoints: b ?? a, standIn: a == null ? 'qa' : b == null ? 'am' : null, capped: x.critical > 0 };
  }).sort((p, q2) => p.am.localeCompare(q2.am) || p.store.localeCompare(q2.store));
}

// A mistaken visit or audit is voided with a reason, never deleted.
export async function voidVisit(name: string, id: number, reason: string) {
  if (reason.trim().length < 5) throw new Error('Give the reason for voiding in a few words.');
  const r = await q(`update am.visit set voided_at = now(), void_reason = $2, updated_at = now() where id = $1 and voided_at is null returning id`,
    [id, `${reason.trim()} (voided by ${name})`]);
  if (!r.length) throw new Error('That visit is not there or is already void.');
  await q(`update am.photo set voided_at = now(), void_reason = 'visit voided' where visit_id = $1 and voided_at is null`, [id]);
}

// Everything the phone screen shows for today, in one read.
export async function dayState(person: string) {
  const [plan, visits, openId] = await Promise.all([planFor(person, istDate()), myVisitsToday(person), openVisitId(person)]);
  const visit = openId ? await visitDetail(openId) : null;
  return { date: istDate(), plan, visits, visit };
}
export type DayState = Awaited<ReturnType<typeof dayState>>;
