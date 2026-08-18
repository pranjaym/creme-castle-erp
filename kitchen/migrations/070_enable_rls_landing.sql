-- 070: enable row level security on the 8 landing tables created without it.
-- Flagged by Supabase advisors 15 Aug 2026: with RLS off, the anon and
-- authenticated REST roles could read or modify these tables.
-- Safe with zero policies because nothing reads them through those roles:
--   portal reports use the service role key (bypasses RLS),
--   portal auth touches only public.profiles (already has RLS and policies),
--   workers connect as the table owner over the pooler (RLS does not apply).
-- Any future app reading these via the anon or authenticated role must add
-- an explicit policy first.

alter table landing.petpooja_sub_order_wise enable row level security;
alter table landing.petpooja_invoice_wise_sales enable row level security;
alter table landing.petpooja_daily_stock enable row level security;
alter table landing.spine_day_fingerprints enable row level security;
alter table landing.spine_row_changes enable row level security;
alter table landing.spine_daily_checks enable row level security;
alter table landing.zomato_order_details enable row level security;
alter table landing.zomato_change_log enable row level security;
