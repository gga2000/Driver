import { describe, expect, it } from 'vitest';
import { phoneReason } from '@/features/auth/phone-reason';
import { lessonNow } from '@/features/board/learn';
import { dayBefore, dayCardMode, dayFacts, dayTitleKey, ON_TIME_TARGET_PCT, onTimeTone } from '@/features/day/logic';
import { headerSlot, menuNeedsLook } from '@/features/store/header-fit';
import { translate } from './i18n-core';
import { LRI, orderNo, PDI, visibleText } from './order-no';
import { isChunkLoadError, troubleStep } from './screen-trouble';

const ar = (key: Parameters<typeof translate>[0], params?: Record<string, string | number>) => translate(key, params, 'ar-IQ');

describe('d01 · the day card never sits on top of waiting orders', () => {
  it('one line while orders wait, the full card when quiet or closed, nothing when not due', () => {
    expect(dayCardMode({ show: true, waiting: 10, closed: false })).toBe('line');
    expect(dayCardMode({ show: true, waiting: 1, closed: false })).toBe('line');
    expect(dayCardMode({ show: true, waiting: 0, closed: false })).toBe('full');
    expect(dayCardMode({ show: true, waiting: 3, closed: true })).toBe('full');
    expect(dayCardMode({ show: false, waiting: 0, closed: true })).toBe('none');
  });

  it('«البارحة» only for the day before the shop\'s own today', () => {
    expect(dayBefore('2026-10-09')).toBe('2026-10-08');
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    const s = (localDate: string) => ({ localDate, reason: 'day_end' as const });
    expect(dayTitleKey(s('2026-10-09'), '2026-10-09')).toBe('merchant.day.title_today');
    expect(dayTitleKey(s('2026-10-08'), '2026-10-09')).toBe('merchant.day.title_yesterday');
    // Two days back (a tablet asleep over a holiday) is named by its date, never «البارحة».
    expect(dayTitleKey(s('2026-10-07'), '2026-10-09')).toBeNull();
  });

  it('the line reads «البارحة: 35 طلب»', () => {
    expect(ar('merchant.day.line', { title: ar('merchant.day.title_yesterday'), orders: ar('merchant.day.orders', { count: 35 }) })).toBe('البارحة: 35 طلب');
  });
});

