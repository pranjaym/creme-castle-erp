# Creme Castle — Daily Dashboard

Generates `cc_daily.html` from two data exports: Order Transaction (`.xlsx`) and Item Sales (`.xlsb`).

---

## One-time setup

You need Python 3.9+ and three packages. From this folder:

```bash
pip3 install -r requirements.txt
```

If `pip3` complains on macOS, try:

```bash
pip3 install --break-system-packages -r requirements.txt
```

That's it. No other setup.

---

## Daily run (the only thing you do every day)

1. **Drop the two latest files into the `uploads/` folder.**
   - Order Transaction Data → `.xlsx` (filename must contain "order" or "transaction")
   - Item Sales → `.xlsb` (any name)

   Old files can stay; the script automatically picks the most recently modified file of each type.

2. **Run the script.** From this folder:

   ```bash
   python3 cc_dashboard.py
   ```

3. **Open the output.**

   ```bash
   open cc_daily.html
   ```

   (Or just double-click `cc_daily.html` in Finder.)

Typical run time: 30–60 seconds. The script prints what it's doing and what date it picked as the focal day.

---

## What the script picks as "yesterday"

The most recent date in the Order Transaction file with at least 500 orders **and** matching items data. This is usually yesterday but will gracefully skip incomplete days.

The script prints this on every run, e.g.:

```
Focal date: 2026-05-16 (Saturday)
Comparison: 2026-05-09 (Saturday)
7-day baseline: 7 days
```

If the wrong date is picked, you have either incomplete data or stale files — check the upload timestamps.

---

## Folder structure

```
cc_dashboard/
├── README.md                      ← you are here
├── requirements.txt               ← Python dependencies
├── cc_dashboard.py                ← entry point — run this
│
├── loaders.py                     ← reads .xlsx + .xlsb, applies discount formula
├── metrics.py                     ← v1 metrics (outlet/category/sku/trend/hours/etc.)
├── metrics_v2.py                  ← v2 metrics (glance / city / discount / lux / cake-share)
├── briefings.py                   ← daily signal builder (incl. dark-outlet detection)
├── render.py                      ← main HTML renderer
├── render_v2.py                   ← v2 section renderers
├── experiments_config.py          ← Lux Cakes + Mango Seasonal SKU lists
├── discontinued_items.csv         ← items hidden from briefings
│
├── templates/
│   ├── style.css                  ← base styles
│   ├── style_v2.css               ← v2 layout (tabs, multi-range tables, heatmap, etc.)
│   ├── script.js                  ← base charts (Chart.js)
│   └── script_v2.js               ← v2 interactions (tabs, sortable, cake-share chart)
│
├── uploads/                       ← put data files here
│   └── README.txt
│
└── cc_daily.html                  ← generated output (overwritten each run)
```

---

## Editing the SKU configs

- **Lux Cakes** (Section 04) and **Mango Seasonal** (Section 04) SKU lists live in `experiments_config.py`. To add or remove an SKU from either group, edit the list there.
- **Discontinued items** (hidden from briefings & SKU movers, but counted in totals) live in `discontinued_items.csv`. One item name per row, header is `Item_Name`.

---

## Discount formula (canonical)

The script applies the discount formula confirmed in May 2026:

```
GMV       = My amount + Container Charges
Discount  = Outlet Discount         (Aggregator Discount is excluded)
Net Sales = GMV − Outlet Discount
Disc %    = Outlet Discount / GMV
AOV       = Net Sales / Orders
```

This is set in `loaders.py` and applied everywhere.

---

## Troubleshooting

**`FileNotFoundError: No orders file found in ...`**
The .xlsx in `uploads/` doesn't have "order" or "transaction" in its filename. Rename it, or check it's actually there.

**`FileNotFoundError: No items file found in ...`**
There's no .xlsb in `uploads/`. The item sales file from Petpooja is .xlsb — make sure you didn't accidentally save it as .xlsx.

**`ModuleNotFoundError: No module named 'pyxlsb'`**
Dependencies aren't installed. Run `pip3 install -r requirements.txt` first.

**The dashboard shows yesterday's data, not today's**
The script picks the latest *complete* day (≥500 orders + items present). If today's file was exported mid-day, it'll show yesterday. This is intended — incomplete days mislead.

**`Permission denied` opening cc_daily.html in browser**
Close any browser tab that has the old version open, then run the script again.

---

## What to share with the team

The dashboard is self-contained HTML — no server, no internet required after the Chart.js CDN loads.

- **AirDrop / share**: send `cc_daily.html`. Recipient just opens it.
- **Slack / WhatsApp**: attach `cc_daily.html`. Looks the same on phone.
- **Email**: same. It's a single ~360 KB file.
