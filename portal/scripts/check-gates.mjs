// Fails the build if any page, download or form action in the signed-in part of
// the portal does not check the person's role. Runs before every `next build`.
//
// Why (26 Sep 2026): the menu hid Discounts, the sales dashboard and the
// glossaries from area managers and stores, but those pages only checked that
// someone was logged in, so anyone could open them by typing the address. tsc
// and next build both passed. This check is what would have caught it.
//
// Rules, all reading the one permission table (portalAccess in lib/session.ts):
//   page.tsx   must call requireAccess(...) or requireAdmin()
//   route.ts   must call portalAccess / couponPerms / recipePerms and answer
//              "Not allowed" when the check fails
//   actions.ts every exported action must start with a guard call
// A page that is deliberately open to every signed-in person goes in OPEN with
// the reason, so opening one is a visible decision, never an accident.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'app', '(app)');
const OPEN = {
  'page.tsx': 'Home: every signed-in person, and it scopes its own numbers by role',
  'account/page.tsx': 'Change your own password',
  'account/actions.ts': 'Changes only the signed-in person\'s own password',
  'glossary/page.tsx': 'Only redirects to /glossary/items, which is gated',
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
    if (!/\brequire(Access|Admin)\(/.test(src)) failures.push(`${rel}: page has no requireAccess(...) or requireAdmin()`);
  } else if (name === 'route.ts') {
    if (!/\b(portalAccess|couponPerms|recipePerms)\(/.test(src) || !/Not allowed/.test(src)) {
      failures.push(`${rel}: download has no role check that answers "Not allowed"`);
    }
  } else {
    const re = /^export async function (\w+)\([^)]*\)[^{]*\{([^\n]*\n[^\n]*)/gm;
    let m;
    while ((m = re.exec(src))) {
      if (!/\b(need\w*|require\w*|step)\(/.test(m[2])) failures.push(`${rel}: action ${m[1]} does not start with a guard`);
    }
  }
}

if (failures.length) {
  console.error('\nPortal gate check FAILED. Every signed-in page must check the role:\n');
  for (const f of failures) console.error('  ' + f);
  console.error('\nGate it with requireAccess(a => a.<area>) from lib/session.ts, or add it to OPEN in scripts/check-gates.mjs with the reason.\n');
  process.exit(1);
}
console.log('Portal gate check passed.');
