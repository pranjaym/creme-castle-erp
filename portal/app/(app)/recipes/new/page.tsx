import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { createRecipe } from '../actions';
import { Crumbs, Flash } from '../ui';

export const dynamic = 'force-dynamic';

export default async function NewRecipePage({ searchParams }: { searchParams: Promise<{ kind?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  if (!recipePerms(user.role).draft) redirect('/recipes');
  const sp = await searchParams;
  const finished = sp.kind === 'finished';
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'New recipe']} />
      <h1 className="page">Write a new recipe</h1>
      <p className="hint">Name it and say what one batch makes. The lines come next, on the draft screen. A new recipe starts as &ldquo;upcoming&rdquo; and becomes active when its first version is approved.</p>
      <Flash ok={sp.ok} err={sp.err} />
      <form action={createRecipe} className="tile" style={{ maxWidth: 560 }}>
        <label className="small">Name<br /><input name="name" required style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6 }} placeholder="e.g. Pistachio Whipped Ganache, or Pistachio Cake (500 Gms)" /></label>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="small">What is it<br /><select name="kind" defaultValue={finished ? 'finished' : 'intermediate'}><option value="intermediate">semi-finished (sponge, ganache, cream, base)</option><option value="finished">finished good (sold item)</option></select></label>
          <label className="small">Book<br /><select name="book" defaultValue={finished ? 'cake' : 'sub_mesa'}><option value="sub_mesa">semi-finished</option><option value="cake">cake</option><option value="pastry">pastry or dessert</option></select></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="small">One batch makes<br /><input name="output_qty" type="number" step="any" min="0.001" required style={{ width: 110 }} defaultValue={finished ? 1 : ''} /></label>
          <label className="small">Unit<br /><select name="output_unit" defaultValue={finished ? 'piece' : 'gram'}><option value="gram">g</option><option value="millilitre">ml</option><option value="piece">pc (sold units, for a finished good)</option><option value="set">set (packaging)</option></select></label>
        </div>
        <label className="small" style={{ display: 'block', marginTop: 10 }}>Note<br /><input name="note" style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6 }} placeholder="why this recipe, anything the checker should know" /></label>
        <div style={{ marginTop: 12 }}><button className="btn btn-primary" type="submit">Create and add the lines</button></div>
      </form>
    </>
  );
}
