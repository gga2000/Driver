import { describe, expect, it } from 'vitest';
import { bestLibraryDish, doorsOf, fridayPrayer, greetingName, menuScore, shouldLand, shutterFraction, shutterOpens, STEP_HREF, stepMinutes, toggleDoor, voiceOf } from './logic';

const LIB = [
  { slug: 'kebab', nameAr: 'كباب', words: ['كباب'], section: 'grill' as const },
  { slug: 'lentil-soup', nameAr: 'شوربة عدس', words: ['عدس', 'شوربة'], section: 'breakfast' as const },
  { slug: 'tea', nameAr: 'چاي', words: ['چاي', 'شاي'], section: 'drinks' as const },
];

describe('setup in the app', () => {
  it('every step opens a screen; money sits on the counter list', () => {
    expect(STEP_HREF.money).toBe('/setup/counter');
    expect(STEP_HREF.pickup).toBe('/pickup-spot');
    expect(Object.keys(STEP_HREF)).toHaveLength(7);
  });

  it('the kind sets the words: drinks only reads «محلك», anything with food «مطعمك»', () => {
    expect(voiceOf(['cafe'])).toBe('drinks');
    expect(voiceOf(['cold', 'cafe'])).toBe('drinks');
    expect(voiceOf(['meal', 'cafe'])).toBe('food');
    expect(voiceOf([])).toBe('food');
  });

  it('his confirmed doors win over field ops’ pick; tapping keeps the doors’ order', () => {
    expect(doorsOf({ kinds: { confirmed: null, suggested: ['meal'] } })).toEqual(['meal']);
    expect(doorsOf({ kinds: { confirmed: ['cafe'], suggested: ['meal'] } })).toEqual(['cafe']);
    expect(toggleDoor(['sweet'], 'meal')).toEqual(['meal', 'sweet']);
    expect(toggleDoor(['meal', 'sweet'], 'meal')).toEqual(['sweet']);
  });

  it('greets «أبو حسن» whole, otherwise the first name, nothing without a name', () => {
    expect(greetingName('أبو حسن')).toBe('أبو حسن');
    expect(greetingName('  ام علي الكعبي ')).toBe('ام علي');
    expect(greetingName('خالد جاسم')).toBe('خالد');
    expect(greetingName('')).toBeNull();
    expect(greetingName(null)).toBeNull();
  });

  it('lands an owner on setup once a session, never staff, never a live shop', () => {
    expect(shouldLand({ owner: true, setup: { live: false }, landed: false })).toBe(true);
    expect(shouldLand({ owner: true, setup: { live: false }, landed: true })).toBe(false);
    expect(shouldLand({ owner: false, setup: { live: false }, landed: false })).toBe(false);
    expect(shouldLand({ owner: true, setup: { live: true }, landed: false })).toBe(false);
    expect(shouldLand({ owner: true, setup: null, landed: false })).toBe(false);
  });

  it('minutes on a step round up and never read 0 while it is open', () => {
    expect(stepMinutes(0)).toBe(0);
    expect(stepMinutes(10)).toBe(1);
    expect(stepMinutes(160)).toBe(3);
  });

  it('menu score counts every photo, library ones too', () => {
    expect(menuScore([{ photoUrl: 'a' }, { photoUrl: null }, { photoUrl: 'b' }])).toEqual({ total: 3, withPhoto: 2, missing: 1 });
    expect(menuScore([])).toEqual({ total: 0, withPhoto: 0, missing: 0 });
  });

  it('matches a read dish to the closest library photo', () => {
    expect(bestLibraryDish(LIB, 'شوربة عدس', null)?.slug).toBe('lentil-soup');
    expect(bestLibraryDish(LIB, 'كباب عراقي', 'مشويات')?.slug).toBe('kebab');
    expect(bestLibraryDish(LIB, 'شاي حامض', null)?.slug).toBe('tea');
    expect(bestLibraryDish(LIB, 'سندويش فلافل خاص', null)).toBeNull();
  });

  it('the shutter follows the finger up and opens past 60 % or on a flick', () => {
    expect(shutterFraction(-120, 240)).toBe(0.5);
    expect(shutterFraction(50, 240)).toBe(0);
    expect(shutterFraction(-500, 240)).toBe(1);
    expect(shutterFraction(-10, 0)).toBe(0);
    expect(shutterOpens(0.65, 0)).toBe(true);
    expect(shutterOpens(0.4, -900)).toBe(true);
    expect(shutterOpens(0.4, -100)).toBe(false);
  });

  it('finds the Friday prayer among the pauses', () => {
    expect(fridayPrayer([{ dow: 5, start: '11:45', end: '13:15' }])).toEqual({ start: '11:45', end: '13:15' });
    expect(fridayPrayer([])).toBeNull();
  });
});
