import { describe, expect, it } from 'vitest';
import type { QuietRecord } from './controls.repository.js';
import { QUIET_DEFAULTS } from './controls.repository.js';
import { formatHhMm } from './prayer-times.js';
import { checkNewSeason, composeSeason, normalizeSeason, promoHold, seasonDays } from './season.js';

let n = 0;
function row(over: Partial<QuietRecord> & Pick<QuietRecord, 'startsOn' | 'endsOn'>): QuietRecord {
  return { id: `qd_${++n}`, cityId: null, labelAr: 'فترة', setById: 'p_ali', setAt: new Date('2026-10-01T00:00:00Z'), clearedAt: null, clearedById: null, ...QUIET_DEFAULTS, iftarOverrides: {}, ...over };
}
const ramadan = (over: Partial<QuietRecord> = {}) =>
  row({ kind: 'ramadan', startsOn: '2027-02-07', endsOn: '2027-03-09', labelAr: 'رمضان', celebrations: true, sounds: true, promos: true, accent: true, homeCard: true, ...over });
const eid = (over: Partial<QuietRecord> = {}) => row({ kind: 'eid', startsOn: '2027-03-09', endsOn: '2027-03-12', labelAr: 'العيد', celebrations: true, sounds: true, promos: true, accent: true, homeCard: true, ...over });
const quiet = (startsOn: string, endsOn = startsOn) => row({ startsOn, endsOn, labelAr: 'يوم عزاء' });
/** Baghdad wall clock → UTC instant. */
const at = (local: string) => new Date(`${local}:00+03:00`);

