/* eslint-disable */
/**
 * Speed (2026-10-09): `@driver/contracts` is one barrel of every app's schemas (Console, merchant, ledger,
 * notifications…). Metro bundles a barrel whole, so each phone carried all of it, and every new server-side
 * schema grew all three apps. A production build now swaps the barrel for a smaller one that keeps only the
 * `export … from` lines whose names this app (or a shared package it runs) imports by name. Modules a kept
 * module needs still come in through its own imports, so nothing it relies on is lost.
 *
 * Safe by construction: names come from every `import { … } from '@driver/contracts'` and
 * `export { … } from '@driver/contracts'` in the app and the shared packages; an `import * as` or a
 * `require('@driver/contracts')` anywhere keeps the whole barrel. Dev builds keep the whole barrel too.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SHARED_ROOTS = ['packages/ui/src', 'packages/map/src', 'packages/i18n/src'];
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIR = new Set(['scripts', 'node_modules', 'dist', 'dist-web', '.expo', '.cache', 'coverage', 'web-shots']);

function* sourceFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name) && !e.name.startsWith('.')) yield* sourceFiles(path.join(dir, e.name));
    } else if (SOURCE.test(e.name) && !/\.(test|config)\./.test(e.name)) yield path.join(dir, e.name);
  }
}

const NAMED = /\b(import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@driver\/contracts['"]/g;
const WHOLE = /\bimport\s+\*\s+as\s+\w+\s+from\s*['"]@driver\/contracts['"]|\brequire\(\s*['"]@driver\/contracts['"]\s*\)|\bimport\(\s*['"]@driver\/contracts['"]\s*\)/;

/** The runtime names one file imports from the barrel (added to `into`), or `null` when it takes the barrel whole. */
function namesIn(text, into = new Set()) {
  if (!text.includes('@driver/contracts')) return into;
  if (WHOLE.test(text)) return null;
  // Any other form (`import X, { … }`, `export * from`) also keeps the whole barrel.
  const named = [...text.matchAll(NAMED)];
  if (named.length !== (text.match(/['"]@driver\/contracts['"]/g)?.length ?? 0)) return null;
  for (const m of named) {
    if (m[2]) continue; // `import type { … }`: gone at runtime
    for (const raw of m[3].split(',')) {
      const spec = raw.trim();
      if (spec && !spec.startsWith('type ')) into.add(spec.split(/\s+as\s+/)[0].trim());
    }
  }
  return into;
}

/** The runtime names the code under `roots` imports from the barrel, or `null` when something takes it whole. */
function importedNames(repoRoot, roots) {
  const names = new Set();
  for (const root of roots) {
    for (const file of sourceFiles(path.join(repoRoot, root))) {
      if (!namesIn(fs.readFileSync(file, 'utf8'), names)) return null;
    }
  }
  return names;
}

/** Each `export … from` line of the built barrel, with the names it provides at runtime (asked of node). */
function barrelStatements(distDir) {
  const index = fs.readFileSync(path.join(distDir, 'index.js'), 'utf8');
  const statements = [...index.matchAll(/export\s+(\*|\{[^}]*\})\s+from\s+['"](\.\/[^'"]+)['"];?/g)].map((m) => ({ clause: m[1], from: m[2] }));
  const leftover = index.replace(/export\s+(\*|\{[^}]*\})\s+from\s+['"](\.\/[^'"]+)['"];?/g, '').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').trim();
  if (leftover) throw new Error(`contracts-subset: the barrel has code besides re-exports (${leftover.slice(0, 80)}…)`);
  const stars = statements.filter((s) => s.clause === '*').map((s) => s.from);
  const script = `const out={};for(const f of JSON.parse(process.argv[1]))out[f]=Object.keys(await import(new URL(f,${JSON.stringify(`file://${distDir}/`)}).href));console.log(JSON.stringify(out));`;
  const keys = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(stars)], { cwd: distDir, encoding: 'utf8' }));
  return statements.map((s) => ({
    ...s,
    names: s.clause === '*' ? keys[s.from] : s.clause.slice(1, -1).split(',').map((n) => n.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean),
  }));
}

/**
 * Writes `<outDir>/contracts.js` for one app and returns its path, or `null` when the app needs the whole barrel.
 * `appRoots`: the app's folders, relative to the repo root (tests, *.config.* and Node-only scripts/ are skipped).
 */
function writeContractsSubset({ repoRoot, appRoots, outDir }) {
  const wanted = importedNames(repoRoot, [...appRoots, ...SHARED_ROOTS]);
  if (!wanted) return null;
  const distDir = path.join(repoRoot, 'packages/contracts/dist');
  const kept = barrelStatements(distDir).filter((s) => s.names.some((n) => wanted.has(n)));
  fs.mkdirSync(outDir, { recursive: true });
  const rel = (from) => path.relative(outDir, path.join(distDir, from)).split(path.sep).join('/');
  const body = kept.map((s) => `export ${s.clause} from '${rel(s.from)}';`).join('\n');
  const file = path.join(outDir, 'contracts.js');
  fs.writeFileSync(file, `// Generated by apps/customer/scripts/contracts-subset.cjs: production builds only.\n${body}\n`);
  return file;
}

module.exports = { writeContractsSubset, namesIn, importedNames, barrelStatements, SHARED_ROOTS };
