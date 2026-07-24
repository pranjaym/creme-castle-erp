// Apply migrations/*.sql in filename order against the spine Postgres.
// Convenience only: the primary, audited path (as with the sibling apps) is to
// paste each migration into the Supabase SQL editor in order. This script does
// the same, transactionally, and records applied files in schema_migrations.
//
// Usage: SPINE_DATABASE_URL=postgresql://... node scripts/migrate.mjs
// No secret is ever hardcoded; the connection string comes from the environment.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, '..', 'migrations');

const url = process.env.SPINE_DATABASE_URL;
if (!url) {
  console.error('SPINE_DATABASE_URL is not set. Refusing to run.');
  process.exit(1);
}

const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(`create table if not exists schema_migrations (
  filename text primary key, applied_at timestamptz not null default now())`);

for (const f of files) {
  const done = await client.query('select 1 from schema_migrations where filename = $1', [f]);
  if (done.rowCount) { console.log(`skip  ${f} (already applied)`); continue; }
  const sql = readFileSync(join(migDir, f), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into schema_migrations(filename) values ($1)', [f]);
    await client.query('commit');
    console.log(`apply ${f}`);
  } catch (e) {
    await client.query('rollback');
    console.error(`FAIL  ${f}: ${e.message}`);
    process.exit(1);
  }
}
await client.end();
console.log('migrations up to date.');
