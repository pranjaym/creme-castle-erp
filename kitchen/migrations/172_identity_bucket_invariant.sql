-- ============================================================
-- Migration 172: the second half of the 171 correction (24 August 2026)
--
-- 171 restored the Tier C buckets that 170's step 4d had superseded directly
-- into an OMS identity, matching on the supersede_reason 170 wrote. That
-- missed a second route into the same wrong state, found by re-checking
-- contamination after 171's rebuild (it fell from 305 orders to 160, not to 0):
--
--   run 13, step 4c merged Tier C bucket X into Tier C canonical Y on a shared
--   clean POS phone, which is legitimate and stamped 'merged 140: ...'. Step 4d
--   then superseded Y into an OMS identity Z, which was the 170 defect. Step 4e
--   flattened the chain, so X now pointed straight at Z while still carrying the
--   140 reason. 171 matched on the 170 reason only, so X survived: 122 rows,
--   carrying the 49 remaining contaminated POS orders.
--
-- THE INVARIANT, stated once so it is never rediscovered the hard way:
--   A Tier C row is a name+outlet+area BUCKET, not a person. It must NEVER be
--   superseded into a person-anchored identity (oms_customer_id or
--   zomato_customer_id) by ANY route, including transitively through a chain
--   flatten. Bucket into bucket is fine. Bucket into person is always wrong,
--   because the bucket may hold several people's orders.
--
-- This migration restores those 122 rows. The legitimate bucket-to-bucket
-- merge among them re-forms on the next refresh (4c recomputes it from live
-- rows), so nothing is lost by clearing the stamp outright.
--
-- No function change is needed: 171 removed the only step that could put a
-- Tier C row under a person, so the chain can no longer form. The standing
-- check below belongs in any future identity review.
--
--   select count(*) from identity.customers l
--   join identity.customers w on w.id = l.superseded_by
--   where l.tier = 'C'
--     and (w.oms_customer_id is not null or w.zomato_customer_id is not null);
--   -- must always be 0
--
-- NOT contamination, for the record: after this fix, orders whose own phone
-- differs from their customer's phone remain on the 138 Zomato identities that
-- merged into an OMS customer. Those are one real person whose Zomato orders
-- carry Zomato's number rather than the number they gave us directly. The
-- identity level match was made on a real, clean, shared number; the per order
-- difference is expected and correct.
-- ============================================================

update identity.customers l
set superseded_by = null, superseded_at = null,
    supersede_reason = 'restored by 172: run 13 chain-flattening pointed this Tier C bucket at an OMS identity via a 140 dup merge. INVARIANT: a Tier C row is a name+outlet+area bucket, not a person, and must NEVER be superseded into a person-anchored identity by any route. The legitimate bucket-to-bucket merge re-forms on the next refresh.'
from identity.customers w
where w.id = l.superseded_by
  and l.tier = 'C'
  and w.oms_customer_id is not null;
