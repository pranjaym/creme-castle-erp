-- 239: Bhagwan moves from Central to Operations Head (Pranjay, 26 Sep 2026: "he
-- is just a manager of area managers, he should not see all the other things
-- which Rishabh and Pawan see"). Applied only AFTER the portal code that knows
-- the 'operations' role is live, or he would see nothing in between.
with moved as (
  update public.profiles p set role = 'operations'
  where p.email = 'bhagwan@cremecastle.in' and p.role = 'central'
  returning p.email
)
insert into public.portal_admin_log (actor_id, actor_email, action, target, detail)
select o.id, o.email, 'user_updated', m.email,
       jsonb_build_object('role', 'operations', 'from_role', 'central',
                          'via', 'migration 239, role redraw decided by Pranjay 26 Sep 2026')
from moved m cross join (select id, email from public.profiles where email = 'pranjay@cremecastle.in') o;
