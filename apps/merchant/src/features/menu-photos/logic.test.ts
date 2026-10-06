import { describe, expect, it } from 'vitest';
import { MENU_PHOTO_RULES, type AdminMenu, type MenuPhotoDish, type MenuPhotoRequestView } from '@driver/contracts';
import { canCancel, canSubmit, EMPTY_DRAFT, menuDishes, shotDishes, splitRequests, stepIndex, toggleDish, toRequestInput, waitingDishes, withNote } from './logic';

function dish(itemId: string, shot: MenuPhotoDish['shot'] = null): MenuPhotoDish {
  return { itemId, nameAr: itemId, categoryAr: null, currentPhotoUrl: null, shot };
}

function view(over: Partial<MenuPhotoRequestView> = {}): MenuPhotoRequestView {
  return {
    requestId: 'mpr_1', merchantOrgId: 'org_k', storeName: 'مطعم خالد', cityId: 'aziziyah', zoneKey: null, pin: null,
    state: 'requested', note: null, wholeMenu: true, dishes: [], photographerName: null, assignedToMe: false, scheduledFor: null,
    requestedAt: new Date('2026-10-07T07:00:00Z'), shotAt: null, closedAt: null, counts: { dishes: 0, proposed: 0, accepted: 0, rejected: 0 }, canAct: true,
    ...over,
  };
}

const shot = (state: 'proposed' | 'accepted' | 'rejected') => ({ shotId: `s_${state}`, itemId: 'x', photoUrl: '/f/x', state, takenAt: new Date('2026-10-07T08:00:00Z') });

describe('menu photos: status steps', () => {
  it('maps states onto طلبنا · موعد التصوير · تصوّرت · خلص; cancelled is off the steps', () => {
    expect(['requested', 'scheduled', 'shot', 'done'].map((s) => stepIndex(s as MenuPhotoRequestView['state']))).toEqual([0, 1, 2, 3]);
    expect(stepIndex('cancelled')).toBeNull();
  });

  it('splits the running request from the closed ones', () => {
    const open = view({ requestId: 'b', state: 'scheduled' });
    const done = view({ requestId: 'a', state: 'done' });
    expect(splitRequests([open, done])).toEqual({ current: open, past: [done] });
    expect(splitRequests([done])).toEqual({ current: null, past: [done] });
  });
});

describe('menu photos: the request form', () => {
  it('whole menu by default; picking dishes needs at least one', () => {
    expect(canSubmit(EMPTY_DRAFT)).toBe(true);
    const some = { ...EMPTY_DRAFT, wholeMenu: false };
    expect(canSubmit(some)).toBe(false);
    expect(canSubmit(toggleDish(some, 'it_1'))).toBe(true);
    expect(toggleDish(toggleDish(some, 'it_1'), 'it_1').itemIds).toEqual([]);
  });

  it('stops at the dish limit and the note limit', () => {
    let d = { ...EMPTY_DRAFT, wholeMenu: false };
    for (let i = 0; i <= MENU_PHOTO_RULES.maxItems; i += 1) d = toggleDish(d, `it_${i}`);
    expect(d.itemIds).toHaveLength(MENU_PHOTO_RULES.maxItems);
    expect(withNote(EMPTY_DRAFT, 'ا'.repeat(MENU_PHOTO_RULES.noteMaxChars + 5)).note).toHaveLength(MENU_PHOTO_RULES.noteMaxChars);
  });

  it('builds the call: no dishes for the whole menu, a blank note is none', () => {
    expect(toRequestInput('org_k', { wholeMenu: true, itemIds: ['it_1'], note: '  ' })).toEqual({ merchantOrgId: 'org_k', itemIds: [] });
    expect(toRequestInput('org_k', { wholeMenu: false, itemIds: ['it_1'], note: ' الأفضل الصبح قبل الزحمة ' })).toEqual({ merchantOrgId: 'org_k', itemIds: ['it_1'], note: 'الأفضل الصبح قبل الزحمة' });
  });

  it('lists dishes without a photo first', () => {
    const menu: AdminMenu = {
      merchantOrgId: 'org_k',
      categories: [{ nameAr: 'مشويات', items: [{ id: 'a', nameAr: 'تكة', photoUrl: '/f/a' }, { id: 'b', nameAr: 'كباب', photoUrl: null }] as AdminMenu['categories'][number]['items'] }],
    };
    expect(menuDishes(menu).map((d) => d.id)).toEqual(['b', 'a']);
    expect(menuDishes(undefined)).toEqual([]);
  });
});

describe('menu photos: review', () => {
  it('waits on proposed photos only once handed over', () => {
    const dishes = [dish('a', shot('proposed')), dish('b', shot('accepted')), dish('c')];
    expect(waitingDishes(view({ state: 'shot', dishes })).map((d) => d.itemId)).toEqual(['a']);
    expect(waitingDishes(view({ state: 'scheduled', dishes }))).toEqual([]);
    expect(shotDishes(view({ state: 'done', dishes })).map((d) => d.itemId)).toEqual(['a', 'b']);
  });

  it('the owner can cancel before the hand-over only', () => {
    expect(canCancel(view({ state: 'requested' }))).toBe(true);
    expect(canCancel(view({ state: 'scheduled' }))).toBe(true);
    expect(canCancel(view({ state: 'shot' }))).toBe(false);
    expect(canCancel(view({ state: 'requested', canAct: false }))).toBe(false);
  });
});
