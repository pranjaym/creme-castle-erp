-- 238: the four kitchen accounts leave 'viewer' for 'none' (Pranjay, 26 Sep
-- 2026: the production module is for Azeem, Asif and Sandeep; the tablets are
-- pinned to their own department). Their kitchen app roles are untouched:
-- Md Asif and Sandeep stay exec_chef (Production Chef), the tablets stay
-- department (Department Tablet). Each move is written to portal_admin_log the
-- same way the Users screen writes it, acting for the owner who decided it.
with moved as (
  update public.profiles p set role = 'none'
  where p.email in ('md.asif@cremecastle.in', 'sandeep@cremecastle.in',
                    'liquid.dept@cremecastle.in', 'sponge.dept@cremecastle.in')
    and p.role = 'viewer'
  returning p.email, p.kitchen_role
)
insert into public.portal_admin_log (actor_id, actor_email, action, target, detail)
select o.id, o.email, 'user_updated', m.email,
       jsonb_build_object('role', 'none', 'from_role', 'viewer', 'kitchen_role', m.kitchen_role,
                          'via', 'migration 238, role redraw decided by Pranjay 26 Sep 2026')
from moved m cross join (select id, email from public.profiles where email = 'pranjay@cremecastle.in') o;
