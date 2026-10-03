import { describe, expect, it } from 'vitest';
import { locales } from '@driver/i18n';

const ar = locales['ar-IQ'] as Record<string, string>;
const en = locales.en as Record<string, string>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** The Partner app's copy (`partner.*`) against the voice guide (docs/specs/2026-10-02-voice-and-microcopy.md). */
describe('partner copy (voice guide)', () => {
  const keys = Object.keys(ar).filter((k) => k.startsWith('partner.'));

  it('ar-IQ and en have the same partner keys and the same placeholders', () => {
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) {
      expect(en[k], k).toBeTypeOf('string');
      expect(placeholders(en[k]!), k).toEqual(placeholders(ar[k]!));
    }
  });

  it('Western digits, no emojis, no MSA particles, دينار never د.ع', () => {
    // Whole words ("لقد" is inside "القديم"); phrases as substrings.
    const words = ['يرجى', 'سوف', 'لقد', 'عزيزي', 'حسناً', 'المندوب'];
    const phrases = ['قم ب', 'لا يوجد', 'د.ع'];
    for (const k of keys) {
      const v = ar[k]!;
      expect(v, k).not.toMatch(/[٠-٩]/);
      expect(v, k).not.toMatch(/\p{Extended_Pictographic}/u);
      const tokens = new Set(v.split(/[\s،.:؟?!()]+/));
      for (const w of words) expect(tokens.has(w), `${k}: ${w}`).toBe(false);
      for (const p of phrases) expect(v.includes(p), `${k}: ${p}`).toBe(false);
    }
  });

  it('amounts next to a placeholder carry the currency (fleet invites, top-up, batch offer)', () => {
    for (const k of [
      'partner.job_topup_cap',
      'partner.job_topup_cap_after',
      'partner.job_topup_done_cap',
      'partner.offer_batch_title',
      'partner.ic_announce_front',
    ]) {
      expect(ar[k], k).toContain('دينار');
      expect(en[k], k).toContain('IQD');
    }
  });
});
