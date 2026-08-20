-- ============================================================
-- Migration 100: KITCHEN ROLES (login + per-department access)
-- Decision: Pranjay 19 Aug 2026 (night). The kitchen app gets login. Roles:
--   department  : sees and writes ONLY its own department screen
--   exec_chef   : sees every department screen and the daily dashboard (admin
--                 Today + Watch pages, read)
--   tech        : everything, including master edits (items, departments)
--   super_admin : everything tech has, plus user management
--
-- Identity reuses the ERP portal's foundation (migration 040): the SAME
-- Supabase Auth project and the SAME public.profiles table, so one email and
-- password works on both apps. The kitchen adds its own columns rather than
-- widening portal_role, so the portal's logic is untouched: kitchen access
-- exists only when kitchen_role is NOT NULL (and the profile is active).
-- Fail-closed: new accounts get no kitchen access until provisioned.
-- ============================================================

alter table public.profiles
  add column if not exists kitchen_role text
    check (kitchen_role in ('department', 'exec_chef', 'tech', 'super_admin')),
  add column if not exists kitchen_department_location_id bigint references locations(id);

comment on column public.profiles.kitchen_role is
  'Kitchen app access. NULL = no access. department needs kitchen_department_location_id; the other roles ignore it.';

-- A department account must say WHICH department.
alter table public.profiles drop constraint if exists kitchen_department_needs_location;
alter table public.profiles add constraint kitchen_department_needs_location
  check (kitchen_role is distinct from 'department' or kitchen_department_location_id is not null);

-- Bootstrap: the owner's existing portal account becomes kitchen super_admin.
update public.profiles set kitchen_role = 'super_admin', active = true
where email = 'pranjay@cremecastle.in';
