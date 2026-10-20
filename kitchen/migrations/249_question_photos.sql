-- ============================================================
-- Migration 249: photos on an explanation or an answer.
-- Authorised by Pranjay 20 Oct 2026 ("make it simple only"), after area
-- managers kept calling complaints fake with nothing to show: 33 of 595
-- answers from 22 Sep to 17 Oct said "fake", only 7 of them said a dispatch
-- photo was checked, and the photo itself never reached central.
--
-- Kept simple on purpose: up to four photos, optional, on the same Explain
-- and Answer forms. No new cause, no proof chip, no filter.
--
-- A photo belongs to the answer it was sent with (an 'answered' event). The
-- file sits in the private bucket question-photos and is served only through
-- the portal's signed-in route. Rows are never deleted: a wrong photo is
-- voided with a reason and drops off the trail, the row stays.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-photos', 'question-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

create table if not exists ops.photo (
  id               bigserial primary key,
  question_id      bigint not null references ops.question(id),
  event_id         bigint not null references ops.question_event(id),
  storage_path     text not null unique,              -- inside bucket question-photos
  content_type     text not null,
  bytes            integer not null,
  original_name    text,                              -- as the phone named it
  uploaded_by      text not null,                     -- email
  uploaded_by_name text,
  uploaded_at      timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        text,
  void_reason      text
);
create index if not exists photo_event_idx on ops.photo (event_id);
create index if not exists photo_question_idx on ops.photo (question_id);
alter table ops.photo enable row level security;
comment on table ops.photo is
  'Photos sent with an explanation or answer (migration 249). Never deleted; void with a reason.';

-- Ties an uploaded file to the answer its sender just gave on this question.
create or replace function ops.attach_photo(
  p_question_id bigint, p_actor text, p_actor_name text,
  p_path text, p_content_type text, p_bytes integer, p_original_name text)
returns bigint language plpgsql security definer set search_path = ops, public as $fn$
declare v_event bigint; v_id bigint;
begin
  select id into v_event from ops.question_event
   where question_id = p_question_id and action = 'answered' and actor = p_actor
   order by at desc, id desc limit 1;
  if v_event is null then raise exception 'No answer from you on this question to attach the photo to.'; end if;
  if (select count(*) from ops.photo where event_id = v_event and voided_at is null) >= 4 then
    raise exception 'Four photos is the most one answer can carry.';
  end if;
  insert into ops.photo (question_id, event_id, storage_path, content_type, bytes, original_name, uploaded_by, uploaded_by_name)
  values (p_question_id, v_event, p_path, p_content_type, p_bytes, nullif(trim(p_original_name),''), p_actor, p_actor_name)
  returning id into v_id;
  return v_id;
end $fn$;

-- The trail gains the photos of each event (appended column, so create or
-- replace is allowed; every reader selects its columns by name).
create or replace view ops.v_event as
select e.id, e.question_id, e.at, to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at_iso,
       e.actor, e.actor_name, e.action, e.what_happened, e.cause, c.label as cause_label,
       e.person_id, e.person_name, p.role as person_role, e.prevention, e.note,
       coalesce((select array_agg(ph.id order by ph.id) from ops.photo ph
                  where ph.event_id = e.id and ph.voided_at is null), '{}'::bigint[]) as photo_ids
  from ops.question_event e
  left join ops.cause c on c.code = e.cause
  left join ops.person p on p.id = e.person_id;
