#!/usr/bin/env python3
"""Step A of the recipe module: load a recipe workbook into the spine.

Reads model.json (produced by workbook_extract.py + workbook_normalise.py from
Narendra's costing workbook) and the SupplyNote products master
(sn_products.json, pulled from GET /v2/data/products), and writes:

  public.skus / sku_aliases / uom_conversions   one row per purchased ingredient
  recipes.ingredient_rate                       the workbook price list, source workbook_baseline
  recipes.recipe / recipe_alias                 one identity per recipe (+ workbook and item_glossary names)
  recipes.recipe_version / recipe_line          version 1 of every recipe, state approved
  recipes.channel_price                         the Zomato/Swiggy price and packaging charge
  recipes.cost_snapshot (kind import)           the cost the database computes on load
  recipes.event                                 one audit row for the run

Exit criterion (plan, Step A): the database's own cost function reproduces the
workbook's costs to the paisa for every recipe the workbook itself is consistent
on, and lists the rest.

Usage:
  python3 import_workbook.py --model model.json --products sn_products.json --as-of 2026-08-17 [--dry-run]

First load only: refuses to run if recipes.recipe already has rows. Later
corrections from the chef come in as NEW VERSIONS through the bulk-upload
path (to be written on top of this, same file shape), never by re-running this.

Connection rules (F22/F47): pooler URL from kitchen/.env.local, keepalives on,
statement_timeout set, IPv4 preferred. Runs in one transaction.
"""
import argparse, json, os, re, sys, datetime, decimal
import psycopg2, psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
KITCHEN = os.path.abspath(os.path.join(HERE, '..', '..'))


def env_url():
    env = dict(re.findall(r'^([A-Z_]+)=(.*)$', open(os.path.join(KITCHEN, '.env.local')).read(), re.M))
    return env['SPINE_DATABASE_URL'].strip().strip('"').strip("'")


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


UNIT_MAP = {'grams': 'gram', 'gram': 'gram', 'gm': 'gram', 'g': 'gram',
            'ml': 'millilitre', 'millilitre': 'millilitre', 'litre': 'millilitre',
            'pcs': 'piece', 'pc': 'piece', 'piece': 'piece', 'each': 'piece', 'set': 'set'}