describe('composeSeason', () => {
  it('an ordinary day: everything on, kind ordinary, no Ramadan block, no card', () => {
    expect(composeSeason({ rows: [], now: at('2026-10-06T12:00') })).toEqual({
      quiet: false,
      celebrations: true,
      sounds: true,
      promos: true,
      quietUntil: null,
      kind: 'ordinary',
      accent: true,
      ramadan: null,
      homeCard: null,
    });
  });

  it('a quiet day behaves exactly as J1a: everything off until its last day, accent subdued, no card', () => {
    const s = composeSeason({ rows: [quiet('2026-11-13', '2026-11-14')], now: at('2026-11-13T09:00') });
    expect(s).toMatchObject({ quiet: true, celebrations: false, sounds: false, promos: false, quietUntil: '2026-11-14', kind: 'quiet', accent: false, ramadan: null, homeCard: null });
  });

  it('a Ramadan day carries both timetables, the slot 10 minutes before the adhan, and the Ramadan card', () => {
    const s = composeSeason({ rows: [ramadan()], now: at('2027-02-08T12:00') });
    expect(s.kind).toBe('ramadan');
    expect(s.homeCard).toEqual({ kind: 'ramadan', text_ar: null });
    const r = s.ramadan!;
    expect(r.day).toBe('2027-02-08');
    expect(formatHhMm(r.timetables.sunni.iftarAt)).toBe('17:39');
    expect(formatHhMm(r.timetables.shia.iftarAt)).toBe('17:54');
    expect(formatHhMm(r.timetables.sunni.slotAt)).toBe('17:29');
    expect(formatHhMm(r.timetables.shia.slotAt)).toBe('17:44');
    // Never assumed: without a pick there is no single answer.
    expect(r).toMatchObject({ timetable: null, iftarAt: null, suhoorUntil: null });
  });

  it("echoes the person's timetable", () => {
    const r = composeSeason({ rows: [ramadan()], now: at('2027-02-08T12:00'), timetable: 'shia' }).ramadan!;
    expect(r.timetable).toBe('shia');
    expect(r.iftarAt).toEqual(r.timetables.shia.iftarAt);
    expect(r.suhoorUntil).toEqual(r.timetables.shia.suhoorUntil);
  });

  it("suhoor ends at today's fajr before dawn, tomorrow's after it, and there is none after the last iftar", () => {
    const night = composeSeason({ rows: [ramadan()], now: at('2027-02-08T03:00') }).ramadan!;
    expect(night.timetables.sunni.suhoorUntil!.toISOString().slice(0, 10)).toBe('2027-02-08');
    const evening = composeSeason({ rows: [ramadan()], now: at('2027-02-08T20:00') }).ramadan!;
    expect(formatHhMm(evening.timetables.sunni.suhoorUntil!)).toMatch(/^05:2\d$/);
    expect(evening.timetables.sunni.suhoorUntil! > at('2027-02-09T00:00')).toBe(true);
    const lastEvening = composeSeason({ rows: [ramadan()], now: at('2027-03-09T20:00') }).ramadan!;
    expect(lastEvening.timetables.sunni.suhoorUntil).toBeNull();
  });

  it('a quiet day inside Ramadan (19–21 Ramadan) switches everything off but keeps the iftar times and the calm Ramadan card', () => {
    const s = composeSeason({ rows: [ramadan(), quiet('2027-02-26', '2027-02-28')], now: at('2027-02-27T12:00') });
    expect(s).toMatchObject({ kind: 'quiet', quiet: true, celebrations: false, sounds: false, promos: false, accent: false, homeCard: { kind: 'ramadan', text_ar: null } });
    expect(s.ramadan).not.toBeNull();
  });

  it('Eid: the greeting card with switches on; hidden on a quiet day; Ramadan keeps its card on a shared day', () => {
    expect(composeSeason({ rows: [eid()], now: at('2027-03-10T10:00') })).toMatchObject({ kind: 'eid', celebrations: true, homeCard: { kind: 'eid', text_ar: null } });
    expect(composeSeason({ rows: [eid(), quiet('2027-03-10')], now: at('2027-03-10T10:00') })).toMatchObject({ kind: 'quiet', homeCard: null });
    const shared = composeSeason({ rows: [ramadan(), eid()], now: at('2027-03-09T10:00') });
    expect(shared.kind).toBe('eid');
    expect(shared.homeCard?.kind).toBe('ramadan');
  });

  it("a season's own switches and card line reach the apps; a special Friday shows a card only with ops' line", () => {
    const s = composeSeason({ rows: [ramadan({ sounds: false, promos: false, homeCardAr: 'رمضان كريم يا أهل العزيزية' })], now: at('2027-02-10T12:00') });
    expect(s).toMatchObject({ sounds: false, promos: false, celebrations: true, homeCard: { kind: 'ramadan', text_ar: 'رمضان كريم يا أهل العزيزية' } });
    const friday = row({ kind: 'friday_special', startsOn: '2026-10-09', endsOn: '2026-10-09', celebrations: true, sounds: true, promos: true, accent: true, homeCard: true, homeCardAr: 'جمعة مباركة' });
    expect(composeSeason({ rows: [friday], now: at('2026-10-09T09:00') }).homeCard).toEqual({ kind: 'friday_special', text_ar: 'جمعة مباركة' });
  });

  it('city scoping and cleared rows: another city or a removed period changes nothing', () => {
    const other = ramadan({ cityId: 'kut' });
    const cleared = ramadan({ clearedAt: new Date('2027-01-01T00:00:00Z') });
    expect(composeSeason({ rows: [other, cleared], now: at('2027-02-08T12:00'), cityId: 'aziziyah' }).kind).toBe('ordinary');
  });
});

describe('promoHold', () => {
  it('quiet days suppress; a season with offers off suppresses; ordinary days hold nothing', () => {
    expect(promoHold({ rows: [quiet('2026-11-13')], at: at('2026-11-13T12:00') })).toEqual({ reason: 'quiet_day' });
    expect(promoHold({ rows: [ramadan({ promos: false })], at: at('2027-02-08T12:00') })).toEqual({ reason: 'season' });
    expect(promoHold({ rows: [], at: at('2027-02-08T17:30') })).toBeNull();
  });

  it('holds offers from 20 minutes before the earliest iftar until the latest one', () => {
    const rows = [ramadan()];
    expect(promoHold({ rows, at: at('2027-02-08T17:18') })).toBeNull();
    const hold = promoHold({ rows, at: at('2027-02-08T17:19') });
    expect(hold).toMatchObject({ reason: 'iftar' });
    expect(hold && hold.reason === 'iftar' && formatHhMm(hold.until)).toBe('17:54');
    expect(promoHold({ rows, at: at('2027-02-08T17:50') })).toMatchObject({ reason: 'iftar' });
    expect(promoHold({ rows, at: at('2027-02-08T17:54') })).toBeNull();
  });
});

