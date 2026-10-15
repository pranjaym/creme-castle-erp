-- 160: enable row level security on the 25 tables still flagged by the
-- Supabase advisors on 24 Aug 2026: the zomato business-report landing set
-- (created by 130), the core/identity/mart derived layers, and the Build 3a
-- kitchen tables plus schema_migrations.
-- Same reasoning as migration 070, re-verified 24 Aug 2026 against the code:
--   every app (portal, kitchen, dashboard) does all data access server-side
--   with the service role key (bypasses RLS); the anon key is used only for
--   auth, which touches public.profiles (already has RLS and policies);
--   workers and pg_cron run as the table owner (RLS does not apply).
-- Zero policies added on purpose: any future app reading these through the
-- anon or authenticated role must add an explicit policy first.

alter table landing.zomato_business_order enable row level security;
alter table landing.zomato_business_order_item enable row level security;
alter table landing.zomato_outlet_day_segment enable row level security;
alter table landing.zomato_outlet_day_ads_segment enable row level security;
alter table landing.zomato_outlet_day_quality enable row level security;
alter table landing.zomato_ad_campaign_day enable row level security;
alter table landing.zomato_outlet enable row level security;
alter table landing.zomato_recon_log enable row level security;
alter table landing.zomato_business_change_log enable row level security;

alter table core.orders enable row level security;
alter table core.order_items enable row level security;
alter table core.refresh_runs enable row level security;
alter table core.refresh_exceptions enable row level security;

alter table identity.customers enable row level security;
alter table identity.order_customer enable row level security;
alter table identity.refresh_runs enable row level security;

alter table mart.customer_summary enable row level security;
alter table mart.item_repeat_patterns enable row level security;

alter table public.schema_migrations enable row level security;
alter table public.department_settings enable row level security;
alter table public.transfer_receipts enable row level security;
alter table public.closing_counts enable row level security;
alter table public.dept_requests enable row level security;
alter table public.production_plans enable row level security;
alter table public.spine_modes enable row level security;
