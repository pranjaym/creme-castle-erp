// Server-only service-role client for the spine. The secret key never reaches the
// browser (same rule as the kitchen app and OMS). Used for privileged reads:
// listing/serving the dashboard storage bucket. Report CSV exports use the direct
// pg pool (db.ts) because the landing schema is private to PostgREST.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _spine: SupabaseClient | null = null;

export function spine(): SupabaseClient {
  if (_spine) return _spine;
  const url = process.env.NEXT_PUBLIC_SPINE_SUPABASE_URL;
  const key = process.env.SPINE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SPINE_SUPABASE_URL / SPINE_SUPABASE_SERVICE_ROLE_KEY missing');
  }
  _spine = createClient(url, key, { auth: { persistSession: false } });
  return _spine;
}
