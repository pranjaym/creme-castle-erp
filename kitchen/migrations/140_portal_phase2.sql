-- ============================================================
-- Creme Castle Spine, Migration 140: PORTAL PHASE 2 (users module foundations)
-- Target: the spine Supabase project. Additive and safe to apply on a live DB.
--
-- Three things:
--   1. Widen portal_role: admin / central / area_manager / store (viewer stays
--      valid and is treated as read-only central until reassigned).
--   2. profiles gains outlet_codes (the scope: store = one code, area manager =
--      their outlets, central/admin = empty meaning all) and modules.
--   3. public.outlets: the canonical outlet master. Seeded with the 41 rows
--      verified on 23 Aug 2026 by joining Zomato order ids to Petpooja's order
--      log (every store confirmed on hundreds of orders). Feeds the portal, the
--      dashboard module and the daily mailer. Plus portal_admin_log, append-only.
--
-- Covenants: no hard deletes (outlets and profiles deactivate; the log only
-- inserts). Postgres 17: ALTER TYPE ADD VALUE is transaction-safe as long as the
-- new values are not used in the same transaction, and nothing below uses them.
-- ============================================================

alter type portal_role add value if not exists 'central';
alter type portal_role add value if not exists 'area_manager';
alter type portal_role add value if not exists 'store';

alter table public.profiles add column if not exists outlet_codes text[] not null default '{}';
alter table public.profiles add column if not exists modules text[] not null default '{}';
comment on column public.profiles.outlet_codes is
  'Scope: store role = exactly one internal_code; area_manager = their outlets; empty = all (admin/central).';
comment on column public.profiles.modules is
  'Module grants beyond the role default. Empty = role default set.';

