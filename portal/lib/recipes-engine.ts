// The costing rule, in the browser. Same arithmetic as recipes.cost_of_recipe in
// the database (migrations 226/229): unit cost = sum(line qty x rate) / output.
// Used by the editor (cost as you type) and the price-impact screen (what-ifs),
// where a round trip per keystroke would be wrong. The database is the record;
// this is a mirror of its rule, nothing more.

export interface EngineIngredient { id: number; code: string; name: string; base_unit: string; rate: number | null }
export interface EngineLine { role: 'material' | 'packaging'; ingredient_sku_id: number | null; sub_recipe_id: number | null; qty: number; unit: string }
export interface EngineRecipe { id: number; code: string; name: string; kind: 'intermediate' | 'finished'; output_qty: number; output_unit: string; lines: EngineLine[] }
export interface EngineModel { ingredients: Record<number, EngineIngredient>; recipes: Record<number, EngineRecipe> }
export interface Cost { batch: number; unit: number; packaging: number; missing: number }

export function makeEngine(model: EngineModel, rateOverrides: Record<number, number> = {}) {
  const memo = new Map<number, Cost>();
  const stack: number[] = [];
  const rate = (skuId: number): number | null => {
    if (rateOverrides[skuId] != null) return rateOverrides[skuId];
    const i = model.ingredients[skuId];
    return i && i.rate != null ? i.rate : null;
  };
  function costLines(lines: EngineLine[], outputQty: number, depth = 0): Cost {
    let batch = 0, packaging = 0, missing = 0;
    for (const l of lines) {
      let r: number | null = null;
      if (l.ingredient_sku_id != null) r = rate(l.ingredient_sku_id);
      else if (l.sub_recipe_id != null) { const c = costRecipe(l.sub_recipe_id, depth + 1); if (c) { r = c.unit; missing += c.missing; } }
      if (r == null) { missing += 1; r = 0; }
      if (l.role === 'packaging') packaging += l.qty * r; else batch += l.qty * r;
    }
    return { batch, unit: outputQty > 0 ? batch / outputQty : 0, packaging, missing };
  }
  function costRecipe(id: number, depth = 0): Cost | null {
    if (memo.has(id)) return memo.get(id)!;
    const r = model.recipes[id];
    if (!r || depth > 12 || stack.includes(id)) return null;
    stack.push(id);
    const c = costLines(r.lines, r.output_qty, depth);
    stack.pop();
    memo.set(id, c);
    return c;
  }
  return { costRecipe, costLines, rate };
}

// Every finished good that contains a given ingredient or recipe, through any chain.
export function reach(model: EngineModel, key: { sku?: number; recipe?: number }): number[] {
  const usedBy = new Map<string, number[]>();
  for (const r of Object.values(model.recipes)) {
    for (const l of r.lines) {
      const k = l.ingredient_sku_id != null ? 'i' + l.ingredient_sku_id : 'r' + l.sub_recipe_id;
      const arr = usedBy.get(k) ?? []; arr.push(r.id); usedBy.set(k, arr);
    }
  }
  const out = new Set<number>(); const seen = new Set<number>();
  const walk = (k: string) => {
    for (const rid of usedBy.get(k) ?? []) {
      if (seen.has(rid)) continue; seen.add(rid);
      const r = model.recipes[rid];
      if (r.kind === 'finished') out.add(rid); else walk('r' + rid);
    }
  };
  walk(key.sku != null ? 'i' + key.sku : 'r' + key.recipe);
  return [...out];
}

export const inr = (v: number | null | undefined, d = 2): string =>
  v == null || Number.isNaN(v) ? 'n/a' : '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number | null | undefined, d = 1): string =>
  v == null || Number.isNaN(v) ? 'n/a' : (v * 100).toFixed(d) + '%';
export const unitShort = (u: string): string => ({ gram: 'g', millilitre: 'ml', piece: 'pc', set: 'set' } as Record<string, string>)[u] ?? u;
// A rate the way a buyer reads it: per kg, per litre, per piece.
export function rateLabel(ratePerBase: number | null | undefined, baseUnit: string): string {
  if (ratePerBase == null) return 'no rate';
  if (baseUnit === 'gram') return inr(ratePerBase * 1000) + '/kg';
  if (baseUnit === 'millilitre') return inr(ratePerBase * 1000) + '/L';
  return inr(ratePerBase) + (baseUnit === 'set' ? '/set' : '/pc');
}
export const perLabel = (baseUnit: string): string => baseUnit === 'gram' ? 'per kg' : baseUnit === 'millilitre' ? 'per litre' : baseUnit === 'set' ? 'per set' : 'per piece';
export const toBase = (display: number, baseUnit: string): number => (baseUnit === 'gram' || baseUnit === 'millilitre') ? display / 1000 : display;
export const fromBase = (ratePerBase: number, baseUnit: string): number => (baseUnit === 'gram' || baseUnit === 'millilitre') ? ratePerBase * 1000 : ratePerBase;
