-- 237: a new account starts with NO portal access, never with 'viewer'.
-- Root cause found 26 Sep 2026 (F63): handle_new_auth_user (migration 040)
-- created every profile as 'viewer', and 'viewer' then saw everything central
-- saw. The portal's Users screen overwrote it on creation, but the kitchen
-- app's account screen sets only the kitchen role, so Md Asif, Sandeep and both
-- department tablets silently held full management read in the portal,
-- including the order downloads with customer name, phone and address.
-- 'viewer' is retired in the portal code the same day and opens nothing.
alter table public.profiles alter column role set default 'none';

create or replace function public.handle_new_auth_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, role, active)
  values (new.id, new.email, 'none', false)
  on conflict (id) do nothing;
  return new;
end $function$;
