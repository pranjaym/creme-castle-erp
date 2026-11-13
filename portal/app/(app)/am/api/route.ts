// Every write in the Area Manager app (migration 256), as one JSON endpoint the
// phone screen calls. Each action re-checks the person, does one write through
// lib/am.ts, and answers with the fresh state of the day and the open visit,
// so the screen never has to guess what was saved.
import { NextResponse } from 'next/server';
import { getSessionUser, portalAccess, type SessionUser } from '@/lib/session';
import * as am from '@/lib/am';

export const dynamic = 'force-dynamic';

const who = (u: SessionUser) => u.fullName ?? u.email;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);


export async function POST(req: Request) {
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ error: 'Not allowed for this role.' }, { status: 403 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  // Two apps share this endpoint: the AM visit app (mode visit, am:use) and the
  // store audit app (mode audit, audit:use). Each only reaches its own kinds.
  const mode: am.AppMode = b.mode === 'audit' ? 'audit' : 'visit';
  const access = portalAccess(u);
  if (!(mode === 'audit' ? access.audit.use : access.am.use) && b.action !== 'void') return NextResponse.json({ error: 'Not allowed for this role.' }, { status: 403 });
  const dayState = (x: SessionUser) => am.dayState(x.id, mode);
  const action = String(b.action ?? '');
  const visitId = num(b.visitId) ?? 0;
  try {
    switch (action) {
      case 'state': break;
      case 'confirmPlan': await am.confirmPlan(u.id, who(u), Array.isArray(b.stores) ? b.stores.map(String) : []); break;
      case 'addStop': await am.planChange(u.id, 'added', String(b.store ?? ''), String(b.reason ?? '')); break;
      case 'missStop': await am.planChange(u.id, 'missed', String(b.store ?? ''), String(b.reason ?? '')); break;
      case 'checkIn': {
        const lat = num(b.lat), lng = num(b.lng), acc = num(b.acc), photo = num(b.photo);
        if (lat == null || lng == null) throw new Error('Your phone did not give a location. Allow location for this site and try again.');
        if (photo == null) throw new Error('Take the store-front photo first.');
        await am.checkIn(u.id, who(u), { kind: mode === 'visit' ? 'am_visit' : b.kind === 'other_audit' ? 'other_audit' : 'qa_audit', store: String(b.store ?? ''), allowed: (mode === 'audit' ? access.audit.review : access.am.review) || u.role === 'admin' || !u.outletCodes.length ? null : u.outletCodes, planned: b.planned === true, reason: str(b.reason), lat, lng, acc: acc ?? 0, frontPhoto: photo });
        break;
      }
      case 'reportPin': await am.reportPin(u.id, who(u), String(b.store ?? ''), num(b.lat), num(b.lng), num(b.acc), num(b.dist), str(b.note)); break;
      case 'markPoint': await am.markPoint(u.id, visitId, b.kind === 'next_check' ? 'next_check' : 'todo', num(b.refId) ?? 0, b.status === 'done' ? 'done' : 'open'); break;
      case 'questionSeen': await am.questionSeen(u.id, visitId, num(b.questionId) ?? 0); break;
      case 'audit': await am.answerAudit(u.id, visitId, String(b.code ?? ''), b.result === 'fail' ? 'fail' : 'pass', str(b.note), num(b.photo), str(b.owner), str(b.due)); break;
      case 'order': await am.orderCheck(u.id, visitId, String(b.key ?? ''), num(b.pending) ?? -1, num(b.photo)); break;
      case 'stock': await am.stockCount(u.id, visitId, String(b.item ?? ''), num(b.physical), num(b.petpooja), str(b.reason)); break;
      case 'lockCounts': await am.lockCounts(u.id, visitId); break;
      case 'addTodo': await am.addTodo(u.id, visitId, String(b.text ?? '')); break;
      case 'addNext': await am.addNext(u.id, visitId, String(b.text ?? '')); break;
      case 'finish': {
        const s = String(b.section ?? '') as am.Section;
        if (!am.SECTIONS.includes(s)) throw new Error('Unknown section.');
        await am.finishSection(u.id, visitId, s);
        break;
      }
      case 'void': {
        if (!(mode === 'audit' ? access.audit.review : access.am.review)) return NextResponse.json({ error: 'Only reviewers can void.' }, { status: 403 });
        await am.voidVisit(u.id, num(b.id) ?? 0, String(b.reason ?? ''), mode);
        break;
      }
      case 'seen': await am.markSeen(u.id, visitId); break;
      case 'checkOut': await am.checkOut(u.id, visitId, num(b.lat), num(b.lng), num(b.acc)); break;
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await dayState(u)) });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/^error: /i, '').split('\n')[0];
    return NextResponse.json({ error: msg, ...(await dayState(u).catch(() => ({}))) }, { status: 422 });
  }
}
