// Server-only Supabase clients. Service-role key never reaches the browser
// (same rule as both sibling apps: all data access is server-side).
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _spine: SupabaseClient | null = null;
let _omsRead: SupabaseClient | null = null;

/** The spine project (read + write). */
export function spine(): SupabaseClient {
  if (_spine) return _spine;
  const url = process.env.SPINE_SUPABASE_URL;
  const key = process.env.SPINE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SPINE_SUPABASE_URL / SERVICE_ROLE_KEY missing');
  _spine = createClient(url, key, { auth: { persistSession: false } });
  return _spine;
}

/** The OMS project, READ-ONLY. The spine reads OMS orders; it never writes back. */
export function omsReadonly(): SupabaseClient {
  if (_omsRead) return _omsRead;
  const url = process.env.OMS_SUPABASE_URL;
  const key = process.env.OMS_SUPABASE_READONLY_KEY;
  if (!url || !key) throw new Error('OMS_SUPABASE_URL / READONLY_KEY missing');
  _omsRead = createClient(url, key, { auth: { persistSession: false } });
  return _omsRead;
}
