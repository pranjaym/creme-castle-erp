-- 198: one outlet, many sites. The relocation model. (F40, step 2)
--
-- STAGED, NOT APPROVED FOR APPLY. It lives here and not in kitchen/migrations/ because
-- anything in that folder is one migrate.mjs invocation away from executing, from any
-- session. That is exactly how 196 went live unapproved (F41). Move it only on the go.
--
-- This file deliberately carries NO begin; / commit;. The caller owns the transaction.
--
-- WHY. A store that relocates is ONE trading identity (same Zomato RID, same Swiggy RID,
-- same team, same customers reordering) sitting on a SUCCESSION of physical sites. The
-- two must not be collapsed:
--
--   Collapse onto the current site  -> every historical report says Delhi, and five
--                                      months of Gurgaon sales silently move city.
--   Split into two stores           -> the store's own trend snaps in half, and the
--                                      customer repeat count doubles.
--
-- So: one location row, and an effective-dated site row per physical address. An order
-- resolves its site from (location_id, business_date), which makes "how is this store
-- doing over time" and "what did Gurgaon sell in May" both correct at once.
--
-- Cutovers, measured from the ORDER report only (the feed that never duplicated), each
-- a single clean handover day with the old name never trading again:
--   CC-GGN-Udyog Vihar -> CC-DL-South Campus    20 Jul 2026   Gurgaon to Delhi
--   CC-GGN-Sector 37   -> CC-GGN-Sector 52      11 Feb 2026   same city
--   CC-ND-Gaur City 1  -> CC-ND-Diamond Plaza   25 Feb 2026   same city


