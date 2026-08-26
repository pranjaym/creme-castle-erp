# Dashboard template generators

These build the approval templates in `erp-plan/*.html` from live spine data.
They are kept here, not in a session scratchpad, because the mail renderer
(`../render.py`) has to be rebuilt to the same locked designs and this is the
reference implementation of each one.

- `gen_central.py` builds `erp-plan/central-dashboard-template-v1.html` (the
  network page, 26 Aug 2026). It reads two JSON payloads dumped from the spine:
  `central_15aug.json` from `dash_central_detail('2026-08-15')` and
  `all_15aug.json` from `dash_all('2026-08-15')`, plus `area.css`, the CSS the
  approved area template v2 uses, with the verdict chip and chart grid rules
  added.
- `area.css` is that shared stylesheet. Keep the store, area and central
  templates on one stylesheet: the three pages are meant to look like one
  product.

To regenerate: dump the two payloads next to the script, then run it.
