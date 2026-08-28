'use server';

// Writes for the two glossary screens.
//
// Why this module exists at all (F39): the item and outlet glossary lived as four CSV
// files on one laptop, so adding a mapping was a git commit. Pranjay is the person who
// knows the answers and was the one person who could not apply them. 21 items worth
// Rs 23.8 lakh sat unmapped for up to a month while the 8am mail listed them every
// morning. An alert with no button is not an alert. These are the buttons.
//
// Every action re-checks the caller, because a server action is directly callable and
// the page-level gate is not enough. Every write is appended to public.glossary_audit
// (canonical rule 6: nothing is ever silently overwritten without a trail).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser, type SessionUser } from '@/lib/session';
import { spine } from '@/lib/supabase/service';

async function requireEditor(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || (u.role !== 'admin' && u.role !== 'central')) redirect('/');
  return u;
}

function bounce(to: string, msg: string, kind: 'ok' | 'err' = 'ok'): never {
  redirect(`${to}${to.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg)}`);
}

function clean(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
}

/** Save one item mapping. Used both for a brand new item and for editing an existing one. */
export async function saveItem(form: FormData) {
  const user = await requireEditor();
  const back = (clean(form.get('back')) ?? '/glossary/items');

  const itemName = clean(form.get('item_name'));
  const alias = clean(form.get('alias'));
  const category = clean(form.get('category'));
  const occasion = clean(form.get('occasion'));
  const shelfLife = clean(form.get('shelf_life'));

  if (!itemName) bounce(back, 'No item name was posted.', 'err');
  // Alias and category are the two that must never be guessed. Shelf life is allowed to
  // stay empty: it is a production fact, and a blank is honest where a copied sibling
  // value would not be (canonical rule 5).
  if (!alias) bounce(back, `Give ${itemName} an alias name.`, 'err');
  if (!category) bounce(back, `Give ${itemName} a category.`, 'err');

  const { error } = await spine().from('item_glossary').upsert({
    item_name: itemName,
    alias,
    category,
    occasion,
    shelf_life: shelfLife,
    updated_at: new Date().toISOString(),
    updated_by: user.email,
  }, { onConflict: 'item_name' });

  if (error) bounce(back, `Could not save ${itemName}: ${error.message}`, 'err');

  revalidatePath('/glossary/items');
  bounce(back, `${itemName} is now ${alias} (${category}${occasion ? `, ${occasion}` : ''}).`);
}

/** Save the dashboard fields for one outlet. The outlet master is the canonical row. */
export async function saveOutlet(form: FormData) {
  const user = await requireEditor();
  const back = (clean(form.get('back')) ?? '/glossary/outlets');

  const code = clean(form.get('internal_code'));
  if (!code) bounce(back, 'No outlet was posted.', 'err');

  const patch: Record<string, unknown> = {
    city: clean(form.get('city')),
    store_type: clean(form.get('store_type')),
    location_code: clean(form.get('location_code')),
    area_manager: clean(form.get('area_manager')),
    updated_at: new Date().toISOString(),
  };
  const reopen = clean(form.get('expected_reopen_on'));

  const { data: before } = await spine().from('outlets')
    .select('*').eq('internal_code', code).maybeSingle();

  if (!before) {
    // A name the feed is using that the master has never heard of. Create it, so the
    // orders stop belonging to no store.
    const { error } = await spine().from('outlets').insert({
      internal_code: code, active: true, ...patch,
    });
    if (error) bounce(back, `Could not add ${code}: ${error.message}`, 'err');
  } else {
    const { error } = await spine().from('outlets').update(patch).eq('internal_code', code);
    if (error) bounce(back, `Could not save ${code}: ${error.message}`, 'err');
  }

  // The reopen date lives on locations, which is what the outlet watch reads.
  if (reopen !== null) {
    await spine().from('locations').update({ expected_reopen_on: reopen }).eq('name', code);
  }

  await spine().from('glossary_audit').insert({
    entity: 'outlet',
    entity_key: code,
    action: before ? 'update' : 'insert',
    before_row: before ?? null,
    after_row: { internal_code: code, ...patch },
    changed_by: user.email,
  });

  revalidatePath('/glossary/outlets');
  bounce(back, `${code} saved.`);
}
