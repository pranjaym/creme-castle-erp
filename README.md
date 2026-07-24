# Creme Castle ERP

The umbrella for Creme Castle's in-house ERP. One canonical database (the Supabase
"spine") is the single store; every app is a window onto it.

**New here? Read [HANDOFF.md](HANDOFF.md) first, then [`docs/`](docs/).**

## Layout
- `docs/` : planning and decisions (the shared source of truth).
- `kitchen/` : the spine module (Next.js + Supabase): schema migrations, the D2C
  reconciliation matcher, the intermediates logbook app, and the ingestion workers.
- `dashboard/` : the automated daily Zomato/Swiggy sales dashboard (scrape, enrich,
  build, email).
- (to build) the ERP portal app: team-facing window onto the spine.

OMS (`cremecastle-oms`) and the Dispatch Console (`cc-dispatch-console`) are separate
repos that read the same spine database.

## Ground rules
Schema is canonical, apps are disposable. No hard deletes. Verified data only. No em or
en dashes anywhere. Every decision written back into `docs/` the same day. Secrets never
committed (only `.env.example` templates are tracked).
