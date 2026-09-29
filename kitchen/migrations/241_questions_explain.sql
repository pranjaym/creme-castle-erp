-- ============================================================
-- Migration 241: "Explain", the Questions loop started by the area manager.
-- Authorised by Pranjay 29 Sep 2026 ("okay build this"), after Pawan and
-- Rishabh's feedback that an area manager who already knows what happened
-- had nowhere to write it until central asked. Design: am-questions-plan.md
-- section 10.
--
-- An explanation is a question asked and answered in one step by the field
-- role: the same row, the same record, status answered from birth, the
-- trail saying who started it. It lands in central's close queue exactly
-- like an answer, and one live record per row still holds.
-- ============================================================

alter table ops.question add column if not exists started_by_field boolean not null default false;
comment on column ops.question.started_by_field is
  'true when the area manager or store explained the row without being asked (migration 241).';

create or replace function ops.explain(
  p_actor text, p_actor_name text,
  p_outlet text, p_page text, p_page_date date, p_section text,
  p_anchor_type text, p_anchor_key text, p_platform text, p_business_date date,
  p_snapshot jsonb,
  p_what text, p_cause text, p_person_name text, p_person_role text, p_prevention text)
returns bigint language plpgsql security definer set search_path = ops, public as $fn$
declare v_id bigint; v_am text; v_pid bigint; v_pname text;
begin
  if exists (select 1 from ops.question where anchor_key = p_anchor_key and status <> 'closed') then
    raise exception 'There is already an open question on this row. Answer that one instead.';
  end if;
  if nullif(trim(p_what),'') is null then raise exception 'Say what happened.'; end if;
  if nullif(trim(p_prevention),'') is null then raise exception 'Say what you did so it does not repeat.'; end if;
  if p_cause is null or not exists (select 1 from ops.cause where code = p_cause) then
    raise exception 'Pick a cause.';
  end if;
  select area_manager into v_am from public.outlets where internal_code = p_outlet;
  insert into ops.question (raised_by, raised_by_name, outlet_code, am, page, page_date, section,
      anchor_type, anchor_key, platform, business_date, row_snapshot, prompt, due_at, status, started_by_field)
  values (p_actor, p_actor_name, p_outlet, v_am, p_page, p_page_date, p_section,
      p_anchor_type, p_anchor_key, nullif(p_platform,''), p_business_date, coalesce(p_snapshot,'[]'::jsonb),
      null, now() + interval '24 hours', 'answered', true)
  returning id into v_id;
  insert into ops.question_event (question_id, actor, actor_name, action, note)
  values (v_id, p_actor, p_actor_name, 'asked', 'Explained without being asked.');
  v_pname := nullif(trim(p_person_name),'');
  if v_pname is not null then
    select id into v_pid from ops.person
     where outlet_code = p_outlet and active and superseded_by is null and lower(name) = lower(v_pname)
     order by id limit 1;
    if v_pid is null then
      insert into ops.person (name, outlet_code, role, created_by)
      values (v_pname, p_outlet, coalesce(nullif(trim(p_person_role),''), 'Staff'), p_actor)
      returning id into v_pid;
    end if;
  end if;
  insert into ops.question_event (question_id, actor, actor_name, action, what_happened, cause, person_id, person_name, prevention)
  values (v_id, p_actor, p_actor_name, 'answered', trim(p_what), p_cause, v_pid, v_pname, trim(p_prevention));
  return v_id;
end $fn$;

-- the view gains the flag (appended column, so create or replace is allowed)
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
       (select count(*) from ops.question_event e2 where e2.question_id = q.id and e2.action = 'pushed_back') as push_backs,
       q.started_by_field
  from ops.question q
  left join lateral (
    select e.* from ops.question_event e
     where e.question_id = q.id and e.action = 'answered'
     order by e.at desc limit 1) a on true
  left join ops.cause c on c.code = a.cause
  left join ops.person p on p.id = a.person_id;
