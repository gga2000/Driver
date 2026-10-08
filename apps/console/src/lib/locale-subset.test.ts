import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { keyRefs, pickMessages, writeConsoleLocales } from '../../scripts/locale-subset.mjs';

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

  it('keeps every Console key and drops other apps, well under the page budget', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-locale-'));
    const { arPath, enPath } = writeConsoleLocales({ repoRoot, outDir });
    const subset = JSON.parse(fs.readFileSync(arPath, 'utf8')) as Record<string, string>;
    expect(fs.readFileSync(enPath, 'utf8')).toBe('{}');
    const consoleKeys = Object.keys(ar).filter((k) => k.startsWith('console.'));
    const missing = consoleKeys.filter((k) => !(k in subset));
    // A Console key the scan can't see is either dead copy (remove it) or built in a way the scan
    // misses (name its prefix as a string); either way it must not be dropped silently.
    expect(missing).toEqual([]);
    expect(subset['console.sup_view_mine']).toBe(ar['console.sup_view_mine']);
    expect(Object.keys(subset).some((k) => k.startsWith('home.'))).toBe(false);
    expect(gzipSync(JSON.stringify(subset)).length).toBeLessThan(60_000);
  });
});
