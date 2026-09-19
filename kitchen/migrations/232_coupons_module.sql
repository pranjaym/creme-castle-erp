-- 232: Coupon sharing module (Zomato and Swiggy discounts): schema, nightly
-- computation, deal register, glossary, uploaded-sheet register, audit.
-- Authorised by Pranjay 19 Sep 2026 ("Build this, take it live").
-- Design: erp-plan/coupon-sharing-module-notes.md and the approved
-- wireframe erp-plan/coupon-sharing-wireframe-v2.html.
--
-- The question the module answers: on every coupon order, how much of the
-- discount did WE pay and how much did the platform pay, against what we agreed.
-- Zomato: Petpooja gives the total shared discount (aggregator + outlet discount
--   minus Zomato's flat offs and freebies, which are 100% ours), Zomato's order
--   history export gives our share (restaurant_discount_promo), Zomato's business
--   export gives the coupon NAME (promo_code). The deal follows the name.
-- Swiggy: Swiggy's daily file gives the coupon code and coupon value, Petpooja
--   gives our share (outlet_discount); Swiggy's restaurant_trade_discount is
--   an extra that is 100% ours and sits outside sharing, like Zomato's FVC.
-- Pranjay's flag rule: only when the platform pays LESS than agreed (our share
-- above the agreed maximum). When they fund more, stay quiet.
-- Nothing here is deleted. coupons.order_share is a derived cache rebuilt per
-- day from the landing tables; every human edit writes coupons.event.

create schema if not exists coupons;

