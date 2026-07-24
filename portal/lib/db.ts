// Direct Postgres pool for the spine. Server-only. Used to export the report CSVs
// from the private `landing` schema, which is deliberately NOT exposed to
// PostgREST, so supabase-js cannot reach it. Read-only queries only.
//
// The connection string should carry the SSL mode, e.g. append `?sslmode=require`
// to SPINE_DATABASE_URL (Supabase supplies this on the connection-string screen).
import 'server-only';
import { Pool } from 'pg';

let _pool: Pool | null = null;

export function pool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.SPINE_DATABASE_URL;
  if (!connectionString) throw new Error('SPINE_DATABASE_URL missing');
  _pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}
