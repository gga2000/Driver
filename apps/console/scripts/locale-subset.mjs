import fs from 'node:fs';
import path from 'node:path';

/**
 * The Console's own copy of the strings (CON-13, build plan §6 "≤ 250 KB of JS per page").
 *
 * `@driver/i18n` holds every app's strings in both languages (≈ 225 KB gzipped), and every Console page
 * shipped all of it. The Console is Arabic only (`CONSOLE_LOCALE`), and `t()` already falls back to
 * Arabic, so a production build swaps in:
 *  - an empty English table, and
 *  - an Arabic table with only the keys the Console's code (and the shared packages it runs) can name.
 *
 * A key is kept when the source names it whole (`'console.apr_all'`, plus its plural forms), or when it
 * starts with a prefix the source builds keys from (`` `console.sup_view_${v}` ``, `'zone:' + key`).
 * Over-keeping is harmless; a key dropped by mistake would show raw on screen, which the browser checks
 * (`e2e/pages.spec.ts`) look for on every page. `next dev` keeps the full tables, so new keys show at once.
 */

const PLURAL = /_(zero|one|two|few|many|other)$/;
const SOURCE = /\.(tsx?|mjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'e2e']);

/** Every `'ns.key'`, `"ns:key"` or `` `ns.key_${…}` `` in a source text: whole keys and key prefixes. */
export function keyRefs(source, into = { exact: new Set(), prefixes: new Set() }) {
  for (const m of source.matchAll(/(['"`])([a-z_]+[.:][\w.:-]*)(.)/g)) {
    const [, open, key, next] = m;
    const whole = next === open && !/[.:_-]$/.test(key);
    (whole ? into.exact : into.prefixes).add(key);
  }
  return into;
}

function walk(dir, refs) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(p, refs);
    } else if (SOURCE.test(entry.name) && !entry.name.includes('.test.')) {
      keyRefs(fs.readFileSync(p, 'utf8'), refs);
    }
  }
  return refs;
}

/** The subset of `messages` that `refs` can reach. */
export function pickMessages(messages, refs) {
  const prefixes = [...refs.prefixes];
  const keep = (key) => refs.exact.has(key) || refs.exact.has(key.replace(PLURAL, '')) || prefixes.some((p) => key.startsWith(p));
  return Object.fromEntries(Object.entries(messages).filter(([key]) => keep(key)));
}

/**
 * Writes the Console's Arabic subset and an empty English table under `outDir`; returns their paths.
 * `roots` are the source folders scanned: the Console's own code and the shared packages it bundles.
 */
export function writeConsoleLocales({ repoRoot, outDir }) {
  const roots = ['apps/console/src', 'packages/contracts/src', 'packages/map/src', 'packages/i18n/src'].map((r) => path.join(repoRoot, r));
  const refs = { exact: new Set(), prefixes: new Set() };
  for (const root of roots) walk(root, refs);
  const ar = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/i18n/src/locales/ar-IQ.json'), 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const arPath = path.join(outDir, 'ar-IQ.json');
  const enPath = path.join(outDir, 'en.json');
  fs.writeFileSync(arPath, JSON.stringify(pickMessages(ar, refs)));
  fs.writeFileSync(enPath, '{}');
  return { arPath, enPath };
}