-- ---------------------------------------------------------------- 1. the sites table
create table if not exists public.location_sites (
  id           bigint generated always as identity primary key,
  location_id  bigint not null references public.locations(id),
  valid_from   date,                       -- null = from the beginning of the record
  valid_to     date,                       -- null = current site
  site_name    text not null,              -- the outlet name in use while this site was live
  city         text,                        -- nullable: a department or dept-level
                                            -- location has no city of its own
  region       text,
  state        text,
  address      text,
  gstin        text,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists location_sites_lookup
  on public.location_sites (location_id, valid_from, valid_to);
create unique index if not exists location_sites_name_uq
  on public.location_sites (location_id, site_name, coalesce(valid_from, '1900-01-01'::date));

comment on table public.location_sites is
  'Effective-dated physical sites for a location. A relocation adds a row, it never '
  'creates a second location. Resolve an order with: business_date >= coalesce(valid_from, business_date) '
  'and business_date <= coalesce(valid_to, business_date).';


-- ------------------------------------------- 2. seed one current site for every location
-- Unbounded start (valid_from null) because we are not asserting an opening date we have
-- not verified. The three relocations get their real dates in step 4 below.
insert into public.location_sites (location_id, valid_from, valid_to, site_name, city, region, note)
select l.id, null, null, l.name, l.city, l.region,
       'Seeded from locations by migration 198. Current site.'
  from public.locations l
 where not exists (select 1 from public.location_sites s where s.location_id = l.id);


-- ------------------------------------------ 3. fold Udyog Vihar into the South Campus id
-- Sector 37 and Gaur City 1 already share their successor's location (073 did this).
-- Udyog Vihar does not: it is location 36, South Campus is 55. This is the only repoint.
update core.order_items set location_id = 55 where location_id = 36;
update core.orders      set location_id = 55 where location_id = 36;

-- The alias rows must be MOVED, not inserted: uq_location_aliases is unique on
-- (system, external_code, external_name), so a second 'petpooja'/'CC-GGN-Udyog Vihar'
-- row would collide.
update public.location_aliases
   set location_id = 55,
       note = 'CC-GGN-Udyog Vihar relocated to CC-DL-South Campus on 20 Jul 2026. Same '
              'Zomato RID 22521042, same Swiggy RID, same store email. One outlet, two '
              'sites: see public.location_sites. Repointed by migration 198.'
 where location_id = 36;

insert into public.location_aliases (location_id, system, external_name, note)
select 55, 'petpooja', 'CC-DL-South Campus',
       'Current Petpooja name for this outlet, in use from 20 Jul 2026.'
 where not exists (
   select 1 from public.location_aliases
    where system = 'petpooja' and coalesce(external_name,'') = 'CC-DL-South Campus');

-- Retire the emptied location. Not deleted (canonical rule 6).
update public.locations
   set active    = false,
       lifecycle = 'superseded',
       notes     = coalesce(notes || ' ', '') ||
                   'SUPERSEDED by migration 198: this was not a separate store. The '
                   'CC-GGN-Udyog Vihar outlet relocated to CC-DL-South Campus (location 55) '
                   'on 20 Jul 2026 and its orders, items and aliases were repointed there. '
                   'The Gurgaon period survives as a dated row in public.location_sites.'
 where id = 36
   -- idempotent: a second run must not append the note again (F41 showed the ledger
   -- can go stale and a runner can re-walk history)
   and coalesce(notes, '') not like '%SUPERSEDED by migration 198%';


-- --------------------------------------------- 4. the real site history, all three moves
-- Udyog Vihar / South Campus (location 55): the only move that changed city and GSTIN.
update public.location_sites
   set valid_from = date '2026-07-20',
       site_name  = 'CC-DL-South Campus',
       city       = 'Delhi',
       state      = 'Delhi',
       gstin      = '07AAJCC5890L1Z2',
       note       = 'Site 2. From the relocation on 20 Jul 2026. GSTIN and address from '
                    'the SupplyNote locations master.'
 where location_id = 55 and valid_from is null;

insert into public.location_sites
  (location_id, valid_from, valid_to, site_name, city, region, state, note)
values
  (55, null, date '2026-07-19', 'CC-GGN-Udyog Vihar', 'Gurgaon', 'Delhi NCR', 'Haryana',
   'Site 1. Traded under this name and address until the move on 20 Jul 2026. The move '
   'crossed a state line, so the GST registration changed with it.')
on conflict do nothing;

-- Sector 37 -> Sector 52 (location 33), same city, so only the name and dates move.
update public.location_sites
   set valid_from = date '2026-02-11',
       note       = 'Site 2. From the move on 11 Feb 2026.'
 where location_id = 33 and valid_from is null;

insert into public.location_sites
  (location_id, valid_from, valid_to, site_name, city, region, note)
values
  (33, null, date '2026-02-10', 'CC-GGN-Sector 37', 'Gurgaon', 'Delhi NCR',
   'Site 1. Traded under this name until the move on 11 Feb 2026.')
on conflict do nothing;

-- Gaur City 1 -> Diamond Plaza (location 48), same city.
update public.location_sites
   set valid_from = date '2026-02-25',
       note       = 'Site 2. From the move on 25 Feb 2026.'
 where location_id = 48 and valid_from is null;

insert into public.location_sites
  (location_id, valid_from, valid_to, site_name, city, region, note)
values
  (48, null, date '2026-02-24', 'CC-ND-Gaur City 1', 'Noida', 'Delhi NCR',
   'Site 1. Traded under this name until the move on 25 Feb 2026.')
on conflict do nothing;


-- ------------------------------------------------------ 5. the resolver, and the marker
-- Every live order with the site it actually traded from.
create or replace view public.order_site as
select o.id            as order_id,
       o.location_id,
       o.outlet_raw,
       o.business_date,
       s.id            as site_id,
       s.site_name,
       s.city          as site_city,
       s.region        as site_region,
       s.state         as site_state,
       s.gstin         as site_gstin
  from core.orders o
  join public.location_sites s
    on s.location_id = o.location_id
   and (s.valid_from is null or o.business_date >= s.valid_from)
   and (s.valid_to   is null or o.business_date <= s.valid_to)
 where o.superseded_at is null;

comment on view public.order_site is
  'An order joined to the physical site it traded from on its business date. Use '
  'site_city, never locations.city, for any historical city rollup: locations.city is '
  'only ever the CURRENT city.';

-- Any location that has moved, and when. A page comparing a window that spans one of
-- these dates must print a RELOCATED marker: the catchment changed, so the comparison
-- is not like for like even though the store is genuinely the same business.
create or replace view public.location_relocations as
select prev.location_id,
       prev.valid_to + 1                as relocated_on,
       prev.site_name                   as moved_from_name,
       prev.city                        as moved_from_city,
       next.site_name                   as moved_to_name,
       next.city                        as moved_to_city,
       (prev.city is distinct from next.city) as city_changed
  from public.location_sites prev
  join public.location_sites next
    on next.location_id = prev.location_id
   and next.valid_from  = prev.valid_to + 1
 order by 2 desc;
