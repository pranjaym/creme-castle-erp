#!/usr/bin/env python3
"""Load the team's discount sheet ("Zomato And Swiggy Discounts.xlsx") into the
coupon module's upload register (coupons.upload + coupons.upload_cell, migration
232). One upload row per platform per sheet version; the previous upload for that
platform is superseded, never deleted.

The sheet layout (Pranjay, 19 Sep 2026): row 1 = a date label in A1 and the
column-group headings (New User Base Codes, New User Flat Off, ...), row 2 = the
per-column slot (LA/MM, UM, New User, Repeat User, ...), then one row per outlet
with the platform's restaurant id in column A, the outlet code in column B and
the construct in every other cell ("60% upto 120", "Flat 125 MOV 549").

Usage:
  python3 import_sheet.py --history --file "<path>.xlsx" [--by "name"] [--dry-run]   (month-stamped history workbook)
  python3 import_sheet.py --file "<path>.xlsx" [--zomato-sheet "Zomato Discount"] [--swiggy-sheet "Swiggy Discounts"] [--by "name"] [--dry-run]
"""
import argparse, json, os, re, sys
import openpyxl, psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))

def env_url():
    url = os.environ.get('SPINE_DATABASE_URL')
    if url: return url
    p = os.path.join(HERE, '..', '..', '.env.local')
    for line in open(p):
        m = re.match(r'^SPINE_DATABASE_URL=(.*)$', line.strip())
        if m: return m.group(1).strip('"').strip("'")
    sys.exit('SPINE_DATABASE_URL not set')

def read_sheet(ws):
    rows = list(ws.iter_rows(values_only=True))
    h1, h2 = rows[0], rows[1]
    label = str(h1[0]) if h1[0] is not None else 'unlabelled'
    if hasattr(h1[0], 'strftime'): label = h1[0].strftime('%d %b %Y')
    # carry each group heading right until the next one
    groups, cur = [], None
    for c in h1[2:]:
        if c not in (None, ''): cur = str(c).strip()
        groups.append(cur)
    slots = [str(c).strip() if c not in (None, '') else '' for c in h2[2:]]
    cells = []
    for r in rows[2:]:
        if r[1] in (None, ''): continue
        rid = str(r[0]).strip() if r[0] is not None else None
        outlet = str(r[1]).strip()
        for i, v in enumerate(r[2:len(slots) + 2]):
            if v in (None, ''): continue
            cells.append((outlet, rid, i + 1, groups[i], slots[i], str(v).strip()))
    return label, cells

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True)
    ap.add_argument('--zomato-sheet', default='Zomato Discount')
    ap.add_argument('--swiggy-sheet', default='Swiggy Discounts')
    ap.add_argument('--by', default='import_sheet.py')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    wb = openpyxl.load_workbook(a.file, data_only=True)
    plan = [('zomato', a.zomato_sheet), ('swiggy', a.swiggy_sheet)]
    cn = None if a.dry_run else psycopg2.connect(env_url(), connect_timeout=20, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    for platform, sheet in plan:
        if sheet not in wb.sheetnames:
            print(f'{platform}: sheet "{sheet}" not in workbook, skipped'); continue
        label, cells = read_sheet(wb[sheet])
        outlets = sorted(set(c[0] for c in cells))
        print(f'{platform}: "{label}", {len(outlets)} outlets, {len(cells)} cells')
        if a.dry_run:
            for c in cells[:6]: print('   ', c)
            continue
        cur = cn.cursor()
        # outlet codes that the outlet master does not know are kept as written and reported
        cur.execute('select internal_code from public.outlets')
        known = {r[0] for r in cur.fetchall()}
        unknown = [o for o in outlets if o not in known]
        if unknown: print(f'   not in public.outlets (kept as written): {unknown}')
        cur.execute("update coupons.upload set superseded_at = now() where platform = %s and superseded_at is null", (platform,))
        cur.execute("insert into coupons.upload (platform, label, source, uploaded_by, row_count) values (%s,%s,%s,%s,%s) returning id",
                    (platform, label, os.path.basename(a.file), a.by, len(outlets)))
        uid = cur.fetchone()[0]
        cur.executemany("insert into coupons.upload_cell (upload_id, outlet_code, platform_rid, col_no, slot_group, slot, construct, construct_norm) values (%s,%s,%s,%s,%s,%s,%s, coupons.norm_construct(%s))",
                        [(uid, o, rid, col, g, s, v, v) for (o, rid, col, g, s, v) in cells])
        cur.execute("insert into coupons.event (entity, entity_id, action, actor, data) values ('upload', %s, 'import', %s, %s::jsonb)",
                    (uid, a.by, '{"platform":"%s","label":"%s","cells":%d}' % (platform, label.replace('"', ''), len(cells))))
        cn.commit(); print(f'   upload id {uid} committed')
    if cn: cn.close()

if __name__ == '__main__' and '--history' not in sys.argv:
    main()


# ---------------------------------------------------------------------------
# History mode (28 Sep 2026): the month-stamped workbook ("Learnings&Improvements.xlsx",
# tabs "Zomato Discounts" and "Swiggy Discounts"): column A month, B year, C the
# platform's restaurant id, D the outlet name, then one column per slot under a
# single two-row header. Every (month, year) becomes one dated upload effective
# from the 1st of that month. Outlets are matched on the RESTAURANT ID, never the
# name (the sheet spells one outlet two ways). Re-loading a month supersedes only
# that month's earlier load; other months are untouched.
MONTHS = {m: i for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], 1)}