describe('d02 · a screen that fails mends itself when the net is back', () => {
  it('knows a screen whose code never arrived', () => {
    const e = new Error('Loading module http://x/_expo/static/js/web/index-1.js failed.');
    e.name = 'AsyncRequireError';
    expect(isChunkLoadError(e)).toBe(true);
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('x is undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('waits offline; back online it re-renders, or reloads the page for missing web code', () => {
    expect(troubleStep({ chunk: true, online: false, web: true })).toBe('wait');
    expect(troubleStep({ chunk: true, online: true, web: true })).toBe('reload');
    expect(troubleStep({ chunk: true, online: true, web: false })).toBe('retry');
    expect(troubleStep({ chunk: false, online: true, web: true })).toBe('retry');
  });
});

describe('d04 · one alarm slot in the header, the rest behind «…»', () => {
  it('the most urgent alert takes the slot, the others go to the menu', () => {
    expect(headerSlot([])).toEqual({ slot: null, rest: [] });
    expect(headerSlot(['sound', 'pass', 'wake'])).toEqual({ slot: 'sound', rest: ['pass', 'wake'] });
  });

  it('«…» has a dot while something inside needs a look', () => {
    expect(menuNeedsLook([])).toBe(false);
    expect(menuNeedsLook([{ tone: 'neutral' }, { tone: 'success' }])).toBe(false);
    expect(menuNeedsLook([{ tone: 'neutral', dot: true }])).toBe(true);
    expect(menuNeedsLook([{ tone: 'danger' }])).toBe(true);
  });
});

describe('d05 · order numbers read «#7477» everywhere', () => {
  it('wraps the number in a left-to-right isolate', () => {
    expect(orderNo('7477')).toBe(`${LRI}#7477${PDI}`);
    expect(visibleText(orderNo(3183))).toBe('#3183');
  });

  it('every Arabic string with an order number isolates it', () => {
    expect(ar('merchant.board.final_many', { seconds: 6, number: '7477' })).toBe(`باقي 6 ثواني على ${LRI}#7477${PDI}`);
    expect(ar('merchant.accept.title', { number: '8406' })).toBe(`اقبل طلب ${LRI}#8406${PDI}`);
    expect(visibleText(ar('merchant.card.number', { number: '9182' }))).toBe('#9182');
  });
});

describe('d06 · the accept button says minutes in full', () => {
  it('«اقبل · 20 دقيقة», never «20 د»', () => {
    expect(ar('merchant.accept.one_tap_full', { minutes: 20 })).toBe('اقبل · 20 دقيقة');
    expect(ar('merchant.accept.one_tap_full', { minutes: 5 })).toBe('اقبل · 5 دقايق');
    expect(translate('merchant.accept.one_tap_full', { minutes: 20 }, 'en')).toBe('Accept · 20 min');
  });
});

describe('d07 · Iraqi minutes everywhere: دقيقة, دقيقتين, 7 دقايق, 15 دقيقة', () => {
  it('any "{minutes} دقيقة" in the merchant copy agrees with the number', () => {
    const since = (minutes: number) => ar('merchant.card.since', { minutes });
    expect([1, 2, 3, 7, 10, 11, 15].map(since)).toEqual(['من دقيقة', 'من دقيقتين', 'من 3 دقايق', 'من 7 دقايق', 'من 10 دقايق', 'من 11 دقيقة', 'من 15 دقيقة']);
    expect(ar('merchant.paused.one', { minutes: 7 })).toBe('الزباين ما يشوفون محلك هسة. النت مقطوع من 7 دقايق. نرجّعك وحدنا أول ما يرجع');
    expect(ar('merchant.card.ready_in', { minutes: 5 })).toBe('جاهز خلال 5 دقايق');
    expect(ar('merchant.accept.busy_note_minutes', { extra: 10, total: 30 })).toBe('وضع الزحمة شغّال: نضيف 10 دقايق، والزبون يشوف 30 دقيقة');
  });
});

describe('d08 · a wrong number says why, under the field', () => {
  it('as soon as it is clear, without waiting for the button', () => {
    expect(phoneReason('', false)).toBeNull();
    expect(phoneReason('0', false)).toBeNull();
    expect(phoneReason('07', false)).toBeNull();
    expect(phoneReason('0770 12', false)).toBeNull();
    expect(phoneReason('01', false)).toBe('rule');
    expect(phoneReason('0123 456 789', false)).toBe('rule');
    expect(phoneReason('0700 000 0000', false)).toBeNull();
    expect(phoneReason('0770 123 4567', false)).toBeNull();
    expect(phoneReason('0770 12', true)).toBe('rule');
  });
});

describe('d09 · the lesson never covers a waiting order', () => {
  it('held while orders wait or the board is loading; shown at the first quiet moment', () => {
    expect(lessonNow({ due: true, waiting: 3, boardLoaded: true })).toBe(false);
    expect(lessonNow({ due: true, waiting: 0, boardLoaded: false })).toBe(false);
    expect(lessonNow({ due: true, waiting: 0, boardLoaded: true })).toBe(true);
    expect(lessonNow({ due: false, waiting: 0, boardLoaded: true })).toBe(false);
  });
});

describe('d10 · a page that does not exist says so', () => {
  it('«ماكو هيچ صفحة» with the way back, and a slow start that says what it is doing', () => {
    expect(ar('merchant.notfound.title')).toBe('ماكو هيچ صفحة');
    expect(ar('merchant.notfound.back')).toBe('رجوع للطلبات');
    expect(ar('merchant.startup.loading')).toBe('دا نجيب طلباتك…');
  });
});

describe('d18 · «وقتك مضبوط» is red only under the target', () => {
  it('60 % is the line: under it red, 71 % plain, 75 % and up green', () => {
    expect(ON_TIME_TARGET_PCT).toBe(60);
    expect([0, 59, 60, 64, 71, 74, 75, 100].map(onTimeTone)).toEqual(['danger', 'danger', 'text', 'text', 'text', 'text', 'success', 'success']);
    const fact = (share: number) => dayFacts({ orders: 30, missed: 0, onTimeShare: share, netIqd: null }).find((f) => f.key === 'on_time')!;
    expect(fact(0.71).tone).toBe('text');
    expect(fact(0.594).tone).toBe('danger');
    expect(fact(0.596).tone).toBe('text'); // rounds to 60 %, what the card shows
  });
});
