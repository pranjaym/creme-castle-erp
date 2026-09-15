import json, collections, re
d = json.load(open('recipes_raw.json')); ING, SUB, FG = d['ingredients'], d['intermediates'], d['finished']
findings = []
# ---- ingredients ----
ing_out = {}
for c,i in ING.items():
    ing_out[c] = dict(code=c, name=i['name'], purchase_unit=i['purchase_unit'], purchase_price=i['purchase_price'],
        base_unit=i['base_unit'], base_per_purchase=((i['purchase_price']/i['price_per_base']) if (i['purchase_price'] and i['price_per_base']) else None), price_per_base=i['price_per_base'],
        cost_unit=i['cost_unit'])
# ---- intermediates: output qty implied by the sheet's own reference cost ----
sub_out = collections.OrderedDict()
for n,r in SUB.items():
    sh = r['sheet']; ref = r.get('unit_cost_pricelist')
    batch_sheet = sh.get('batch_cost')
    lines = [dict(ref=l['ref'], qty=l['qty'] or 0, unit=(l['unit'] or 'Grams')) for l in r['lines'] if l['qty']]
    input_qty = sum(l['qty'] for l in lines)
    ou = (r.get('out_unit_sheet') or 'Grams')
    out_unit = 'gram' if ou.lower() in ('grams','gram') else 'millilitre' if ou.lower() in ('ml','millilitre') else 'piece' if ou.lower() in ('pcs','pc','piece') else 'set'
    if ref and batch_sheet: output_qty = batch_sheet/ref
    else:
        output_qty = input_qty; findings.append(('no reference cost', n))
    if sh.get('portions'): output_qty = sh['portions']
    sub_out[n] = dict(code=n, name=n, kind='intermediate', status=r['status'], lines=lines, input_qty=input_qty,
        output_qty=output_qty, output_unit=out_unit, unit_cost_sheet=ref, batch_cost_sheet=batch_sheet,
        yield_sheet=sh.get('yield'))
    if r.get('duplicate_blocks'):
        findings.append(('recipe name appears in more than one block; the price list silently uses the first', n))
# ---- finished goods ----
fg_out = collections.OrderedDict()
for n,r in FG.items():
    sh = r['sheet']; sm = r.get('summary') or {}
    lines = [dict(ref=l['ref'], qty=l['qty'] or 0, unit=(l['unit'] or 'Grams')) for l in r['lines'] if l['qty']]
    pack = [dict(ref=l['ref'], qty=l['qty'] or 0, unit=(l['unit'] or 'each')) for l in r['packaging'] if l['qty']]
    input_qty = sum(l['qty'] for l in lines)
    batch_sheet = sh.get('batch_cost')
    ref = sm.get('cost')
    if ref is None: ref = sh.get('pricing_per_unit') or sh.get('unit_cost')
    units_per_batch = (batch_sheet/ref) if (ref and batch_sheet) else 1
    if abs(units_per_batch-round(units_per_batch))<0.02: units_per_batch = round(units_per_batch)
    m = re.match(r'\s*([0-9.]+)\s*(gram|grams|gm|kg)', (sh.get('sold_size') or ''), re.I)
    sold_g = float(m.group(1))*(1000 if m.group(2).lower()=='kg' else 1) if m else None
    price = sh.get('selling_price') or sm.get('price')
    pc = sh.get('packaging_charge') if sh.get('packaging_charge') is not None else sm.get('pc')
    fg_out[n] = dict(code=n, name=n, kind=r['kind'], status=r['status'], verified=r['verified'], lines=lines, packaging=pack,
        input_qty=input_qty, units_per_batch=units_per_batch, sold_weight_g=sold_g, selling_price=price, packaging_charge=pc,
        recipe_date=sm.get('recipe_date'), unit_cost_sheet=ref, batch_cost_sheet=batch_sheet,
        pack_box=sm.get('box'), pack_base=sm.get('base'), pack_sleeve=sm.get('sleeve'), pack_bag=sm.get('carry_bag'),
        fc_with_pack_sheet=sh.get('fc_with_pack'), fc_without_pack_sheet=sh.get('fc_without_pack'))
# ---- engine ----
cache={}; stack=[]
def uc(ref):
    if ref in ing_out: return ing_out[ref]['price_per_base'] or 0.0
    if ref in cache: return cache[ref]
    if ref in stack: raise RuntimeError(' > '.join(stack+[ref]))
    stack.append(ref); r = sub_out[ref]
    batch = sum(l['qty']*uc(l['ref']) for l in r['lines'])
    v = batch/r['output_qty'] if r['output_qty'] else 0
    stack.pop(); cache[ref]=v; return v
ok=0; bad=[]
for n,r in sub_out.items():
    v = uc(n); r['unit_cost'] = v; r['batch_cost'] = v*r['output_qty']
    if r['unit_cost_sheet'] is None: continue
    if abs(v-r['unit_cost_sheet'])>1e-6*max(1,r['unit_cost_sheet']): bad.append((n, round(r['unit_cost_sheet'],4), round(v,4)))
    else: ok+=1
print('INTERMEDIATE parity', ok, 'mismatch', len(bad)); [print('  ',b) for b in bad]
fok=0; fbad=[]
for n,r in fg_out.items():
    batch = sum(l['qty']*uc(l['ref']) for l in r['lines']); r['batch_cost']=batch
    r['unit_cost'] = batch/r['units_per_batch']; r['packaging_cost'] = sum(l['qty']*uc(l['ref']) for l in r['packaging'])
    if r['unit_cost_sheet'] and abs(r['unit_cost']-r['unit_cost_sheet'])>1e-6*max(1,r['unit_cost_sheet']): fbad.append((n, round(r['unit_cost_sheet'],3), round(r['unit_cost'],3), r['units_per_batch']))
    else: fok+=1
print('FINISHED parity', fok, 'mismatch', len(fbad)); [print('  ',b) for b in fbad]
print('units_per_batch dist', collections.Counter(r['units_per_batch'] for r in fg_out.values()).most_common(12))
print('FINDINGS', len(findings)); [print('  ',f) for f in findings[:20]]
# where used
used = collections.defaultdict(list)
for r in list(sub_out.values())+list(fg_out.values()):
    for l in r['lines']+r.get('packaging',[]): used[l['ref']].append(r['code'])
for c,i in ing_out.items(): i['used_in']=len(set(used[c]))
for c,i in sub_out.items(): i['used_in']=len(set(used[c]))
model = dict(ingredients=ing_out, intermediates=sub_out, finished=fg_out, source=d['source'], findings=findings)
json.dump(model, open('model.json','w'), default=str)
import os; print('model.json bytes', os.path.getsize('model.json'))
