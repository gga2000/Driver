import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type Refs = { exact: Set<string>; prefixes: Set<string> };
const { keyRefs, writeMerchantLocales } = require('../../../customer/scripts/locale-subset.cjs') as {
  keyRefs: (source: string, into: Refs) => Refs;
  writeMerchantLocales: (o: { repoRoot: string; outDir: string }) => Record<'ar-IQ' | 'en', string>;
};

const repoRoot = resolve(import.meta.dirname, '../../../..');

/** Every key this app's own code names (whole), as the subset script reads it. */
function merchantRefs(): Refs {
  const refs: Refs = { exact: new Set(), prefixes: new Set() };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|js)$/.test(name) && !name.includes('.test.')) keyRefs(readFileSync(p, 'utf8'), refs);
    }
  };
  walk(join(repoRoot, 'apps/merchant/app'));
  walk(join(repoRoot, 'apps/merchant/src'));
  return refs;
}

describe('merchant locale subset (speed s1)', () => {
  it('keeps every shared key the app names and every shared merchant.* string, in both languages, and drops most of the rest', () => {
    const out = writeMerchantLocales({ repoRoot, outDir: mkdtempSync(join(tmpdir(), 'merchant-locale-')) });
    const ar = JSON.parse(readFileSync(out['ar-IQ'], 'utf8')) as Record<string, string>;
    const en = JSON.parse(readFileSync(out.en, 'utf8')) as Record<string, string>;
    const full = JSON.parse(readFileSync(join(repoRoot, 'packages/i18n/src/locales/ar-IQ.json'), 'utf8')) as Record<string, string>;
    for (const key of Object.keys(full).filter((k) => k.startsWith('merchant.') || k.startsWith('onboarding.') || k.startsWith('action.'))) expect(ar[key], key).toBe(full[key]);
    const plural = /_(zero|one|two|few|many|other)$/;
    const forms = new Map<string, string[]>();
    for (const k of Object.keys(full)) if (plural.test(k)) forms.set(k.replace(plural, ''), [...(forms.get(k.replace(plural, '')) ?? []), k]);
    for (const key of merchantRefs().exact) {
      if (key in full) expect(ar[key], key).toBe(full[key]);
      for (const form of forms.get(key) ?? []) expect(ar[form], form).toBe(full[form]);
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    expect(Object.keys(ar).length).toBeLessThan(Object.keys(full).length * 0.5);
  }, 30_000);
});
