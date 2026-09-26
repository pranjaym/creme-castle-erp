-- ============================================================
-- Migration 234: Questions on the daily pages (accountability loop).
-- Authorised by Pranjay 26 Sep 2026 ("build phase 1 of Questions and take
-- it live"). Design: erp-plan/am-questions-plan.md, mock approved the same
-- day: erp-plan/questions-mock-area-v1.html.
--
-- What it is. Central (admin, central) asks a question on a ROW of an area
-- or store page (an order, an outlet-day, an outlet-week). The area manager
-- (or the store) answers with what happened, the cause, who was involved
-- and what was done so it does not repeat. Central accepts and closes, or
-- pushes back. Portal only, no mail (decided 26 Sep 2026). The push is the
-- rail badge, the home line and "Where you are needed".
--
-- Rules kept: no hard deletes (a question is closed, an answer is superseded
-- by a later event, a person is superseded, never removed); every mutation
-- is an event with an actor; the row is SNAPSHOTTED as the labelled fields
-- shown on the page at the time of asking, so a question still reads
-- correctly after Zomato restates the day; no AI anywhere.
-- ============================================================

create schema if not exists ops;

-- ---------- the people list (self-growing; first row of the HR master) ----------
create table if not exists ops.person (
  id            bigint generated always as identity primary key,
  name          text not null,
  outlet_code   text not null references public.outlets(internal_code),
  role          text not null default 'Staff',     -- Store manager | Staff | Packer | Rider | Kitchen | Other
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  superseded_by bigint references ops.person(id)   -- a duplicate spelling merged into another row
);
create index if not exists person_outlet_idx on ops.person(outlet_code) where active;
comment on table ops.person is
  'People named in answers, per outlet. Grows from use (an AM types a new name). '
  'Never DELETE: set active=false, or superseded_by to merge a duplicate spelling.';

-- ---------- the question ----------
create table if not exists ops.question (
  id              bigint generated always as identity primary key,
  raised_at       timestamptz not null default now(),
  raised_by       text not null,                    -- email
  raised_by_name  text,
  outlet_code     text not null references public.outlets(internal_code),
  am              text,                             -- area manager name at the time of asking (history)
  page            text not null,                    -- area | store   (where it was asked from)
  page_date       date not null,                    -- the page's selected day
  section         text not null,                    -- the section heading as printed
  anchor_type     text not null check (anchor_type in ('order','outlet_day','outlet_week')),
  anchor_key      text not null,                    -- Z:<order> | S:<order> | D:<code>:<date>:<app> | W:<code>:<week>:<metric>
  platform        text,                             -- Z | S | null
  business_date   date,                             -- the day the row belongs to
  row_snapshot    jsonb not null default '[]'::jsonb, -- [{"label":..,"value":..}] exactly as shown
  prompt          text,                             -- the raiser's one line, optional
  due_at          timestamptz not null,
  status          text not null default 'open' check (status in ('open','answered','closed')),
  latest_event_at timestamptz not null default now(),
  closed_at       timestamptz,
  closed_by       text,
  closed_by_name  text
);
-- one live question per row at a time; a closed one may be asked again later
create unique index if not exists question_live_anchor_uq on ops.question(anchor_key) where status <> 'closed';
create index if not exists question_outlet_idx on ops.question(outlet_code, status);
create index if not exists question_am_idx on ops.question(am, status);
create index if not exists question_page_idx on ops.question(page, page_date);
comment on table ops.question is
  'One row per ask. status is a cache of the last event (open, answered, closed); '
  'ops.question_event is the truth. Never DELETE.';

-- ---------- the trail ----------
create table if not exists ops.question_event (
  id            bigint generated always as identity primary key,
  question_id   bigint not null references ops.question(id),
  at            timestamptz not null default now(),
  actor         text not null,                      -- email
  actor_name    text,
  action        text not null check (action in ('asked','answered','pushed_back','closed')),
  what_happened text,
  cause         text,
  person_id     bigint references ops.person(id),
  person_name   text,                               -- kept as typed, so a later merge does not rewrite history
  prevention    text,
  note          text
);
create index if not exists question_event_q_idx on ops.question_event(question_id, at);
comment on table ops.question_event is 'Append-only trail of every ask, answer, push-back and close. Never UPDATE or DELETE.';

-- ---------- per-user cursor for "new since you last looked" ----------
create table if not exists ops.last_seen (
  user_email text primary key,
  at         timestamptz not null default now()
);

-- ---------- the cause list (one place, so the portal and the CSV agree) ----------
create table if not exists ops.cause (
  code  text primary key,
  label text not null,
  sort  int  not null
);
insert into ops.cause (code, label, sort) values
  ('stock_not_received', 'Stock not received from kitchen', 1),
  ('stock_ran_out',      'Stock ran out during the day', 2),
  ('shut_or_late',       'Shop shut or opened late', 3),
  ('handover',           'Handover or packing error', 4),
  ('tech',               'Tablet, power or internet', 5),
  ('rider',              'Rider', 6),
  ('platform',           'Platform fault', 7),
  ('staff_absent',       'Staff absent', 8),
  ('other',              'Other', 9)
on conflict (code) do nothing;

-- ============================================================
-- Writes. The portal calls these and never touches the tables directly.
-- ============================================================

-- Ask. Returns the new question id. Refuses a second live question on the same row.
create or replace function ops.ask(
  p_actor text, p_actor_name text,
  p_outlet text, p_page text, p_page_date date, p_section text,
  p_anchor_type text, p_anchor_key text, p_platform text, p_business_date date,
  p_snapshot jsonb, p_prompt text, p_due_hours int default 24)
returns bigint language plpgsql security definer set search_path = ops, public as $fn$
declare v_id bigint; v_am text;
begin
  if exists (select 1 from ops.question where anchor_key = p_anchor_key and status <> 'closed') then
    raise exception 'There is already an open question on this row.';
  end if;
  select area_manager into v_am from public.outlets where internal_code = p_outlet;
  insert into ops.question (raised_by, raised_by_name, outlet_code, am, page, page_date, section,
      anchor_type, anchor_key, platform, business_date, row_snapshot, prompt, due_at)
  values (p_actor, p_actor_name, p_outlet, v_am, p_page, p_page_date, p_section,
      p_anchor_type, p_anchor_key, nullif(p_platform,''), p_business_date, coalesce(p_snapshot,'[]'::jsonb),
      nullif(trim(p_prompt),''), now() + make_interval(hours => coalesce(p_due_hours, 24)))
  returning id into v_id;
  insert into ops.question_event (question_id, actor, actor_name, action, note)
  values (v_id, p_actor, p_actor_name, 'asked', nullif(trim(p_prompt),''));
  return v_id;
end $fn$;

-- Answer. A person is optional; a NEW name at that outlet is added to the
-- people list on the spot (self-growing list, decided 26 Sep 2026).
create or replace function ops.answer(
  p_id bigint, p_actor text, p_actor_name text,
  p_what text, p_cause text, p_person_name text, p_person_role text, p_prevention text)
returns void language plpgsql security definer set search_path = ops, public as $fn$
declare q ops.question; v_pid bigint; v_pname text;
begin
  select * into q from ops.question where id = p_id;
  if q.id is null then raise exception 'No such question.'; end if;
  if q.status = 'closed' then raise exception 'This question is closed.'; end if;
  if nullif(trim(p_what),'') is null then raise exception 'Say what happened.'; end if;
  if nullif(trim(p_prevention),'') is null then raise exception 'Say what you did so it does not repeat.'; end if;
  if p_cause is null or not exists (select 1 from ops.cause where code = p_cause) then
    raise exception 'Pick a cause.';
  end if;
  v_pname := nullif(trim(p_person_name),'');
  if v_pname is not null then
    select id into v_pid from ops.person
     where outlet_code = q.outlet_code and active and superseded_by is null
       and lower(name) = lower(v_pname)
     order by id limit 1;
    if v_pid is null then
      insert into ops.person (name, outlet_code, role, created_by)
      values (v_pname, q.outlet_code, coalesce(nullif(trim(p_person_role),''), 'Staff'), p_actor)
      returning id into v_pid;
    end if;
  end if;
  insert into ops.question_event (question_id, actor, actor_name, action, what_happened, cause, person_id, person_name, prevention)
  values (p_id, p_actor, p_actor_name, 'answered', trim(p_what), p_cause, v_pid, v_pname, trim(p_prevention));
  update ops.question set status = 'answered', latest_event_at = now() where id = p_id;
end $fn$;

-- Close (accept), with an optional note. Allowed from open too ("no longer needed").
create or replace function ops.close(p_id bigint, p_actor text, p_actor_name text, p_note text)
returns void language plpgsql security definer set search_path = ops, public as $fn$
declare q ops.question;
begin
  select * into q from ops.question where id = p_id;
  if q.id is null then raise exception 'No such question.'; end if;
  if q.status = 'closed' then raise exception 'Already closed.'; end if;
  insert into ops.question_event (question_id, actor, actor_name, action, note)
  values (p_id, p_actor, p_actor_name, 'closed', nullif(trim(p_note),''));
  update ops.question set status = 'closed', latest_event_at = now(), closed_at = now(),
    closed_by = p_actor, closed_by_name = p_actor_name where id = p_id;
end $fn$;

-- Push back: "this is not an answer". Reopens with a fresh 24 hours.
create or replace function ops.push_back(p_id bigint, p_actor text, p_actor_name text, p_note text)
returns void language plpgsql security definer set search_path = ops, public as $fn$
declare q ops.question;
begin
  select * into q from ops.question where id = p_id;
  if q.id is null then raise exception 'No such question.'; end if;
  if q.status <> 'answered' then raise exception 'Only an answered question can be pushed back.'; end if;
  insert into ops.question_event (question_id, actor, actor_name, action, note)
  values (p_id, p_actor, p_actor_name, 'pushed_back', coalesce(nullif(trim(p_note),''), 'This does not answer the question. Please look again.'));
  update ops.question set status = 'open', latest_event_at = now(), due_at = now() + interval '24 hours' where id = p_id;
end $fn$;

-- The per-user cursor. Returns the PREVIOUS value (what "last looked" means
-- for this visit) and moves it to now.
create or replace function ops.touch_last_seen(p_email text)
returns timestamptz language plpgsql security definer set search_path = ops, public as $fn$
declare prev timestamptz;
begin
  select at into prev from ops.last_seen where user_email = p_email;
  insert into ops.last_seen (user_email, at) values (p_email, now())
  on conflict (user_email) do update set at = now();
  return prev;
end $fn$;

-- ============================================================
-- Reads.
-- ============================================================

-- One row per question with the latest answer folded in, the derived
-- overdue flag, and every timestamp also as an ISO string (the portal's pg
-- pool returns timestamps as text on purpose, F35).
create or replace view ops.v_question as
select q.id, q.raised_at, q.raised_by, q.raised_by_name, q.outlet_code, q.am, q.page, q.page_date,
       q.section, q.anchor_type, q.anchor_key, q.platform, q.business_date, q.row_snapshot, q.prompt,
       q.due_at, q.status, q.latest_event_at, q.closed_at, q.closed_by, q.closed_by_name,
       (q.status = 'open' and q.due_at < now()) as overdue,
       a.at as answered_at, a.actor as answered_by, a.actor_name as answered_by_name,
       a.what_happened, a.cause, c.label as cause_label, a.person_name, p.role as person_role, a.prevention,
       to_char(q.raised_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as raised_at_iso,
       to_char(q.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as due_at_iso,
       to_char(q.latest_event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as latest_event_at_iso,
       to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as answered_at_iso,
       to_char(q.closed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as closed_at_iso,
       (select count(*) from ops.question_event e2 where e2.question_id = q.id and e2.action = 'pushed_back') as push_backs
  from ops.question q
  left join lateral (
    select e.* from ops.question_event e
     where e.question_id = q.id and e.action = 'answered'
     order by e.at desc limit 1) a on true
  left join ops.cause c on c.code = a.cause
  left join ops.person p on p.id = a.person_id;

-- The trail of one question, oldest first, ISO timestamps.
create or replace view ops.v_event as
select e.id, e.question_id, e.at, to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at_iso,
       e.actor, e.actor_name, e.action, e.what_happened, e.cause, c.label as cause_label,
       e.person_id, e.person_name, p.role as person_role, e.prevention, e.note
  from ops.question_event e
  left join ops.cause c on c.code = e.cause
  left join ops.person p on p.id = e.person_id;

-- ---------- RLS, same stance as the rest of the spine: service role only ----------
alter table ops.person         enable row level security;
alter table ops.question       enable row level security;
alter table ops.question_event enable row level security;
alter table ops.last_seen      enable row level security;
alter table ops.cause          enable row level security;
revoke all on schema ops from public, anon, authenticated;
