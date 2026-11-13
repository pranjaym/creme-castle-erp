-- 257: standalone store audit inside the Area Manager app (applied 13 Nov 2026 on
-- Pranjay's yes). Additive only. A store audit is an
-- am.visit of one of three audit kinds:
--   am_audit    = Area Manager monthly audit (scores the AM audit line)
--   qa_audit    = QA surprise audit (scores the QA audit line; already allowed by 256)
--   other_audit = any other visit with the checklist (recorded, no points)
-- am_visit keeps its meaning (the full AM visit; its audit also counts as the
-- AM audit). A failed item carries who fixes it and by when. Voids record who
-- voided; nothing is deleted. Record: store-scorecard-plan.md section 33.
alter table am.visit drop constraint if exists visit_kind_check;
alter table am.visit add constraint visit_kind_check
  check (kind in ('am_visit','am_audit','qa_audit','other_audit'));
alter table am.visit add column if not exists voided_by uuid;
alter table am.audit_answer add column if not exists fix_owner text;
alter table am.audit_answer add column if not exists fix_due date;
