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

/** Plural forms (`_one`, `_few`, …) and the Console's count families (`_0`, `_1`, `_2`; lib/plural.ts). */
const PLURAL = /_(zero|one|two|few|many|other|0|1|2)$/;
const SOURCE = /\.(tsx?|mjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'e2e']);
/**
 * Shared files whose keys only the server or the phones render: the notification catalog names every
 * push / WhatsApp / SMS text (`push.order_ops_cancelled.title`, …), which the Console never shows.
 */
const SERVER_ONLY = new Set([path.join('packages', 'contracts', 'src', 'notify-io.ts')]);

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
    } else if (SOURCE.test(entry.name) && !entry.name.includes('.test.') && ![...SERVER_ONLY].some((f) => p.endsWith(f))) {
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

/** The Console's own code: its keys travel with the screens that name them (`scripts/words-loader.cjs`). */
const OWN_ROOT = 'apps/console/src';
/** Shared packages the Console bundles: their keys stay in the shared table every page loads. */
const SHARED_ROOTS = ['packages/contracts/src', 'packages/map/src', 'packages/i18n/src'];

/**
 * Writes the Console's tables under `outDir` and returns their paths:
 *  - `arPath`: the shared Arabic table every page loads, only the keys the shared packages name;
 *  - `wordsPath`: every Arabic key the Console's own code names. A production build adds each screen's
 *    keys to the shared table from that screen's own file (scripts/words-loader.cjs), so a page carries
 *    the words of the screens it shows, not every Console page's (CON-13 follow-up, 2026-10-09);
 *  - `enPath`: an empty English table (the Console is Arabic only).
 */
export function writeConsoleLocales({ repoRoot, outDir }) {
  const ar = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/i18n/src/locales/ar-IQ.json'), 'utf8'));
  const shared = { exact: new Set(), prefixes: new Set() };
  for (const root of SHARED_ROOTS) walk(path.join(repoRoot, root), shared);
  const own = walk(path.join(repoRoot, OWN_ROOT), { exact: new Set(), prefixes: new Set() });
  fs.mkdirSync(outDir, { recursive: true });
  const arPath = path.join(outDir, 'ar-IQ.json');
  const wordsPath = path.join(outDir, 'ar-IQ.words.json');
  const enPath = path.join(outDir, 'en.json');
  fs.writeFileSync(arPath, JSON.stringify(pickMessages(ar, shared)));
  fs.writeFileSync(wordsPath, JSON.stringify(pickMessages(ar, own)));
  fs.writeFileSync(enPath, '{}');
  return { arPath, wordsPath, enPath };
}

/**
 * The statement a production build puts at the top of one Console source file: it adds the keys that file
 * names (and that the shared table lacks) to the shared table, before anything in the file can call `t()`.
 * Returns the source unchanged when the file names none. A `'use client'` / `'use server'` directive stays first.
 */
export function withOwnWords(source, { words, shared, tablePath }) {
  const picked = pickMessages(words, keyRefs(source));
  for (const key of Object.keys(picked)) if (key in shared) delete picked[key];
  if (Object.keys(picked).length === 0) return source;
  const line = `import __driverWords from ${JSON.stringify(tablePath)}; Object.assign(__driverWords, ${JSON.stringify(picked)});\n`;
  const directive = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*(['"])use (?:client|server)\1;?[^\n]*\n/.exec(source);
  return directive ? source.slice(0, directive[0].length) + line + source.slice(directive[0].length) : line + source;
}
