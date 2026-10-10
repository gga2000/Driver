import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type Statement = { clause: string; from: string; names: string[] };
const { namesIn, importedNames, barrelStatements, SHARED_ROOTS } = require('../../scripts/contracts-subset.cjs') as {
  namesIn: (text: string) => Set<string> | null;
  importedNames: (repoRoot: string, roots: string[]) => Set<string> | null;
  barrelStatements: (distDir: string) => Statement[];
  SHARED_ROOTS: string[];
};
const repoRoot = path.resolve(__dirname, '../../../..');

describe('contracts subset (production builds take only the schemas an app imports)', () => {
  it('reads named imports and re-exports, skips types, and keeps the whole barrel for any other form', () => {
    const names = namesIn("import { A, type B, C as D } from '@driver/contracts';\nimport type { E } from '@driver/contracts';\nexport { F } from \"@driver/contracts\";\nimport { G } from '@driver/contracts/router';");
    expect([...(names ?? [])].sort()).toEqual(['A', 'C', 'F']);
    expect(namesIn("import * as C from '@driver/contracts';")).toBeNull();
    expect(namesIn("import X, { A } from '@driver/contracts';")).toBeNull();
    expect(namesIn("export * from '@driver/contracts';")).toBeNull();
    expect(namesIn("const c = require('@driver/contracts');")).toBeNull();
  });

  it.each(['customer', 'partner', 'merchant'])('the %s app gets every runtime name it imports', (app) => {
    const wanted = importedNames(repoRoot, [`apps/${app}`, ...SHARED_ROOTS]);
    const all = barrelStatements(path.join(repoRoot, 'packages/contracts/dist'));
    if (!wanted) return; // whole barrel: nothing can be missing
    const exported = new Set(all.flatMap((s) => s.names));
    const kept = new Set(all.filter((s) => s.names.some((n) => wanted.has(n))).flatMap((s) => s.names));
    expect([...wanted].filter((n) => exported.has(n) && !kept.has(n))).toEqual([]);
    expect(kept.size).toBeLessThan(exported.size);
  });
});
