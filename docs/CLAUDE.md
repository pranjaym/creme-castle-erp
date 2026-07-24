# Creme Castle ERP: working agreement

This folder (`erp-plan/`) holds the authoritative planning for Creme Castle's internal systems as they grow toward an ERP. Read it before doing anything.

## The planning documents are authoritative

Start here, in this order:
1. `Doc for ERP - Fundraising.pdf`: business context (company, network, constraints).
2. `kitchen-production-brief.md`: the kitchen module, current-state reality, scope.
3. `cc-flow-map-v2.mermaid` and `simple-flow.mermaid`: the material and software flow.
4. `build-order.md`: the agreed build sequence.
5. `petpooja-admin-checklist.md`: fact-finding whose answers are still pending.
6. `integration-notes.md`: the verification of every integration assumption against the real code, with a flag register of what is unresolved.

Supporting system descriptions: `OMS_SYSTEM_OVERVIEW.md`, `SYSTEM_OVERVIEW_for_chat.md` (the Dispatch Console).

## Precedence

`build-order.md` carries precedence. Where it conflicts with the brief, the build order wins. Where `integration-notes.md` conflicts with either, the planning docs win and the note is to be corrected. Where a document conflicts with the live code, the code is the fact and the document gets a write-back.

## The canonical rules of this project

1. **The database schema is canonical; apps are disposable.** The masters, movements, production runs, recipes, and history are the asset. A future ERP (Microsoft or SAP class) inherits the model and its history as requirements plus migration data. Design every table as if it will outlive every app.
2. **The Dispatch Console's model is never modified.** Everything under `cc-dispatch-console/model` and `/model_dashboard` is verbatim and read-only. We change only how its input feed is produced, and we prove parity byte for byte. See `SYSTEM_OVERVIEW_for_chat.md`.
3. **Decisions made in build sessions are written back into these documents the same day.** A decision that is not in `erp-plan/` did not happen. Update the relevant doc, note it in `integration-notes.md` section 6 if it corrects a verified fact, and update the memory index.
4. **Every number reproducible. AI is never load-bearing in any calculation.** Assistive pre-fill is allowed with a visible verify step; the flow proceeds on AI timeout; every AI worker has an off switch with zero business impact.
5. **Verified data only; estimates are labelled.** Standard cost first, actual cost only when the underlying logging has earned trust.
6. **No hard deletes, ever.** Cancel or void or supersede with a reason; rows never disappear. Append-only audit on every mutation.
7. **No em dashes or en dashes in any output**, code comments included. Use commas, colons, parentheses, or "to" for ranges.
8. **Do not build until asked.** The current phase is verification and setup. Build plans are proposed only after `integration-notes.md` is reviewed, and then only the two agreed first builds (Build 1a and Build 3a).

## Repo state (as of 22 July 2026)

The OMS (`../cremecastle-oms`) and the Dispatch Console (`../cc-dispatch-console`) are separate git repositories with separate Supabase projects. This `erp-plan/` folder is not yet a git repository.

**Supabase topology, decided 22 July 2026: spine-first, three projects.** OMS and the console keep their existing live Supabase projects untouched; the kitchen module gets a new third "spine" project that is the canonical data layer and the shared database the autofeed reads. Build 1 schema work targets that new spine project.

Code consolidation into a monorepo is proposed in `integration-notes.md` section 1 and still awaits go-ahead. On consolidation, this `CLAUDE.md` moves to the monorepo root and `erp-plan/` sits beneath it.