create table if not exists public.outlets (
  internal_code        text primary key,
  zomato_restaurant_id text unique,
  locality             text,
  city                 text,
  area_manager         text,
  store_email          text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.outlets is
  'Canonical outlet master. internal_code is the company name (CC-ND-Sector 45). '
  'Zomato mapping verified 23 Aug 2026 via Petpooja order-log join. Never DELETE; '
  'set active=false when an outlet closes.';
alter table public.outlets enable row level security;

insert into public.outlets (internal_code, zomato_restaurant_id, locality, city, area_manager, store_email) values
  ('CC-DL-Dwarka Mor','22531033','Dwarka Mor','Delhi','Ajay','cc.dl.dwarkamor@cremecastle.in'),
  ('CC-DL-Janakpuri','21086673','Janakpuri','Delhi','Ajay','ccjanakds@cremecastle.in'),
  ('CC-DL-Sarita Vihar','22230746','Kalkaji','Delhi','Ajay','cc.dl.saritavihar@cremecastle.in'),
  ('CC-DL-Karol Bagh','21710125','Karol Bagh','Delhi','Ajay','cc.dl.karolbagh@cremecastle.in'),
  ('CC-DL-Krishna Nagar','21251869','Krishna Nagar','Delhi','Ajay','cckrishna@cremecastle.in'),
  ('CC-DL-Paschim Vihar','22184428','Paschim Vihar','Delhi','Ajay','cc.dl.paschimvihar@cremecastle.in'),
  ('CC-DL-Rohini','22184663','Rohini','Delhi','Ajay','cc.dl.rohini@cremecastle.in'),
  ('CC-FBD-Sector 15','21803038','Sector 15','Faridabad','Ajay','cc.fbd.sector15@cremecastle.in'),
  ('CC-FBD-Sector 37','22521001','Sector 37','Faridabad','Ajay','cc.fbd.sector37@cremecastle.in'),
  ('CC-DL-Dwarka','21710140','Sector 7, Dwarka','Delhi','Ajay','cc.dl.dwarka@cremecastle.in'),
  ('CC-DL-Shalimar Bagh','21710105','Shalimar Bagh','Delhi','Ajay','cc.dl.shalimarbagh@cremecastle.in'),
  ('CC-ND-Diamond Plaza','22531048','Amrapali Golf Homes','Greater Noida West','Gopal','cc.nd.gaurcity1@cremecastle.in'),
  ('CC-ND-Sector 68','18988513','Chaukhandi','Noida','Gopal','cashier67@cremecastle.in'),
  ('CC-ND-Alpha 2','306520','Gamma 2','Greater Noida','Gopal','dispatchansal@cremecastle.in'),
  ('CC-DL-Mayur Vihar Ph 3','22002105','Mayur Vihar Phase 3','Delhi','Gopal','cc.dl.mayurvihar@cremecastle.in'),
  ('CC-DL-NFC','21969690','New Friends Colony','Delhi','Gopal','cc.dl.nfc@cremecastle.in'),
  ('CC-ND-Sector141','21317826','Paras Tierea','Noida','Gopal','ccndsector5@cremecastle.in'),
  ('CC-GZB-Raj Nagar','22223494','Raj Nagar','Ghaziabad','Gopal','cc.up.rajnagar@cremecastle.in'),
  ('CC-ND-Sector 116','22531070','Sector 116','Noida','Gopal','cc.nd.sector116@cremecastle.in'),
  ('CC-ND-Sector 45','21317808','Sector 45','Noida','Gopal','ccndsector45@cremecastle.in'),
  ('CC-UP-Meerut','21876814','Shastri Nagar','Meerut','Gopal','cc.up.merrut@cremecastle.in'),
  ('CC-ND-Gaur City','21961204','Supertech Eco Village 1','Greater Noida West','Gopal','cc.nd.gaurcity@cremecastle.in'),
  ('CC-GZB-Vasundhara','21804504','Vasundhara','Ghaziabad','Gopal','cc.gzb.vasundhara@cremecastle.in'),
  ('CC-PB-Ludhiana','22871646','Civil Lines','Ludhiana','Mukesh','cc.pb.ludhiana@cremecastle.in'),
  ('CC-CHD-Zirakpur','22375520','Lohgarh','Chandigarh','Mukesh','cc.chd.zirakpur@cremecastle.in'),
  ('CC-CHD-Mohali','22375516','Phase 7','Chandigarh','Mukesh','cc.chd.mohali@cremecastle.in'),
  ('CC-CHD-Sector 16','22449679','Sector 16','Chandigarh','Mukesh','cc.chd.sector16@cremecastle.in'),
  ('CC-CHD-Industrial Area','22407186','Sector 4','Chandigarh','Mukesh','cc.chd.ind.area@cremecastle.in'),
  ('CC-GGN-Sector 52','22215422','Ardee City','Gurugram','Sanjeev','cc.ggn.sector37@cremecastle.in'),
  ('CC-GGN-DLF Ph 4','21264282','DLF Phase 1','Gurugram','Sanjeev','ccgalleriads@cremecastle.in'),
  ('CC-DL-South Campus','22521042','Moti Bagh','Delhi','Sanjeev','cc.ggn.udyogvihar@cremecastle.in'),
  ('CC-GGN-Sector 4','19561066','Sector 4','Gurugram','Sanjeev','ccggn4@cremecastle.in'),
  ('CC-GGN-Sector 60','22181929','Sector 60','Gurugram','Sanjeev','cc.ggn.sector60@cremecastle.in'),
  ('CC-GGN-Sector 86','22213649','Sector 86','Gurugram','Sanjeev','cc.ggn.sector86@cremecastle.in'),
  ('CC-DL-Shahpurjat','21086662','Shahpur Jat','Delhi','Sanjeev','ccshahpurds@cremecastle.in'),
  ('CC-GGN-Sector 49','21308818','South City 2','Gurugram','Sanjeev','ccggn49@cremecastle.in'),
  ('CC-DL-Vasant Kunj','21817822','Vasant Kunj','Delhi','Sanjeev','cc.dl.vasantkunj@cremecastle.in'),
  ('CC-JP-Bais Godam','22065805','Bais Godam','Jaipur','Santosh','cc.jp.baisgodam@cremecastle.in'),
  ('CC-JP-Pratap Nagar','22531082','Pratap Nagar','Jaipur','Santosh','cc.jp.pratapnagar@cremecastle.in'),
  ('CC-JP-Malviya Nagar','22065804','Tonk Road','Jaipur','Santosh','cc.jp.malviyanagar@cremecastle.in'),
  ('CC-JP-Vaishali Nagar','22065806','Vaishali Nagar','Jaipur','Santosh','cc.jp.vaishalinagar@cremecastle.in')
on conflict (internal_code) do nothing;

-- Store emails carried verbatim from Pranjay's "Outlet Email ID.xlsx" (23 Aug 2026).
-- Six look historical and are pending his confirmation before any mailer uses them:
-- Sector 52 -> cc.ggn.sector37@, South Campus -> cc.ggn.udyogvihar@,
-- Sector141 -> ccndsector5@, Sector 68 -> cashier67@, Alpha 2 -> dispatchansal@,
-- Meerut -> cc.up.merrut@ (spelling as listed).

create or replace function public.touch_outlets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_outlets_touch on public.outlets;
create trigger trg_outlets_touch before update on public.outlets
  for each row execute function public.touch_outlets_updated_at();

create table if not exists public.portal_admin_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  actor_email text,
  action     text not null,
  target     text,
  detail     jsonb
);
comment on table public.portal_admin_log is
  'Append-only audit of portal admin actions (user created, role changed, scope '
  'changed, activated/deactivated). Never UPDATE or DELETE rows.';
alter table public.portal_admin_log enable row level security;
