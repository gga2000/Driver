import { describe, expect, it } from 'vitest';
import { FollowDishInput, KITCHEN_STORY_RULES, POT_RULES, SetKitchenStoryInput, SetPotInput, storyLines, usualBandOf } from './habits-io.js';
import { DEFAULT_NOTIFY_PREFERENCES, NOTIFY_TEMPLATES, PROMOTIONAL_CATEGORIES, preferenceFor } from './notify-io.js';

describe('SetPotInput', () => {
  it('takes a dish with an optional note and an until time', () => {
    expect(SetPotInput.parse({ merchantOrgId: 'm', itemId: 'i', note: '  ويا تمن عنبر ', until: '16:00' })).toEqual({ merchantOrgId: 'm', itemId: 'i', note: 'ويا تمن عنبر', until: '16:00' });
  });
  it('turns a blank note into none', () => {
    expect(SetPotInput.parse({ merchantOrgId: 'm', itemId: 'i', note: '   ' }).note).toBeNull();
  });
  it('refuses a long note and a malformed time', () => {
    expect(SetPotInput.safeParse({ merchantOrgId: 'm', itemId: 'i', note: 'ا'.repeat(POT_RULES.noteMaxChars + 1) }).success).toBe(false);
    expect(SetPotInput.safeParse({ merchantOrgId: 'm', itemId: 'i', until: '4pm' }).success).toBe(false);
    expect(SetPotInput.safeParse({ merchantOrgId: 'm', itemId: 'i', until: '24:00' }).success).toBe(false);
  });
});

describe('SetKitchenStoryInput', () => {
  const base = { merchantOrgId: 'm', sinceYear: 2009, shown: true };
  it('takes one to three lines and a year', () => {
    expect(SetKitchenStoryInput.parse({ ...base, text: 'الكباب على الفحم من أيام أبوي.\nنفس الطعم.' }).text).toBe('الكباب على الفحم من أيام أبوي.\nنفس الطعم.');
  });
  it('refuses four lines, too many characters, and a year out of range', () => {
    expect(SetKitchenStoryInput.safeParse({ ...base, text: 'أ\nب\nج\nد' }).success).toBe(false);
    expect(SetKitchenStoryInput.safeParse({ ...base, text: 'ا'.repeat(KITCHEN_STORY_RULES.textMaxChars + 1) }).success).toBe(false);
    expect(SetKitchenStoryInput.safeParse({ ...base, text: 'قصة', sinceYear: 1850 }).success).toBe(false);
  });
  it('cannot show a story that is not there', () => {
    expect(SetKitchenStoryInput.safeParse({ ...base, text: null }).success).toBe(false);
    expect(SetKitchenStoryInput.safeParse({ ...base, text: null, shown: false }).success).toBe(true);
  });
  it('counts only lines with words', () => {
    expect(storyLines('أ\n\n  \nب')).toBe(2);
  });
});

describe('FollowDishInput', () => {
  it('needs the kitchen, the dish and on/off', () => {
    expect(FollowDishInput.safeParse({ merchantOrgId: 'm', itemId: 'i', on: true }).success).toBe(true);
    expect(FollowDishInput.safeParse({ merchantOrgId: 'm', itemId: '', on: true }).success).toBe(false);
  });
});

describe('usualBandOf', () => {
  it.each([
    [3, 'late'],
    [4, 'morning'],
    [10, 'morning'],
    [11, 'lunch'],
    [15, 'lunch'],
    [16, 'evening'],
    [22, 'evening'],
    [23, 'late'],
    [0, 'late'],
  ] as const)('%i → %s', (hour, band) => {
    expect(usualBandOf(hour)).toBe(band);
  });
});

describe('the dish-pot push', () => {
  it('has its own switch, on by default, and is promotional (quiet days, quiet hours)', () => {
    const def = NOTIFY_TEMPLATES.dish_pot_today;
    expect(def.category).toBe('dish_pot');
    expect(preferenceFor(def.category, 'push')).toBe('dishPots');
    expect(DEFAULT_NOTIFY_PREFERENCES.dishPots).toBe(true);
    expect(PROMOTIONAL_CATEGORIES.has('dish_pot')).toBe(true);
    expect(def.quietHours).toBe('defer');
    expect(def.push?.deepLink).toBe('driver://restaurant/{merchantOrgId}');
  });
});
