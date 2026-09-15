// The bulk-upload file. One row per recipe line, the recipe's output repeated on
// its rows (only the first row of a recipe is read for it). Columns, by header
// name, any order:
//   recipe          name of the recipe (an existing name matches its live recipe; a new name creates one)
//   kind            semi-finished | finished   (only needed for a new recipe)
//   line            ingredient | recipe | packaging   (what the ref column names)
//   ref             SupplyNote code (e.g. CC00043) or the ingredient's name, or a recipe's name or code
//   qty             quantity of that line, in unit
//   unit            g | ml | pc | set
//   makes_qty       what one batch makes (repeat on every row of the recipe)
//   makes_unit      g | ml | pc | set   (for a finished good: pc = sold units)
//   sold_weight_g   optional, finished goods only
//   book            optional: cake | pastry | sub_mesa
// The template download (/recipes/download?what=template) writes the live book in
// exactly this shape, so the chef edits in Excel and sends it back.
export interface PickLists {
  ingredients: { id: number; code: string; name: string; base_unit: string }[];
  recipes: { id: number; code: string; name: string; kind: 'intermediate' | 'finished'; output_unit: string }[];
}
export interface ParsedLine { role: 'material' | 'packaging'; ingredient_sku_id: number | null; sub_recipe_id: number | null; qty: number; unit: string; note?: string }
export interface ParsedRecipe { name: string; recipe_id: number | null; kind: 'intermediate' | 'finished'; book: string | null; output_qty: number; output_unit: string; sold_weight_g: number | null; lines: ParsedLine[] }
export interface UploadResult { file: string; recipes: { name: string; outcome: string; version_id?: number }[]; errors: string[]; created: number; unchanged: number; skipped: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const UNIT: Record<string, string> = { g: 'gram', gm: 'gram', gram: 'gram', grams: 'gram', kg: 'gram', ml: 'millilitre', millilitre: 'millilitre', l: 'millilitre', pc: 'piece', pcs: 'piece', piece: 'piece', pieces: 'piece', each: 'piece', unit: 'piece', units: 'piece', set: 'set' };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let inQ = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export function parseRecipeCsv(text: string, picks: PickLists): { recipes: ParsedRecipe[]; errors: string[] } {
  const rows = parseCsv(text); const errors: string[] = [];
  if (rows.length < 2) return { recipes: [], errors: ['The file has no data rows.'] };
  const head = rows[0].map(h => norm(h));
  const col = (name: string) => head.indexOf(norm(name));
  const need = ['recipe', 'line', 'ref', 'qty', 'unit', 'makes_qty', 'makes_unit'];
  for (const n of need) if (col(n) < 0) errors.push(`Missing column "${n}".`);
  if (errors.length) return { recipes: [], errors };
  const ingByCode = new Map(picks.ingredients.map(i => [i.code.toUpperCase(), i])); const ingByName = new Map(picks.ingredients.map(i => [norm(i.name), i]));
  const recByCode = new Map(picks.recipes.map(r => [r.code.toUpperCase(), r])); const recByName = new Map(picks.recipes.map(r => [norm(r.name), r]));
  const out = new Map<string, ParsedRecipe>();
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2; const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    const name = get('recipe'); if (!name) { errors.push(`Row ${line}: no recipe name.`); return; }
    let rec = out.get(norm(name));
    if (!rec) {
      const existing = recByName.get(norm(name)) ?? recByCode.get(name.toUpperCase());
      const kindText = norm(get('kind')); const kind = existing ? existing.kind : (kindText.startsWith('fin') ? 'finished' : 'intermediate');
      const mq = Number(get('makes_qty')); const mu = UNIT[norm(get('makes_unit'))];
      if (!Number.isFinite(mq) || mq <= 0) { errors.push(`Row ${line}: ${name}: makes_qty must be a number above zero.`); return; }
      if (!mu) { errors.push(`Row ${line}: ${name}: makes_unit must be g, ml, pc or set.`); return; }
      const sw = get('sold_weight_g') ? Number(get('sold_weight_g')) : null;
      rec = { name: existing ? existing.name : name, recipe_id: existing ? existing.id : null, kind, book: get('book') || null, output_qty: mq, output_unit: mu, sold_weight_g: Number.isFinite(sw as number) ? sw : null, lines: [] };
      out.set(norm(name), rec);
    }
    const lt = norm(get('line')); const ref = get('ref'); const qty = Number(get('qty')); const unit = UNIT[norm(get('unit'))];
    if (!ref) { errors.push(`Row ${line}: ${name}: no ref.`); return; }
    if (!Number.isFinite(qty) || qty < 0) { errors.push(`Row ${line}: ${name}: qty "${get('qty')}" is not a number.`); return; }
    if (!unit) { errors.push(`Row ${line}: ${name}: unit "${get('unit')}" must be g, ml, pc or set.`); return; }
    const role: 'material' | 'packaging' = lt === 'packaging' ? 'packaging' : 'material';
    if (lt === 'recipe' || lt === 'packaging' || lt === 'semi' || lt === 'semifinished') {
      const rr = recByCode.get(ref.toUpperCase()) ?? recByName.get(norm(ref));
      if (!rr) {
        // packaging may also be a purchased item
        const ii = lt === 'packaging' ? (ingByCode.get(ref.toUpperCase()) ?? ingByName.get(norm(ref))) : undefined;
        if (ii) { rec.lines.push({ role, ingredient_sku_id: ii.id, sub_recipe_id: null, qty, unit }); return; }
        errors.push(`Row ${line}: ${name}: no recipe called "${ref}".`); return;
      }
      if (rr.name === rec.name) { errors.push(`Row ${line}: ${name}: a recipe cannot use itself.`); return; }
      rec.lines.push({ role, ingredient_sku_id: null, sub_recipe_id: rr.id, qty, unit });
    } else {
      const ii = ingByCode.get(ref.toUpperCase()) ?? ingByName.get(norm(ref));
      if (!ii) { errors.push(`Row ${line}: ${name}: no ingredient with code or name "${ref}". Add it to SupplyNote first, or check the spelling.`); return; }
      rec.lines.push({ role, ingredient_sku_id: ii.id, sub_recipe_id: null, qty, unit });
    }
  });
  const recipes = [...out.values()].filter(r => { if (!r.lines.length) { errors.push(`${r.name}: no usable lines, skipped.`); return false; } return true; });
  return { recipes, errors };
}
