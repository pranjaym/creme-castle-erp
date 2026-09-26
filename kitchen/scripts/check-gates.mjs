// Fails the build if any page, download or server action in the kitchen app
// does not check the person's role. Runs before every `next build`.
//
// Why (26 Sep 2026, F63): the back office pages were guarded only by the admin
// layout, and the three CSV downloads and the reconciliation action by nothing
// at all, so any signed-in account (every store and area manager included,
// since the portal and this app share one login) could download the kitchen
// ledger by typing its address. The portal has the same check
// (portal/scripts/check-gates.mjs).
//
// Rules, all reading lib/session.ts:
//   page.tsx   must call requireRoles(...)
//   route.ts   must call kitchenUserIn(...) and answer "Not allowed"
//   actions.ts every exported action must start with a guard call
// A page deliberately open to every signed-in kitchen account goes in OPEN
// with the reason.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'app');
const OPEN = {
  'page.tsx': 'Home: only sends each person to their own screen (homeFor)',
  'dept/[dept]/page.tsx': 'Department screen: checks mayUseDept, a tablet reaches only its own',
  'login/page.tsx': 'The sign-in page',
  'login/actions.ts': 'Signing in',
};

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const failures = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const name = rel.split('/').pop();
  if (!['page.tsx', 'route.ts', 'actions.ts'].includes(name)) continue;
  if (OPEN[rel]) continue;
  const src = readFileSync(file, 'utf8');

  if (name === 'page.tsx') {
    if (!/\brequireRoles\(/.test(src)) failures.push(`${rel}: page has no requireRoles(...)`);
  } else if (name === 'route.ts') {
    if (!/\bkitchenUserIn\(/.test(src) || !/Not allowed/.test(src)) {
      failures.push(`${rel}: download has no role check that answers "Not allowed"`);
    }
  } else {
    const re = /^export async function (\w+)\(([\s\S]*?)\)[^{]*\{([^\n]*\n[^\n]*)/gm;
    let m;
    while ((m = re.exec(src))) {
      if (!/\b(guard\w*|kitchenUserIn|require\w*)\(/.test(m[3])) failures.push(`${rel}: action ${m[1]} does not start with a guard`);
    }
  }
}

if (failures.length) {
  console.error('\nKitchen gate check FAILED. Every signed-in page must check the role:\n');
  for (const f of failures) console.error('  ' + f);
  console.error('\nGate it with requireRoles / kitchenUserIn from lib/session.ts, or add it to OPEN in scripts/check-gates.mjs with the reason.\n');
  process.exit(1);
}
console.log('Kitchen gate check passed.');
