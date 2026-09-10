// Cross-platform reset for the repository's LOCAL Wrangler D1 state only.
import { rmSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.wrangler', 'state', 'v3', 'd1');
const expected = '.wrangler/state/v3/d1';
const resolvedRelative = relative(root, target).replaceAll('\\', '/');

if (resolvedRelative !== expected) {
  throw new Error(`Refusing to reset unexpected path: ${target}`);
}

rmSync(target, { recursive: true, force: true });
console.log(`Removed LOCAL D1 state: ${resolvedRelative}`);