-- ---------- settings ----------
create table if not exists coupons.setting (
  key        text primary key,
  value      text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into coupons.setting (key, value) values ('tolerance_pts', '0.5') on conflict (key) do nothing;

-- ---------- audit ----------
create table if not exists coupons.event (
  id        bigint generated always as identity primary key,
  entity    text not null,            -- coupon | deal | upload | setting | refresh
  entity_id bigint,
  action    text not null,
  actor     text,
  data      jsonb,
  at        timestamptz not null default now()
);

-- ---------- glossary: one row per coupon name per platform ----------
create table if not exists coupons.coupon (
  id           bigint generated always as identity primary key,
  platform     text not null check (platform in ('zomato','swiggy')),
  code         text not null,                   -- the name the platform prints (GET175, FLAT150)
  what_it_is   text,                            -- human: "Flat 175 off, MOV 699"; Zomato's printed construct is on the orders
  kind         text check (kind in ('percent','flat','flat_percent','bogo','payment','other')),
  for_whom     text,                            -- New user / Repeat user / All users / New to platform
  segment      text,                            -- LA/MM, UM, All
  status       text not null default 'new' check (status in ('new','active','retired')),
  first_seen   date,
  last_seen    date,
  notes        text,
  updated_by   text,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (platform, code)
);
comment on table coupons.coupon is 'Glossary of coupon names. Rows are created by the nightly refresh the first time a name is seen (status new) and edited by people; never deleted.';

-- ---------- deals: the most we agreed to pay, per coupon name, optionally per outlet ----------
create table if not exists coupons.deal (
  id                 bigint generated always as identity primary key,
  platform           text not null check (platform in ('zomato','swiggy')),
  code               text not null,
  outlet_code        text references public.outlets(internal_code),   -- null = every outlet
  max_our_share_pct  numeric(6,2) not null check (max_our_share_pct between 0 and 100),
  effective_from     date not null,
  effective_to       date,
  agreed_with        text,
  note               text,
  created_by         text,
  created_at         timestamptz not null default now(),
  superseded_at      timestamptz,
  superseded_by      bigint references coupons.deal(id)
);
create index if not exists idx_deal_lookup on coupons.deal (platform, code, coalesce(outlet_code,''), effective_from) where superseded_at is null;
comment on table coupons.deal is 'Agreed sharing per coupon name. A new deal supersedes the old one (superseded_at set, never deleted), so last month is read with last month''s deal.';

-- ---------- the uploaded discount sheet, as a register ----------
create table if not exists coupons.upload (
  id             bigint generated always as identity primary key,
  platform       text not null check (platform in ('zomato','swiggy')),
  label          text not null,                 -- "Apr-2026 Revised"
  effective_from date,
  source         text,                          -- file name
  uploaded_by    text,
  uploaded_at    timestamptz not null default now(),
  row_count      int,
  superseded_at  timestamptz
);
create table if not exists coupons.upload_cell (
  id             bigint generated always as identity primary key,
  upload_id      bigint not null references coupons.upload(id),
  outlet_code    text not null,                 -- public.outlets.internal_code as written on the sheet
  platform_rid   text,                          -- the platform's restaurant id on the sheet
  col_no         int not null,
  slot_group     text,                          -- "New User Base Codes"
  slot           text,                          -- "LA/MM"
  construct      text,                          -- as typed: "Flat 125 MOV 549"
  construct_norm text                           -- as Zomato prints it: "Flat Rs.125 off"
);
create index if not exists idx_upload_cell_upload on coupons.upload_cell (upload_id, outlet_code);

-- sheet text to the form Zomato prints on an order
create or replace function coupons.norm_construct(p text) returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~* '^\s*(\d+)%\s*upto\s*(\d+)\s*$' then regexp_replace(p, '^\s*(\d+)%\s*upto\s*(\d+)\s*$', '\1% off upto Rs.\2', 'i')
    when p ~* '^\s*Flat\s*(\d+)\s*MOV\s*\d+\s*$' then regexp_replace(p, '^\s*Flat\s*(\d+)\s*MOV\s*\d+\s*$', 'Flat Rs.\1 off', 'i')
    when p ~* '^\s*Flat\s*(\d+)\s*$' then regexp_replace(p, '^\s*Flat\s*(\d+)\s*$', 'Flat Rs.\1 off', 'i')
    else btrim(p) end
$$;

-- ---------- the computed order table ----------
create table if not exists coupons.order_share (
  platform      text not null check (platform in ('zomato','swiggy')),
  order_no      text not null,
  business_date date not null,
  outlet_code   text,
  city          text,
  code          text,                           -- coupon name (null = no coupon named)
  construct     text,                           -- what it is, as printed (Zomato only)
  bill          numeric(12,2),                  -- bill subtotal (Zomato) / GMV (Swiggy)
  burn          numeric(12,2) not null,         -- the shared discount
  ours          numeric(12,2) not null,         -- our share of the shared discount
  theirs        numeric(12,2) not null,         -- the platform's share
  extras        numeric(12,2) not null,         -- discounts that are always fully ours (Zomato FVC, Swiggy trade discount)
  share_pct     numeric(7,2),                   -- ours / burn * 100
  is_coupon     boolean not null,
  matched       boolean not null,               -- the platform row was found for this order
  computed_at   timestamptz not null default now(),
  primary key (platform, order_no)
);
create index if not exists idx_order_share_date on coupons.order_share (business_date);
create index if not exists idx_order_share_code on coupons.order_share (platform, code, business_date);
create index if not exists idx_order_share_outlet on coupons.order_share (outlet_code, business_date);
comment on table coupons.order_share is 'Derived, one row per aggregator order, rebuilt per day by coupons.refresh_day. Not a business record: the landing tables are.';

create table if not exists coupons.day_status (
  business_date date not null,
  platform      text not null,
  orders        int not null,
  matched       int not null,
  coupon_orders int not null,
  computed_at   timestamptz not null default now(),
  primary key (business_date, platform)
);

-- ---------- the nightly computation, one day at a time ----------
create or replace function coupons.refresh_day(d date) returns void language plpgsql as $$
declare zn int; zm int; zc int; sn int; sm int; sc int;
begin
  delete from coupons.order_share where business_date = d;

  -- Zomato: Petpooja order + Zomato order-history row + Zomato business row
  insert into coupons.order_share (platform, order_no, business_date, outlet_code, city, code, construct, bill, burn, ours, theirs, extras, share_pct, is_coupon, matched)
  select 'zomato', pp.ono, d, pp.outlet_name, o.city,
         nullif(split_part(coalesce(bo.promo_code,''), ',', 1), ''),
         nullif(od.construct, ''),
         od.subtotal,
         pp.disc - coalesce(od.fvc, 0),
         coalesce(od.promo, 0),
         pp.disc - coalesce(od.fvc, 0) - coalesce(od.promo, 0),
         coalesce(od.fvc, 0),
         case when pp.disc - coalesce(od.fvc,0) > 0 then round(100 * coalesce(od.promo,0) / (pp.disc - coalesce(od.fvc,0)), 2) end,
         (pp.disc - coalesce(od.fvc,0) > 0 and nullif(od.construct,'') is not null),
         (od.oid is not null)
  from (
    select distinct on (aggregator_order_no) aggregator_order_no ono, outlet_name,
           coalesce(nullif(aggregator_discount,'')::numeric,0) + coalesce(nullif(outlet_discount,'')::numeric,0) disc
    from landing.petpooja_online_orders
    where business_date = d and lower(order_from) = 'zomato'
      and status not ilike '%cancel%' and voided_at is null and coalesce(aggregator_order_no,'') <> ''
    order by aggregator_order_no, id desc
  ) pp
  left join public.outlets o on o.internal_code = pp.outlet_name
  left join lateral (
    select zomato_order_id oid, discount_construct construct,
           nullif(bill_subtotal,'')::numeric subtotal,
           coalesce(nullif(restaurant_discount_promo,'')::numeric,0) promo,
           coalesce(nullif(restaurant_discount_flat,'')::numeric,0) fvc
    from landing.zomato_order_details z
    where z.zomato_order_id = pp.ono and z.superseded_at is null
    order by z.id desc limit 1
  ) od on true
  left join lateral (
    select promo_code from landing.zomato_business_order b
    where b.zomato_order_id = pp.ono and b.superseded_at is null
    order by b.id desc limit 1
  ) bo on true;

  select count(*), count(*) filter (where matched), count(*) filter (where is_coupon) into zn, zm, zc
  from coupons.order_share where business_date = d and platform = 'zomato';

  -- Swiggy: Swiggy coupon row + Petpooja order (our share arrives in Petpooja's outlet discount)
  insert into coupons.order_share (platform, order_no, business_date, outlet_code, city, code, construct, bill, burn, ours, theirs, extras, share_pct, is_coupon, matched)
  select 'swiggy', s.order_id, d, pp.outlet_name, o.city, nullif(s.coupon_code,''), null,
         s.gmv,
         s.cd,
         coalesce(pp.od, 0) - s.rtd,
         s.cd - (coalesce(pp.od, 0) - s.rtd),
         s.rtd,
         case when s.cd > 0 then round(100 * (coalesce(pp.od,0) - s.rtd) / s.cd, 2) end,
         (s.cd > 0 and nullif(s.coupon_code,'') is not null),
         (pp.ono is not null)
  from (
    select distinct on (order_id) order_id, coupon_code,
           coalesce(nullif(coupon_discount,'')::numeric,0) cd,
           coalesce(nullif(restaurant_trade_discount,'')::numeric,0) rtd,
           nullif(gmv_total,'')::numeric gmv
    from landing.swiggy_coupon_orders
    where business_date = d and superseded_at is null and coalesce(order_id,'') <> ''
    order by order_id, dup_seq, id desc
  ) s
  left join lateral (
    select aggregator_order_no ono, outlet_name, coalesce(nullif(outlet_discount,'')::numeric,0) od
    from landing.petpooja_online_orders p
    where p.aggregator_order_no = s.order_id and p.business_date between d - 1 and d + 1
      and lower(p.order_from) = 'swiggy' and p.status not ilike '%cancel%' and p.voided_at is null
    order by p.id desc limit 1
  ) pp on true
  left join public.outlets o on o.internal_code = pp.outlet_name
  where pp.ono is not null;   -- an unmatched Swiggy row has no outlet and no share; it is counted in day_status below

  select count(*) into sn from (select distinct order_id from landing.swiggy_coupon_orders where business_date = d and superseded_at is null) x;
  select count(*), count(*) filter (where is_coupon) into sm, sc from coupons.order_share where business_date = d and platform = 'swiggy';

  insert into coupons.day_status (business_date, platform, orders, matched, coupon_orders, computed_at)
  values (d, 'zomato', coalesce(zn,0), coalesce(zm,0), coalesce(zc,0), now()), (d, 'swiggy', coalesce(sn,0), coalesce(sm,0), coalesce(sc,0), now())
  on conflict (business_date, platform) do update set orders = excluded.orders, matched = excluded.matched, coupon_orders = excluded.coupon_orders, computed_at = now();

  -- the glossary learns every name it sees
  insert into coupons.coupon (platform, code, kind, first_seen, last_seen, status)
  select platform, code,
         case when max(construct) ~ '^Flat Rs\.' then 'flat'
              when max(construct) ~ '^Flat \d+% off' then 'flat_percent'
              when max(construct) ~ '% off upto' then 'percent'
              when platform = 'swiggy' and code like 'FLAT%' then 'flat'
              when code in ('PAYTMUPI','AMZNPAY3','APAYCCFEST') then 'payment'
              when code like 'BUY1GET1%' then 'bogo' end,
         d, d, 'new'
  from coupons.order_share where business_date = d and code is not null
  group by platform, code
  on conflict (platform, code) do update
    set first_seen = least(coupons.coupon.first_seen, excluded.first_seen),
        last_seen  = greatest(coupons.coupon.last_seen, excluded.last_seen),
        kind = coalesce(coupons.coupon.kind, excluded.kind);
end $$;

-- refresh the last three settled days (platform files restate for a few days)
create or replace function coupons.refresh_recent(p_days int default 3) returns void language plpgsql as $$
declare d date; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for i in 1..p_days loop
    d := today - i;
    perform coupons.refresh_day(d);
  end loop;
  insert into coupons.event (entity, action, actor, data) values ('refresh', 'refresh_recent', 'pg_cron', jsonb_build_object('days', p_days, 'as_of', today));
end $$;

-- ---------- writes the portal calls (each writes its audit row) ----------
create or replace function coupons.save_coupon(p_platform text, p_code text, p_what text, p_kind text, p_for_whom text, p_segment text, p_status text, p_notes text, p_actor text)
returns void language plpgsql as $$
begin
  insert into coupons.coupon (platform, code, what_it_is, kind, for_whom, segment, status, notes, updated_by)
  values (p_platform, p_code, p_what, nullif(p_kind,''), p_for_whom, p_segment, coalesce(nullif(p_status,''),'active'), p_notes, p_actor)
  on conflict (platform, code) do update
    set what_it_is = excluded.what_it_is, kind = excluded.kind, for_whom = excluded.for_whom, segment = excluded.segment,
        status = excluded.status, notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now();
  insert into coupons.event (entity, entity_id, action, actor, data)
  select 'coupon', id, 'save', p_actor, jsonb_build_object('platform', p_platform, 'code', p_code, 'what', p_what, 'kind', p_kind, 'for_whom', p_for_whom, 'segment', p_segment, 'status', p_status)
  from coupons.coupon where platform = p_platform and code = p_code;
end $$;

create or replace function coupons.set_deal(p_platform text, p_code text, p_outlet text, p_pct numeric, p_from date, p_agreed_with text, p_note text, p_actor text)
returns bigint language plpgsql as $$
declare new_id bigint;
begin
  insert into coupons.deal (platform, code, outlet_code, max_our_share_pct, effective_from, agreed_with, note, created_by)
  values (p_platform, p_code, nullif(p_outlet,''), p_pct, p_from, p_agreed_with, p_note, p_actor) returning id into new_id;
  -- the previous open deal for the same coupon and scope ends the day before
  update coupons.deal set superseded_at = now(), superseded_by = new_id, effective_to = coalesce(effective_to, p_from - 1)
  where platform = p_platform and code = p_code and coalesce(outlet_code,'') = coalesce(p_outlet,'') and id <> new_id and superseded_at is null;
  update coupons.coupon set status = 'active', updated_at = now() where platform = p_platform and code = p_code and status = 'new';
  insert into coupons.event (entity, entity_id, action, actor, data)
  values ('deal', new_id, 'set', p_actor, jsonb_build_object('platform', p_platform, 'code', p_code, 'outlet', p_outlet, 'pct', p_pct, 'from', p_from, 'agreed_with', p_agreed_with, 'note', p_note));
  return new_id;
end $$;

create or replace function coupons.set_setting(p_key text, p_value text, p_actor text) returns void language plpgsql as $$
begin
  insert into coupons.setting (key, value, updated_by) values (p_key, p_value, p_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  insert into coupons.event (entity, action, actor, data) values ('setting', 'set', p_actor, jsonb_build_object('key', p_key, 'value', p_value));
end $$;

-- the deal that applies to one order: outlet-specific first, then network-wide, by date
create or replace function coupons.deal_for(p_platform text, p_code text, p_outlet text, p_date date) returns numeric language sql stable as $$
  select max_our_share_pct from coupons.deal
  where platform = p_platform and code = p_code and superseded_at is null
    and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
    and (outlet_code = p_outlet or outlet_code is null)
  order by outlet_code nulls last, effective_from desc limit 1
$$;

-- ---------- schedule: after the morning files and after the evening Zomato pull (times in UTC) ----------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'coupons_refresh_morning') then perform cron.unschedule('coupons_refresh_morning'); end if;
    if exists (select 1 from cron.job where jobname = 'coupons_refresh_night') then perform cron.unschedule('coupons_refresh_night'); end if;
    perform cron.schedule('coupons_refresh_morning', '30 5 * * *', $j$ select coupons.refresh_recent(3) $j$);   -- 11:00 IST
    perform cron.schedule('coupons_refresh_night',   '0 18 * * *', $j$ select coupons.refresh_recent(3) $j$);   -- 23:30 IST
  end if;
end $$;

-- ---------- RLS, same stance as the rest of the spine: service role only ----------
alter table coupons.setting      enable row level security;
alter table coupons.event        enable row level security;
alter table coupons.coupon       enable row level security;
alter table coupons.deal         enable row level security;
alter table coupons.upload       enable row level security;
alter table coupons.upload_cell  enable row level security;
alter table coupons.order_share  enable row level security;
alter table coupons.day_status   enable row level security;
