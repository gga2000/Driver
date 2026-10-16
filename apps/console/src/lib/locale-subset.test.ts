import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { keyRefs, pickMessages, withOwnWords, writeConsoleLocales } from '../../scripts/locale-subset.mjs';

const repoRoot = path.resolve(__dirname, '../../../..');
const ar = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/i18n/src/locales/ar-IQ.json'), 'utf8')) as Record<string, string>;

describe('the Console strings subset (CON-13)', () => {
  it('reads whole keys and the prefixes keys are built from', () => {
    const refs = keyRefs("t('console.apr_all'); t(`console.sup_view_${v}`); t(\"zone:\" + k); t('console.ev_' + type); a.b");
    expect([...refs.exact]).toEqual(['console.apr_all']);
    expect([...refs.prefixes].sort()).toEqual(['console.ev_', 'console.sup_view_', 'zone:']);
  });

  it('keeps plural forms of a whole key and everything under a prefix', () => {
    const messages = { 'a.n': '', 'a.n_one': '', 'a.n_few': '', 'a.x_1': '', 'a.x_2': '', 'b.y': '' };
    const picked = pickMessages(messages, { exact: new Set(['a.n']), prefixes: new Set(['a.x_']) });
    expect(Object.keys(picked)).toEqual(['a.n', 'a.n_one', 'a.n_few', 'a.x_1', 'a.x_2']);
  });

  it('keeps every Console key, each with the screen that names it, and drops other apps', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-locale-'));
    const { arPath, wordsPath, enPath } = writeConsoleLocales({ repoRoot, outDir });
    const shared = JSON.parse(fs.readFileSync(arPath, 'utf8')) as Record<string, string>;
    const words = JSON.parse(fs.readFileSync(wordsPath, 'utf8')) as Record<string, string>;
    expect(fs.readFileSync(enPath, 'utf8')).toBe('{}');
    const consoleKeys = Object.keys(ar).filter((k) => k.startsWith('console.'));
    const missing = consoleKeys.filter((k) => !(k in words) && !(k in shared));
    // A Console key the scan can't see is either dead copy (remove it) or built in a way the scan
    // misses (name its prefix as a string); either way it must not be dropped silently.
    expect(missing).toEqual([]);
    expect(words['console.sup_view_mine']).toBe(ar['console.sup_view_mine']);
    expect(Object.keys(words).some((k) => k.startsWith('home.'))).toBe(false);
    // The notification catalog's push texts are the server's and the phones', not the Console's.
    expect(words['push.order_ops_cancelled.title']).toBeUndefined();
    expect(shared['push.order_ops_cancelled.title']).toBeUndefined();
    // Every page loads the shared table: it holds only what the shared packages name.
    expect(gzipSync(JSON.stringify(shared)).length).toBeLessThan(25_000);
  });

  it("puts a screen's own words at its top, after a 'use client' line, and leaves wordless files alone", () => {
    const opts = { words: { 'console.a': 'أ', 'console.b': 'ب', 'console.c_1': 'ج' }, shared: { 'console.b': 'ب' }, tablePath: '/x/ar-IQ.json' };
    const out = withOwnWords("'use client';\nimport x from 'y';\nt('console.a'); t('console.b'); t(`console.c_${n}`);\n", opts);
    expect(out.startsWith("'use client';\nimport __driverWords from \"/x/ar-IQ.json\"; Object.assign(__driverWords, {\"console.a\":\"أ\",\"console.c_1\":\"ج\"});\nimport x")).toBe(true);
    expect(withOwnWords("const a = 1;\n", opts)).toBe('const a = 1;\n');
    expect(withOwnWords("t('console.a')", opts).startsWith('import __driverWords')).toBe(true);
  });
});
