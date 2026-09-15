// Direct Postgres access to the spine for schemas PostgREST does not expose
// (the recipes schema). Server only. The connection string is the pooler URL
// (F15: the direct db.<ref> host is IPv6-only), keepalives on (F47: a stalled
// socket must not hang a request), and a statement timeout so a runaway query
// can never hold a Vercel lambda.
import 'server-only';
import { Pool, types, type QueryResultRow } from 'pg';

// Dates and timestamps come back as the text Postgres sent, never as JS Date objects:
// the screens slice and print them, and a Date would silently become a wrong-timezone
// string (F35 was exactly that on the daily pages).
types.setTypeParser(1082, (v) => v);   // date
types.setTypeParser(1114, (v) => v);   // timestamp
types.setTypeParser(1184, (v) => v);   // timestamptz

let _pool: Pool | null = null;

export function pool(): Pool {
  if (_pool) return _pool;
  const url = process.env.SPINE_DATABASE_URL;
  if (!url) throw new Error('SPINE_DATABASE_URL missing (server-only; add it to the environment)');
  _pool = new Pool({
    connectionString: url,
    max: 3,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
    ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });
  return _pool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool().query<T>(text, params);
  return r.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

// Run several statements as one unit (a workflow step and its audit row).
export async function tx<T>(fn: (client: { q: <R extends QueryResultRow = QueryResultRow>(t: string, p?: unknown[]) => Promise<R[]> }) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('begin');
    const out = await fn({ q: async <R extends QueryResultRow = QueryResultRow>(t: string, p: unknown[] = []) => (await client.query<R>(t, p)).rows });
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
