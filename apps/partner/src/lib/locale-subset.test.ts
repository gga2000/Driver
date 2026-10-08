import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type Refs = { exact: Set<string>; prefixes: Set<string> };
const { dropFor, pickMessages, writePartnerLocales } = require('../../../customer/scripts/locale-subset.cjs') as {
  dropFor: (m: Record<string, string>, refs: Refs, always: Set<string>, unnamed: boolean) => Set<string>;
  pickMessages: (m: Record<string, string>, refs: Refs, drop: Set<string>) => Record<string, string>;
  writePartnerLocales: (o: { repoRoot: string; outDir: string }) => Record<'ar-IQ' | 'en', string>;
};

describe('partner locale subset (speed s1)', () => {
  it('drops namespaces the app never names, keeps the ones it names whole and named keys anywhere', () => {
    const table = { 'partner.a': '1', 'rajaa.route': '2', 'rajaa.other': '3', 'food.menu': '4', 'console.apr': '5', 'console.shared': '6' };
    const refs: Refs = { exact: new Set(['rajaa.route', 'console.shared']), prefixes: new Set(['partner.']) };
    const drop = dropFor(table, refs, new Set(['console']), true);
    expect([...drop].sort()).toEqual(['console', 'food']);
    expect(Object.keys(pickMessages(table, refs, drop)).sort()).toEqual(['console.shared', 'partner.a', 'rajaa.other', 'rajaa.route']);
  });

  it('the real tables keep every partner string and both languages stay in step', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..');
    const out = writePartnerLocales({ repoRoot, outDir: mkdtempSync(join(tmpdir(), 'partner-locale-')) });
    const ar = JSON.parse(readFileSync(out['ar-IQ'], 'utf8')) as Record<string, string>;
    const en = JSON.parse(readFileSync(out.en, 'utf8')) as Record<string, string>;
    const full = JSON.parse(readFileSync(join(repoRoot, 'packages/i18n/src/locales/ar-IQ.json'), 'utf8')) as Record<string, string>;
    for (const key of Object.keys(full).filter((k) => k.startsWith('partner.'))) expect(ar[key], key).toBe(full[key]);
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    expect(Object.keys(ar).length).toBeLessThan(Object.keys(full).length * 0.7);
  });
});
