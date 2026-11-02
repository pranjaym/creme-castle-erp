-- Checks for migration 250. Read only. Prints one PASS/FAIL table.
-- Lives in migrations/verify/ so scripts/migrate.mjs (top level *.sql only)
-- never executes it.
with checks(check_name, ok) as (
  select 'T1 events table exists', to_regclass('landing.petpooja_push_events') is not null
  union all select 'T2 orders table exists', to_regclass('landing.petpooja_push_orders') is not null
  union all select 'T3 purchase orders table exists', to_regclass('landing.petpooja_push_purchase_orders') is not null
  union all select 'RLS on all three (customer PII is service role only)',
    (select bool_and(relrowsecurity) from pg_class
      where oid in ('landing.petpooja_push_events'::regclass, 'landing.petpooja_push_orders'::regclass,
                    'landing.petpooja_push_purchase_orders'::regclass))
  union all select 'no RLS policy opens them',
    not exists (select 1 from pg_policies where schemaname = 'landing' and tablename like 'petpooja_push%')
  union all select 'bill key unique (rest_id, order_id)',
    exists (select 1 from pg_indexes where schemaname = 'landing' and tablename = 'petpooja_push_orders'
              and indexdef like '%UNIQUE%(rest_id, order_id)%')
  union all select 'PO key unique (menu_sharing_code, po_id)',
    exists (select 1 from pg_indexes where schemaname = 'landing' and tablename = 'petpooja_push_purchase_orders'
              and indexdef like '%UNIQUE%(menu_sharing_code, po_id)%')
  union all select 'anon cannot call petpooja_push_receive',
    not has_function_privilege('anon', 'public.petpooja_push_receive(text,text,text,text,integer,text,text,boolean,text)', 'execute')
  union all select 'authenticated cannot call petpooja_push_receive',
    not has_function_privilege('authenticated', 'public.petpooja_push_receive(text,text,text,text,integer,text,text,boolean,text)', 'execute')
  union all select 'service_role can call petpooja_push_receive',
    has_function_privilege('service_role', 'public.petpooja_push_receive(text,text,text,text,integer,text,text,boolean,text)', 'execute')
  union all select 'anon cannot call petpooja_push_apply',
    not has_function_privilege('anon', 'public.petpooja_push_apply(bigint)', 'execute')
  union all select 'mobile: +91 98765 43210 -> 9876543210', landing.pp_clean_mobile('+91 98765 43210') = '9876543210'
  union all select 'mobile: 09876543210 -> 9876543210', landing.pp_clean_mobile('09876543210') = '9876543210'
  union all select 'mobile: 1234567890 (not a mobile) -> null', landing.pp_clean_mobile('1234567890') is null
  union all select 'mobile: empty -> null', landing.pp_clean_mobile('') is null
  union all select 'number: "0.40" -> 0.40, "" -> null', landing.pp_num('0.40') = 0.40 and landing.pp_num('') is null
  union all select 'time: 2026-01-19 16:42:24 kept as IST wall clock',
    landing.pp_ts('2026-01-19 16:42:24') = timestamp '2026-01-19 16:42:24'
  union all select 'business day: 01:54 IST belongs to the day before',
    business_day(landing.pp_ts('2026-08-22 01:54:29') at time zone 'Asia/Kolkata') = date '2026-08-21'
  union all select 'migration recorded in schema_migrations',
    exists (select 1 from schema_migrations where filename = '250_petpooja_push_receivers.sql')
)
select check_name, case when ok then 'PASS' else 'FAIL' end as result from checks;