STATUS_MAP = {'active': 'active', 'inactive': 'inactive', 'upcoming': 'upcoming'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=os.path.join(HERE, 'model.json'))
    ap.add_argument('--products', default=os.path.join(HERE, 'sn_products.json'))
    ap.add_argument('--as-of', default='2026-08-17', help='date the workbook prices and recipes are taken as of')
    ap.add_argument('--actor', default='workbook import')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    as_of = datetime.date.fromisoformat(a.as_of)

    M = json.load(open(a.model))
    ING, SUB, FG = M['ingredients'], M['intermediates'], M['finished']
    products = json.load(open(a.products)) if os.path.exists(a.products) else []
    by_code = {}
    by_name = {}
    for p in products:
        if p.get('sku_code'):
            by_code.setdefault(str(p['sku_code']).strip().upper(), p)
        by_name.setdefault(norm(p.get('product_title')), p)

    conn = psycopg2.connect(env_url(), connect_timeout=20, keepalives=1, keepalives_idle=30,
                            keepalives_interval=10, keepalives_count=5,
                            options='-c statement_timeout=110000')
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    cur.execute('select count(*) from recipes.recipe')
    if cur.fetchone()[0]:
        print('recipes.recipe is not empty; this importer is for the first load only. Nothing done.')
        sys.exit(2)
    cur.execute("select item_name from item_glossary")
    glossary = {norm(r['item_name']): r['item_name'] for r in cur.fetchall()}

    report = {'ingredients': 0, 'ingredients_sn_matched': 0, 'ingredients_sn_inactive': 0, 'ingredients_unmatched': [],
              'intermediates': 0, 'finished': 0, 'lines': 0, 'glossary_links': 0}

    # ---------- 1. purchased ingredients -> skus, aliases, conversions, rates ----------
    sku_id_of = {}
    for code, i in ING.items():
        p = by_code.get(code.strip().upper()) or by_name.get(norm(i['name']))
        matched = p is not None
        name = (p['product_title'] if matched else i['name']).strip()
        category = (p.get('category') if matched else None)
        sku_type = 'packaging' if (category and 'pack' in category.lower()) or code[:2] in ('BB', 'CB') else 'raw_material'
        notes = 'workbook import ' + a.as_of + '; workbook name: ' + i['name'] + ('' if matched else '; NOT in SupplyNote products master')
        if matched and not p.get('is_active', True):
            notes += '; inactive in SupplyNote'
            report['ingredients_sn_inactive'] += 1
        cur.execute("select id from skus where code = %s", (code,))
        row = cur.fetchone()
        if row:
            sku_id = row['id']
        else:
            cur.execute("""insert into skus (code, name, sku_type, category, category_canonical, uom, base_unit, active, notes)
                           values (%s, %s, %s::sku_type, %s, %s, %s, %s::base_unit, %s, %s) returning id""",
                        (code, name, sku_type, category, category, i.get('purchase_unit') or 'unit', i['base_unit'],
                         bool(i.get('used_in')), notes))
            sku_id = cur.fetchone()['id']
        sku_id_of[code] = sku_id
        report['ingredients'] += 1
        if matched:
            report['ingredients_sn_matched'] += 1
            cur.execute("""insert into sku_aliases (sku_id, system, external_code, external_name, note)
                           values (%s, 'supplynote', %s, %s, %s) on conflict do nothing""",
                        (sku_id, p.get('sku_code') or None, p['product_title'], 'product_id ' + str(p.get('product_id'))))
        else:
            report['ingredients_unmatched'].append((code, i['name'], i.get('used_in', 0)))
        if i.get('base_per_purchase') and i.get('purchase_unit'):
            cur.execute("""insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by, note)
                           values (%s, %s, %s, true, %s, %s, %s)""",
                        (sku_id, i['purchase_unit'], round(i['base_per_purchase'], 6), as_of, a.actor,
                         'derived from the workbook: purchase price / rate per base unit (includes usable yield where the sheet applied one)'))
        if i.get('price_per_base') is not None:
            cur.execute("""insert into recipes.ingredient_rate (sku_id, rate_per_base, base_unit, purchase_unit, purchase_price, pack_base_units, source, as_of, set_by, note)
                           values (%s, %s, %s::base_unit, %s, %s, %s, 'workbook_baseline', %s, %s, %s)""",
                        (sku_id, i['price_per_base'], i['base_unit'], i.get('purchase_unit'), i.get('purchase_price'),
                         i.get('base_per_purchase'), as_of, a.actor, 'Ingredients sheet, column G (rate per gram/ml/piece)'))

    # ---------- 2. recipe identities ----------
    recipe_id_of = {}

    def add_recipe(code, name, kind, book, status):
        cur.execute("""insert into recipes.recipe (code, name, kind, book, status, created_by, note)
                       values (%s, %s, %s, %s, %s, %s, %s) returning id""",
                    (code, name.strip(), kind, book, STATUS_MAP.get((status or '').lower(), 'active'), a.actor,
                     'workbook import ' + a.as_of))
        rid = cur.fetchone()['id']
        cur.execute("insert into recipes.recipe_alias (recipe_id, system, external_name, note) values (%s, 'workbook', %s, %s) on conflict do nothing",
                    (rid, name.strip(), 'block name in the workbook'))
        return rid

    for n, (name, r) in enumerate(SUB.items(), 1):
        recipe_id_of[name] = add_recipe('SEMI-%04d' % n, name, 'intermediate', 'sub_mesa', r['status'])
        report['intermediates'] += 1
    for n, (name, r) in enumerate(FG.items(), 1):
        rid = add_recipe('FG-%04d' % n, name, 'finished', r['kind'], r['status'])
        recipe_id_of[name] = rid
        report['finished'] += 1
        g = glossary.get(norm(name))
        if g:
            cur.execute("insert into recipes.recipe_alias (recipe_id, system, external_name, note) values (%s, 'item_glossary', %s, %s) on conflict do nothing",
                        (rid, g, 'matched by name on import'))
            report['glossary_links'] += 1

    # ---------- 3. version 1 + lines ----------
    def line_unit(l, ref_is_recipe, ref_name):
        u = UNIT_MAP.get((l.get('unit') or '').strip().lower(), None)
        if u is None:
            u = 'gram'
        if u == 'piece' and ref_is_recipe and SUB.get(ref_name, {}).get('output_unit') == 'set':
            u = 'set'
        return u

    def add_version(name, r, output_qty, output_unit, sold_weight_g, verified, recipe_date):
        rid = recipe_id_of[name]
        note = ('workbook recipe date ' + str(recipe_date)) if recipe_date else None
        cur.execute("""insert into recipes.recipe_version
                       (recipe_id, version_no, state, output_qty, output_unit, sold_weight_g, drafted_by, drafted_at,
                        checked_by, checked_at, approved_by, approved_at, effective_from, source, chef_note, checker_note)
                       values (%s, 1, 'approved', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'workbook import', %s, %s) returning id""",
                    (rid, round(output_qty, 4), output_unit, sold_weight_g, a.actor, as_of,
                     ('workbook Verified column' if verified else None), (as_of if verified else None),
                     a.actor + ' (baseline, unverified: rule 5)', as_of, as_of, note,
                     ('marked Verified in the workbook' if verified else None)))
        vid = cur.fetchone()['id']
        ln = 0
        for role, lines in (('material', r['lines']), ('packaging', r.get('packaging', []))):
            for l in lines:
                ref = l['ref']
                ln += 1
                if ref in ING:
                    cur.execute("""insert into recipes.recipe_line (version_id, line_no, role, ingredient_sku_id, qty, unit)
                                   values (%s, %s, %s, %s, %s, %s)""", (vid, ln, role, sku_id_of[ref], l['qty'], line_unit(l, False, ref)))
                else:
                    cur.execute("""insert into recipes.recipe_line (version_id, line_no, role, sub_recipe_id, qty, unit)
                                   values (%s, %s, %s, %s, %s, %s)""", (vid, ln, role, recipe_id_of[ref], l['qty'], line_unit(l, True, ref)))
                report['lines'] += 1
        return vid

    vid_of = {}
    for name, r in SUB.items():
        vid_of[name] = add_version(name, r, r['output_qty'], r['output_unit'], None, False, None)
    for name, r in FG.items():
        vid_of[name] = add_version(name, r, r['units_per_batch'] or 1, 'piece', r.get('sold_weight_g'), r.get('verified'), r.get('recipe_date'))
        if r.get('selling_price') or r.get('packaging_charge'):
            cur.execute("""insert into recipes.channel_price (recipe_id, channel, selling_price, packaging_charge, effective_from, set_by, note)
                           values (%s, 'aggregator', %s, %s, %s, %s, 'workbook: Selling Price and Packaging Charge rows (Zomato = Swiggy, Pranjay 15 Sep 2026)')""",
                        (recipe_id_of[name], r.get('selling_price'), r.get('packaging_charge'), as_of, a.actor))

    # ---------- 4. the database costs everything; compare with the workbook ----------
    ok = 0
    diffs = []
    for name, r in list(SUB.items()) + list(FG.items()):
        cur.execute("select * from recipes.cost_of_recipe(%s)", (recipe_id_of[name],))
        c = cur.fetchone()
        unit = float(c['unit_cost']) if c and c['unit_cost'] is not None else None
        cur.execute("""insert into recipes.cost_snapshot (version_id, snapshot_kind, as_of, batch_cost, unit_cost, packaging_cost, missing_rates)
                       values (%s, 'import', %s, %s, %s, %s, %s)""",
                    (vid_of[name], as_of, c['batch_cost'] if c else None, c['unit_cost'] if c else None,
                     c['packaging_cost'] if c else None, c['missing_rates'] if c else 0))
        sheet = r.get('unit_cost_sheet')
        if sheet is None or unit is None:
            continue
        if abs(unit - sheet) <= 1e-6 * max(1.0, abs(sheet)):
            ok += 1
        else:
            diffs.append((name, round(sheet, 4), round(unit, 4)))

    cur.execute("insert into recipes.event (entity, action, actor, data) values ('import', 'workbook loaded', %s, %s)",
                (a.actor, json.dumps({'as_of': a.as_of, 'model': os.path.basename(a.model), 'report': {k: v for k, v in report.items() if k != 'ingredients_unmatched'},
                                      'unmatched_ingredients': len(report['ingredients_unmatched']), 'parity_ok': ok, 'parity_diff': diffs}, default=str)))

    print('ingredients %d (SupplyNote matched %d, of which inactive in SupplyNote %d; unmatched %d)' %
          (report['ingredients'], report['ingredients_sn_matched'], report['ingredients_sn_inactive'], len(report['ingredients_unmatched'])))
    print('recipes: %d semi-finished, %d finished, %d lines, %d glossary links' % (report['intermediates'], report['finished'], report['lines'], report['glossary_links']))
    print('parity with the workbook: %d reproduced to the paisa, %d differ:' % (ok, len(diffs)))
    for d in diffs:
        print('   ', d)
    if a.dry_run:
        conn.rollback()
        print('DRY RUN: rolled back, nothing written.')
    else:
        conn.commit()
        print('COMMITTED.')


if __name__ == '__main__':
    main()
