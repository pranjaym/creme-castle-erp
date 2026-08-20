-- ============================================================
-- Migration 090: DEPARTMENT REQUESTS (the indent / PO-style flow)
-- Decision: Pranjay 19 Aug 2026 evening. Both directions must exist:
--   push  = a maker SENDS without being asked (already built: issued rows)
--   pull  = a department RAISES A REQUEST on a maker; the maker fulfils it
-- A request is a workflow document, not a movement. Its fulfilment state is
-- DERIVED from the issued movements that link back to it (request_id on
-- production_log), never stored. The only stored transition is cancellation
-- (requester withdraws, or the maker declines with a reason); rows are never
-- deleted.
-- ============================================================

create table if not exists dept_requests (
  id                          bigint generated always as identity primary key,
  requested_by_location_id    bigint not null references locations(id),  -- who is asking
  requested_from_location_id  bigint not null references locations(id),  -- the maker being asked
  sku_id                      bigint not null references skus(id),
  qty                         numeric(12,2) not null check (qty > 0),
  uom                         text not null,
  needed_by                   date,               -- optional: when they need it
  note                        text,
  status                      text not null default 'open'
                                check (status in ('open', 'cancelled')),
  cancel_reason               text,
  cancelled_by                text,
  cancelled_at                timestamptz,
  entered_by                  text not null,
  entered_at                  timestamptz not null default now(),
  constraint request_not_to_self check (requested_by_location_id <> requested_from_location_id),
  constraint cancel_needs_reason check (status <> 'cancelled' or cancel_reason is not null)
);
create index if not exists idx_dept_requests_maker on dept_requests (requested_from_location_id, status, entered_at desc);
create index if not exists idx_dept_requests_asker on dept_requests (requested_by_location_id, entered_at desc);
comment on table dept_requests is
  'Indent-style requests between departments. Fulfilment is derived from production_log rows carrying request_id; the only stored transition is cancellation with a reason.';

-- Link an issued movement back to the request it fulfils (nullable: a direct
-- push has no request, and that stays a first-class flow).
alter table production_log add column if not exists request_id bigint references dept_requests(id);
create index if not exists idx_prodlog_request on production_log (request_id) where request_id is not null;

-- Derived state per request: open, partial, fulfilled, or cancelled.
create or replace view v_request_status as
select r.id, r.qty as requested_qty, r.uom, r.needed_by, r.note,
       r.status, r.cancel_reason, r.cancelled_by, r.cancelled_at,
       r.entered_by, r.entered_at,
       rb.code as requester_code, rb.name as requester_name,
       rf.code as maker_code,    rf.name as maker_name,
       s.code as sku_code, s.name as sku_name,
       coalesce(f.sent_qty, 0) as sent_qty,
       greatest(r.qty - coalesce(f.sent_qty, 0), 0) as remaining_qty,
       case
         when r.status = 'cancelled' then 'cancelled'
         when coalesce(f.sent_qty, 0) >= r.qty then 'fulfilled'
         when coalesce(f.sent_qty, 0) > 0 then 'partial'
         else 'open'
       end as state
from dept_requests r
join locations rb on rb.id = r.requested_by_location_id
join locations rf on rf.id = r.requested_from_location_id
join skus s       on s.id  = r.sku_id
left join (
  select request_id, sum(qty) as sent_qty
  from production_log
  where action = 'issued' and request_id is not null
  group by request_id
) f on f.request_id = r.id;
comment on view v_request_status is
  'One row per request with its derived state: open (nothing sent), partial, fulfilled (sent >= asked), or cancelled. sent_qty comes only from issued movements linked via request_id.';
