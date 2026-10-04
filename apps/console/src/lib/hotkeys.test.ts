import { describe, expect, it } from 'vitest';
import { eventKey, isTypingTarget, matches, parseKey, stepIndex, type KeyLike } from './hotkeys';
import { NAV, visibleNav } from './nav';

const ev = (key: string, o: Partial<KeyLike> = {}): KeyLike => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...o,
});

describe('parseKey', () => {
  it('reads modifiers and aliases', () => {
    expect(parseKey('mod+k')).toEqual({ key: 'k', mod: true, shift: false, alt: false });
    expect(parseKey('mod+enter')).toEqual({ key: 'enter', mod: true, shift: false, alt: false });
    expect(parseKey('shift+slash')).toEqual({ key: '/', mod: false, shift: true, alt: false });
    expect(parseKey('esc').key).toBe('escape');
  });
});

describe('matches', () => {
  it('mod is ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(matches(ev('k', { metaKey: true }), parseKey('mod+k'), true)).toBe(true);
    expect(matches(ev('k', { ctrlKey: true }), parseKey('mod+k'), true)).toBe(false);
    expect(matches(ev('k', { ctrlKey: true }), parseKey('mod+k'), false)).toBe(true);
  });
  it('plain keys need no modifier', () => {
    expect(matches(ev('j'), parseKey('j'), false)).toBe(true);
    expect(matches(ev('j', { ctrlKey: true }), parseKey('j'), false)).toBe(false);
    expect(matches(ev('J', { shiftKey: true }), parseKey('j'), false)).toBe(false);
  });
  it('works on an Arabic keyboard layout through the physical key', () => {
    // J on an Arabic layout types "ت"; the code is still KeyJ.
    expect(eventKey(ev('ت', { code: 'KeyJ' }))).toBe('j');
    expect(matches(ev('ت', { code: 'KeyJ' }), parseKey('j'), false)).toBe(true);
  });
  it('"?" accepts shift+/', () => {
    expect(matches(ev('?', { shiftKey: true, code: 'Slash' }), parseKey('?'), false)).toBe(true);
    expect(matches(ev('؟', { shiftKey: true, code: 'Slash' }), parseKey('?'), false)).toBe(true);
  });
  it('mod+enter sends', () => {
    expect(matches(ev('Enter', { ctrlKey: true }), parseKey('mod+enter'), false)).toBe(true);
    expect(matches(ev('Enter'), parseKey('mod+enter'), false)).toBe(false);
  });
});

describe('isTypingTarget', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) =>
    ({ tagName, ...extra }) as unknown as EventTarget;
  it('fields swallow plain keys; buttons and checkboxes do not', () => {
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('stepIndex (j/k)', () => {
  it('starts at the top or bottom and clamps', () => {
    expect(stepIndex(-1, 5, 1)).toBe(0);
    expect(stepIndex(-1, 5, -1)).toBe(4);
    expect(stepIndex(4, 5, 1)).toBe(4);
    expect(stepIndex(0, 5, -1)).toBe(0);
    expect(stepIndex(2, 5, 1)).toBe(3);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe('visibleNav (K-08)', () => {
  it('shows everything until roles load', () => {
    expect(visibleNav(new Set(), false).flatMap((g) => g.items)).toHaveLength(NAV.length);
  });
  it('a support agent sees support and approvals but not dispatch or the cash desk', () => {
    const hrefs = visibleNav(new Set(['support']), true).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain('/support');
    expect(hrefs).toContain('/approvals');
    expect(hrefs).not.toContain('/dispatch');
    expect(hrefs).not.toContain('/finance');
  });
  it('field ops sees approvals and the cash round only; empty groups disappear', () => {
    const groups = visibleNav(new Set(['field_ops']), true);
    expect(groups.flatMap((g) => g.items.map((i) => i.href)).sort()).toEqual([
      '/approvals',
      '/finance',
    ]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
  it('every page has a unique jump key', () => {
    const keys = NAV.map((i) => i.jump);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
