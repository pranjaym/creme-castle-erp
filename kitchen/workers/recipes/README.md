# Recipe module: workbook import (Step A)

Design and decisions: `erp-plan/recipe-costing-module-plan.md`. Schema: `kitchen/migrations/226_recipes_module.sql`.

## What is here

| File | Purpose |
|---|---|
| `workbook_extract.py` | Reads Narendra's costing workbook (the `Ingredients`, `NP Sub Mesa Recipe`, `NP Active Cake Recipe`, `NP Active Pastry Recipe` sheets) into `recipes_raw.json`. Handles the workbook's five ways of writing "what the batch makes" and keeps a second block under the same name aside instead of merging it. |
| `workbook_normalise.py` | Turns `recipes_raw.json` into `model.json`: one rule per recipe (batch cost ÷ declared output), pack size per ingredient, where-used counts, and a parity check of every cost against the workbook's own figures. |
| `import_workbook.py` | First load of `model.json` into the spine (skus, aliases, conversions, rates, recipes, version 1 of each, lines, prices, an import cost snapshot, one audit event). Refuses to run if `recipes.recipe` already has rows. |
| `sn_products.json` | SupplyNote products master as pulled on 15 Sep 2026 (`GET /v2/data/products`, 1,370 rows), used to key ingredients by SupplyNote `sku_code`. |
| `model.json` | The 17 Aug 2026 workbook, normalised. |

## Run

```bash
python3 workbook_extract.py "/path/to/NP - Active Items Recipe Sheet.xlsx"
python3 workbook_normalise.py
python3 import_workbook.py --as-of 2026-08-17 --dry-run   # prints the parity report, rolls back
python3 import_workbook.py --as-of 2026-08-17             # commits
```

Connection: `SPINE_DATABASE_URL` from `kitchen/.env.local` (the pooler host, keepalives on, statement timeout set).

## Bulk upload (next, on top of this)

Pranjay (15 Sep 2026) wants corrected recipes from the chef and the controls team to arrive as files. The plan: the same three steps, but `import_workbook.py` grows a `--as-new-versions` mode that, for every recipe in the file whose lines or output differ from the live version, creates version N+1 in state `draft` (or `checked`, when the file comes from Narendra) with the file name as the source, and leaves the live version untouched until approval. Not written yet.
