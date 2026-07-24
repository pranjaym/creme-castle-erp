-- ============================================================
-- Creme Castle Spine, Migration 040: PORTAL PROFILES (ERP portal auth)
-- Target: the spine Supabase project. Additive and safe to apply on a live DB.
--
-- The ERP portal (apps/portal) signs users in with Supabase Auth (this project).
-- This migration adds the app-level identity: one profile row per auth user, with
-- a role that decides what they may see. Accounts are provisioned by an admin;
-- there is no public signup.
--
-- Covenants honoured: NO hard deletes (deactivate with active=false, never DELETE);
-- append-only audit is not needed here as this is small config, but updated_at is
-- maintained and deactivation is reversible.
-- ============================================================

-- Roles the portal understands today. Widen this list as modules are added
-- (e.g. 'kitchen', 'finance'); every page checks the role server-side.
do $$ begin
  create type portal_role as enum ('admin', 'viewer');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        portal_role not null default 'viewer',
  active       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is
  'ERP portal identity: one row per Supabase Auth user, with the access role. '
  'Deactivate with active=false; never DELETE (covenant: no hard deletes).';

-- Keep updated_at honest on every change.
create or replace function public.touch_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

-- When an admin creates a user (Supabase dashboard or Admin API), auto-create the
-- matching profile as an inactive viewer. The admin then sets the role and flips
-- active=true. Fail-closed default: a brand-new account cannot see anything until
-- an admin activates it.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role, active)
  values (new.id, new.email, 'viewer', false)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Row level security: a signed-in user may read ONLY their own profile (the portal
-- uses this to learn its own role). All admin reads/writes go through the service
-- role, which bypasses RLS. No policy allows a normal user to see other rows or to
-- change their own role.
alter table public.profiles enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id);

-- ---------- BACKFILL ----------
-- Create profiles for any auth users that already exist (idempotent). They land
-- inactive; activate the real people below.
insert into public.profiles (id, email, role, active)
select u.id, u.email, 'viewer', false
from auth.users u
on conflict (id) do nothing;

-- After creating the admin's auth account in the dashboard, activate + promote:
--   update public.profiles set role='admin', active=true, full_name='Pranjay'
--   where email='pranjay@cremecastle.in';
-- Activate each teammate similarly (role stays 'viewer'):
--   update public.profiles set active=true, full_name='...' where email='...';
