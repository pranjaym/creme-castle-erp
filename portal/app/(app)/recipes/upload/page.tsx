import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { one } from '@/lib/db';
import { uploadRecipes } from '../actions';
import { Crumbs, Flash } from '../ui';
import type { UploadResult } from '@/lib/recipes-upload';

// Bulk upload. The chef or controls fills the template (the live book, downloaded in
// the same shape) and sends it back; every recipe that differs becomes a draft,
// nothing goes live here.
export const dynamic = 'force-dynamic';

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; result?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user.role);
  if (!perms.draft) redirect('/recipes');
  const sp = await searchParams;
  let result: UploadResult | null = null;
  if (sp.result) { const r = await one<{ data: UploadResult }>('select data from recipes.event where id = $1 and entity = $2', [Number(sp.result), 'upload']); result = r?.data ?? null; }
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Bulk upload']} />
      <h1 className="page">Bulk upload a recipe file</h1>
      <p className="hint">
        Download the template: it is the whole live book, one row per line, in the shape the upload reads. Edit it in Excel
        (change quantities, add or remove rows, add a new recipe with a new name), save as CSV, and upload. Every recipe that
        differs from its live version becomes a <b>draft</b>; nothing goes live until it is checked and approved like any other change.
      </p>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="tile">
          <div className="t">1. Get the template</div>
          <div className="d">Columns: recipe, kind, line (ingredient / recipe / packaging), ref (SupplyNote code or name, or a recipe name), qty, unit (g, ml, pc, set), makes_qty, makes_unit, sold_weight_g, book.</div>
          <p style={{ marginTop: 10 }}><Link className="btn btn-secondary" href="/recipes/download?what=template">Download the live book as the template</Link></p>
        </div>
        <div className="tile">
          <div className="t">2. Upload the edited file</div>
          <form action={uploadRecipes} className="row" style={{ marginTop: 8 }}>
            <input id="upload-file" name="file" type="file" accept=".csv,text/csv" required />
            {perms.check ? <label className="small"><select name="mode" defaultValue="draft"><option value="draft">create drafts (chef edits next)</option><option value="check">create drafts and send for check</option></select></label> : <input type="hidden" name="mode" value="draft" />}
            <button className="btn btn-primary" type="submit">Upload</button>
          </form>
          <div className="note">Unknown ingredient names stop only that recipe, with a message. An ingredient must exist in SupplyNote first.</div>
        </div>
      </div>
      {result ? (
        <>
          <h2 className="sec-head">Result of {result.file}</h2>
          <p className="note">{result.created} new recipe{result.created === 1 ? '' : 's'}, {result.recipes.filter(r => r.outcome.startsWith('draft')).length} drafts created, {result.unchanged} unchanged, {result.skipped} skipped, {result.errors.length} row problems.</p>
          {result.errors.length ? <div className="err"><b>Rows that could not be read</b><ul style={{ margin: '6px 0 0 18px' }}>{result.errors.slice(0, 60).map((e, i) => <li key={i}>{e}</li>)}</ul></div> : null}
          <div className="scroll-x"><table className="sheet">
            <thead><tr><th>Recipe</th><th>Outcome</th></tr></thead>
            <tbody>{result.recipes.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.outcome}{r.version_id ? <> · <Link href="/recipes/approvals?state=draft">see drafts</Link></> : null}</td></tr>)}</tbody>
          </table></div>
        </>) : null}
    </>
  );
}