describe('checkNewSeason and normalizeSeason', () => {
  const today = '2026-10-06';
  it('refuses a start in the past and a period longer than its kind allows', () => {
    expect(checkNewSeason({ kind: 'eid', startsOn: '2026-10-05', endsOn: '2026-10-06' }, today, [])).toBe('season_invalid');
    expect(checkNewSeason({ kind: 'eid', startsOn: '2027-03-09', endsOn: '2027-03-14' }, today, [])).toBe('season_invalid');
    expect(checkNewSeason({ kind: 'ramadan', startsOn: '2027-02-07', endsOn: '2027-03-09' }, today, [])).toBeNull();
    expect(checkNewSeason({ kind: 'friday_special', startsOn: '2026-10-09', endsOn: '2026-10-10', homeCardAr: 'جمعة مباركة' }, today, [])).toBe('season_invalid');
  });

  it('a quiet day carries no card line; a special Friday card needs one', () => {
    expect(checkNewSeason({ kind: 'quiet', startsOn: '2026-11-13', endsOn: '2026-11-13', homeCardAr: 'مثلاً' }, today, [])).toBe('season_invalid');
    expect(checkNewSeason({ kind: 'friday_special', startsOn: '2026-10-09', endsOn: '2026-10-09', homeCard: true }, today, [])).toBe('season_invalid');
  });

  it('two periods of the same kind may not overlap in the same place; quiet days may overlap anything', () => {
    const live = [ramadan()];
    expect(checkNewSeason({ kind: 'ramadan', startsOn: '2027-03-01', endsOn: '2027-03-10' }, today, live)).toBe('season_overlap');
    expect(checkNewSeason({ kind: 'ramadan', startsOn: '2027-03-01', endsOn: '2027-03-10', cityId: 'kut' }, today, live)).toBe('season_overlap');
    expect(checkNewSeason({ kind: 'eid', startsOn: '2027-03-09', endsOn: '2027-03-11' }, today, live)).toBeNull();
    expect(checkNewSeason({ kind: 'quiet', startsOn: '2027-02-26', endsOn: '2027-02-28' }, today, live)).toBeNull();
    expect(checkNewSeason({ kind: 'ramadan', startsOn: '2027-03-01', endsOn: '2027-03-10' }, today, [ramadan({ clearedAt: new Date() })])).toBeNull();
  });

  it('normalizes the switches: quiet forces them off; others default on; the Shia offset only on Ramadan', () => {
    expect(normalizeSeason({ kind: 'quiet', celebrations: true })).toMatchObject({ celebrations: false, sounds: false, promos: false, accent: false, homeCard: false, homeCardAr: null, shiaOffsetMin: null });
    expect(normalizeSeason({ kind: 'ramadan', sounds: false, shiaOffsetMin: 12 })).toMatchObject({ celebrations: true, sounds: false, promos: true, accent: true, homeCard: true, shiaOffsetMin: 12 });
    expect(normalizeSeason({ kind: 'eid', shiaOffsetMin: 12 })).toMatchObject({ homeCard: true, shiaOffsetMin: null });
    expect(normalizeSeason({ kind: 'friday_special' })).toMatchObject({ homeCard: false });
    expect(normalizeSeason({ kind: 'friday_special', homeCardAr: 'جمعة مباركة' })).toMatchObject({ homeCard: true, homeCardAr: 'جمعة مباركة' });
  });
});

describe('seasonDays (the Console timetable)', () => {
  it('lists every Ramadan day on both timetables, marking overrides; other kinds list none', () => {
    const days = seasonDays(ramadan({ iftarOverrides: { '2027-02-08': { shia: '17:57' } } }));
    expect(days).toHaveLength(31);
    expect(days[1]).toEqual({ day: '2027-02-08', sunni: { iftar: '17:39', suhoor: '05:26', overridden: false }, shia: { iftar: '17:57', suhoor: '05:26', overridden: true } });
    expect(seasonDays(eid())).toEqual([]);
  });
});
