import { redirect } from 'next/navigation';
import { requireUser, recipePerms } from '@/lib/session';
import { engineModel, getSettings } from '@/lib/recipes';
import { q } from '@/lib/db';
import { Crumbs } from '../ui';
import ImpactClient from './ImpactClient';

// What if a price changes: the whole live book and the price list go to the browser
// once, and the engine there answers every what-if without a round trip.
export const dynamic = 'force-dynamic';

export default async function ImpactPage({ searchParams }: { searchParams: Promise<{ sku?: string }> }) {
  const user = await requireUser();
  const perms = recipePerms(user);
  if (!perms.money) redirect('/recipes');
  const sp = await searchParams;
  const [model, settings, prices] = await Promise.all([engineModel(), getSettings(),
    q<{ recipe_id: number; selling_price: string | null; packaging_charge: string | null }>(`select recipe_id, selling_price, packaging_charge from recipes.current_price where channel = 'aggregator'`)]);
  const priceMap: Record<number, { sp: number; pc: number }> = {};
  for (const p of prices) priceMap[p.recipe_id] = { sp: Number(p.selling_price ?? 0), pc: Number(p.packaging_charge ?? 0) };
  return (
    <>
      <Crumbs items={[['Recipes', '/recipes'], 'Price impact']} />
      <h1 className="page">Price impact</h1>
      <p className="hint">Type a new rate for any ingredient and see every finished good that moves, and by how much. Several what-ifs can be stacked. Nothing here is saved; to change a real rate, open the ingredient.</p>
      <ImpactClient model={model} settings={settings} prices={priceMap} initialSku={sp.sku ? Number(sp.sku) : null} />
    </>
  );
}
