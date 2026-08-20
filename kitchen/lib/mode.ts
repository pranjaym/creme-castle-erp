// The kitchen module's mode: 'trial' (a rehearsal with the real team, whose
// rows are hidden the moment we go live) or 'live' (real operations).
// The clean slate is a SWITCH, not a delete: see migration 120.
import 'server-only';
import { spine } from '@/lib/supabase/server';

export type KitchenMode = 'trial' | 'live';

export async function getKitchenMode(): Promise<KitchenMode> {
  const { data } = await spine().from('spine_modes').select('mode').eq('key', 'kitchen').single();
  return (data?.mode as KitchenMode) ?? 'live';
}
