// Data for the inventory screens (packaging). One database call
// (public.inv_packaging_data, migration 254) hands over SupplyNote's facts as
// last synced; the engine (lib/inventory-engine.ts) does the arithmetic. This
// file never talks to SupplyNote: the hourly sync (lib/supplynote-sync.ts)
// keeps the spine fresh and the screens read the spine.
import 'server-only';
import { spine } from '@/lib/supabase/service';
import { compute, type Computed, type RawData } from '@/lib/inventory-engine';
import { syncStatus, type SyncStatus } from '@/lib/supplynote-sync';

export interface InventoryPage { d: Computed; sync: SyncStatus[]; }

export async function loadInventory(): Promise<InventoryPage> {
  // Local testing only (same convention as MAIL_DEV_OUTBOX): INVENTORY_FIXTURE=<file>
  // reads a saved answer of inv_packaging_data instead of calling the database.
  // Ignored in production.
  if (process.env.NODE_ENV !== 'production' && process.env.INVENTORY_FIXTURE) {
    const { readFileSync } = await import('node:fs');
    return { d: compute(JSON.parse(readFileSync(process.env.INVENTORY_FIXTURE, 'utf8')) as RawData), sync: await syncStatus().catch(() => [] as SyncStatus[]) };
  }
  const [{ data, error }, sync] = await Promise.all([spine().rpc('inv_packaging_data'), syncStatus().catch(() => [] as SyncStatus[])]);
  if (error) throw new Error(`inv_packaging_data: ${error.message}`);
  return { d: compute(data as RawData), sync };
}

// "Last synced": the oldest of the three hourly datasets, so the line never
// claims more freshness than the stalest input has.
export function lastSynced(sync: SyncStatus[]): { at: Date | null; lines: Date | null } {
  const t = (k: string) => { const s = sync.find((x) => x.report_key === k)?.last_loaded_at; return s ? new Date(s) : null; };
  const hourly = ['stock_daily', 'inventory_log', 'purchase_orders'].map(t);
  const at = hourly.some((x) => x === null) ? null : new Date(Math.min(...hourly.map((x) => x!.getTime())));
  return { at, lines: t('purchase_order_lines') };
}
