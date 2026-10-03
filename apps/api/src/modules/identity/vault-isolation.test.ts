import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Domain §13 / plan Step 1: only `modules/identity` may touch the vault. Within identity, only
 * `identity.repository.ts` may reference the Prisma delegates. Anything else that mentions
 * `personIdentity` or `vaultAccessLog` (the generated client's accessor names) fails this test.
 */
const src = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWED = new Set([
  'modules/identity/identity.repository.ts',
  // Tests inside the module may reach its internals (architecture §1); the integration test cleans up vault rows.
  'modules/identity/identity.integration.test.ts',
  'modules/identity/vault-isolation.test.ts',
]);
const PATTERN = /\b(personIdentity|vaultAccessLog|person_identities|vault_access_logs)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('vault isolation', () => {
  it('no file outside identity.repository.ts references the vault tables', () => {
    const offenders: string[] = [];
    for (const file of walk(src)) {
      const rel = relative(src, file).replaceAll('\\', '/');
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, 'utf8');
      if (PATTERN.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('the repository itself does reference the vault (sanity check for the scan)', () => {
    const text = readFileSync(resolve(src, 'modules/identity/identity.repository.ts'), 'utf8');
    expect(PATTERN.test(text)).toBe(true);
  });
});