def read_history(ws):
    rows = list(ws.iter_rows(values_only=True))
    h1, h2 = rows[0], rows[1]
    groups, cur = [], None
    for c in h1[4:]:
        if c not in (None, ''): cur = str(c).strip()
        groups.append(cur)
    slots = [str(c).strip() if c not in (None, '') else '' for c in h2[4:]]
    width = max(i for i, s in enumerate(slots) if s) + 1
    versions = {}
    for r in rows[2:]:
        if r[0] not in MONTHS or r[1] in (None, '') or r[3] in (None, ''): continue
        key = (int(r[1]), MONTHS[r[0]])
        rid = str(r[2]).strip() if r[2] is not None else None
        for i, v in enumerate(r[4:4 + width]):
            if v in (None, ''): continue
            versions.setdefault(key, []).append((str(r[3]).strip(), rid, i + 1, groups[i], slots[i], str(v).strip()))
    return versions

def load_history(path, by, dry):
    wb = openpyxl.load_workbook(path, data_only=True)
    cn = None if dry else psycopg2.connect(env_url(), connect_timeout=20, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    cur = cn.cursor() if cn else None
    rid2code = {}
    if cur:
        cur.execute('select zomato_restaurant_id, internal_code from public.outlets where zomato_restaurant_id is not null')
        rid2code['zomato'] = {str(a): b for a, b in cur.fetchall()}
        cur.execute('select restaurant_id, code from core.v_swiggy_outlet_codes')
        rid2code['swiggy'] = {str(a): b for a, b in cur.fetchall()}
    for platform, sheet in (('zomato', 'Zomato Discounts'), ('swiggy', 'Swiggy Discounts')):
        if sheet not in wb.sheetnames:
            print(f'{platform}: no "{sheet}" tab, skipped'); continue
        versions = read_history(wb[sheet])
        for (y, m), cells in sorted(versions.items()):
            label = f"{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} {y}"
            eff = f'{y}-{m:02d}-01'
            outlets = sorted(set(c[0] for c in cells))
            if dry:
                print(f'{platform} {label}: {len(outlets)} outlets, {len(cells)} cells'); continue
            m_ = rid2code[platform]
            resolved = [(m_.get(rid, name), name, rid, col, g, s, v) for (name, rid, col, g, s, v) in cells]
            unmatched = sorted(set(name for (code, name, rid, *_ ) in resolved if rid not in m_))
            cur.execute("update coupons.upload set superseded_at = now() where platform = %s and effective_from = %s and superseded_at is null", (platform, eff))
            cur.execute("insert into coupons.upload (platform, label, effective_from, source, uploaded_by, row_count) values (%s,%s,%s,%s,%s,%s) returning id",
                        (platform, label, eff, os.path.basename(path), by, len(outlets)))
            uid = cur.fetchone()[0]
            cur.executemany("insert into coupons.upload_cell (upload_id, outlet_code, platform_rid, col_no, slot_group, slot, construct, construct_norm) values (%s,%s,%s,%s,%s,%s,%s, coupons.norm_construct(%s))",
                            [(uid, code, rid, col, g, s, v, v) for (code, name, rid, col, g, s, v) in resolved])
            cur.execute("insert into coupons.event (entity, entity_id, action, actor, data) values ('upload', %s, 'import', %s, %s::jsonb)",
                        (uid, by, json.dumps({'platform': platform, 'label': label, 'effective_from': eff, 'cells': len(cells), 'outlets': len(outlets), 'not_matched_by_id': unmatched})))
            cn.commit()
            print(f'{platform} {label}: upload {uid}, {len(outlets)} outlets, {len(cells)} cells' + (f', NOT matched by id (kept as written): {unmatched}' if unmatched else ''))
    if cn: cn.close()

if __name__ == '__main__' and '--history' in sys.argv:
    import json
    ap2 = argparse.ArgumentParser()
    ap2.add_argument('--history', action='store_true'); ap2.add_argument('--file', required=True)
    ap2.add_argument('--by', default='import_sheet.py --history'); ap2.add_argument('--dry-run', action='store_true')
    b = ap2.parse_args()
    load_history(b.file, b.by, b.dry_run)
