import { describe, expect, it } from 'vitest';
import { locales } from './translate.js';
import { BANNED_TERMS, voiceProblems } from './voice.js';

describe('one vocabulary (audit S-09, glossary §4)', () => {
  it('the shared Arabic table uses no banned word, no Eastern digit, no stray "!"', () => {
    const problems = voiceProblems(locales['ar-IQ'] as Record<string, string>);
    expect(problems.map((p) => `${p.key}: ${p.problem} — ${p.value}`)).toEqual([]);
  });

  it('catches each glossary rule', () => {
    const cases: Record<string, string> = {
      a: 'خلي المندوب يقرا الرمز',
      b: 'الموزّع يتصل بيك',
      c: 'درايفر ماركت',
      d: 'ماكو هسه',
      e: 'متأخر {minutes} د',
      f: 'وصل!',
      g: 'المطعم مغلق',
      h: 'وصلت حد النقد',
      i: 'حالة الطلب تغيّرت. حدّث الصفحة',
      'trip.x': 'الرحلة ماشية',
      j: 'عندك {minutes} دقايق',
      k: 'توفّر {amount}',
    };
    const found = voiceProblems(cases).map((p) => p.key);
    expect(found.sort()).toEqual(Object.keys(cases).sort());
  });

  it('leaves fine Iraqi copy alone (العزيزية, القدام, الطلبات, دقيقة, هسة, رحلة on الرجعة)', () => {
    const ok = {
      a: 'سوق العزيزية لباب بيتك',
      b: 'القدام فاضي +{amount} دينار',
      'console.x': 'فرق {amount}',
      c: 'متأخر {minutes} دقيقة',
      d: 'ماكو دليفري عنده كاش هسة',
      'rajaa.x': 'رحلتك باچر الساعة 7:30 ص',
      e: 'الزبون ↔ الدليفري',
      'time.minutes_short': '{n} د',
    };
    expect(voiceProblems(ok)).toEqual([]);
  });

  it('every rule says what to write instead', () => {
    for (const [term, rule] of Object.entries(BANNED_TERMS)) expect(rule.use.length, term).toBeGreaterThan(0);
  });
});
