// Admin · Items: the item master, editable without a developer. Live switch,
// department, typical/day, par (effective-dated), display order, add item.
import ItemsClient from '../ItemsClient';
import { spine } from '@/lib/supabase/server';
import { requireRoles } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AdminItemsPage() {
  await requireRoles(['tech', 'super_admin']);
  const db = spine();

  const [{ data: depts }, { data: skus }, { data: freezer }] = await Promise.all([
    db.from('department_settings')
      .select('location_id, sort_order, locations(code, name)')
      .order('sort_order'),
    db.from('skus')
      .select('code, name, category, uom, typical_qty_per_day, sort_order, active, made_by_location_id')
      .eq('sku_type', 'intermediate').order('category').order('sort_order'),
    db.from('locations').select('id').eq('code', 'FREEZER-CK').single(),
  ]);

  // Latest effective par per item (at the freezer, where par lives).
  const { data: pars } = await db.from('par_stocks')
    .select('sku_id, par_qty, par_type, effective_from, created_at')
    .eq('location_id', freezer?.id ?? -1)
    .order('effective_from', { ascending: false }).order('created_at', { ascending: false });
  const latestPar = new Map<number, { qty: number | null; type: string }>();
  for (const p of pars ?? []) {
    if (!latestPar.has(p.sku_id)) latestPar.set(p.sku_id, { qty: p.par_qty != null ? Number(p.par_qty) : null, type: p.par_type });
  }
  const { data: skuIdRows } = await db.from('skus').select('id, code').eq('sku_type', 'intermediate');
  const idByCode = new Map((skuIdRows ?? []).map((s) => [s.code, s.id]));
  const deptCodeById = new Map((depts ?? []).map((d: any) => [d.location_id, d.locations.code]));

  const items = (skus ?? []).map((s) => {
    const par = latestPar.get(idByCode.get(s.code) ?? -1);
    return {
      code: s.code, name: s.name, category: s.category ?? '', uom: s.uom,
      typicalQty: s.typical_qty_per_day != null ? Number(s.typical_qty_per_day) : null,
      sortOrder: s.sort_order ?? 0, active: s.active,
      deptCode: deptCodeById.get(s.made_by_location_id) ?? '',
      parQty: par?.qty ?? null, parType: par?.type ?? 'fixed',
    };
  });
  const deptRows = (depts ?? []).map((d: any) => ({ code: d.locations.code, name: d.locations.name }));
  const live = items.filter((i) => i.active).length;

  return (
    <>
      <div className="adminhead">
        <span className="title">Items</span>
        <span className="blurb">the item master · live means the team sees it · nothing is ever deleted</span>
      </div>
      <div className="adminbody">
        <div className="statgrid">
          <div className="statcard"><div className="k">Items</div><div className="v">{items.length}</div><div className="s">{live} live · {items.length - live} off</div></div>
          {deptRows.map((d) => (
            <div className="statcard" key={d.code}>
              <div className="k">{d.name}</div>
              <div className="v">{items.filter((i) => i.deptCode === d.code && i.active).length}</div>
              <div className="s">live items</div>
            </div>
          ))}
        </div>
        <ItemsClient depts={deptRows} items={items} />
      </div>
    </>
  );
}
