import { describe, expect, it } from 'vitest';
import { codeComplete, needsStartCode, PAD_KEYS, typeKey } from './start-code';

describe('the trip code pad (ride s1)', () => {
  it('only a ride pickup still to do that the server marked asks for it', () => {
    expect(needsStartCode({ type: 'pickup', state: 'arrived', startCodeRequired: true }, true)).toBe(true);
    expect(needsStartCode({ type: 'pickup', state: 'arrived', startCodeRequired: true }, false)).toBe(false);
    expect(needsStartCode({ type: 'pickup', state: 'arrived' }, true)).toBe(false);
    expect(needsStartCode({ type: 'dropoff', state: 'arrived', startCodeRequired: true }, true)).toBe(false);
    expect(needsStartCode({ type: 'pickup', state: 'completed', startCodeRequired: true }, true)).toBe(false);
    expect(needsStartCode(null, true)).toBe(false);
  });
  it('types up to 4 digits, takes one back, ignores anything else', () => {
    let code = '';
    for (const k of ['4', '8', '2', '1', '7']) code = typeKey(code, k);
    expect(code).toBe('4821');
    expect(codeComplete(code)).toBe(true);
    code = typeKey(code, 'back');
    expect(code).toBe('482');
    expect(codeComplete(code)).toBe(false);
    expect(typeKey(code, '')).toBe('482');
    expect(typeKey('', 'back')).toBe('');
  });
  it('the pad has the ten digits and a back key', () => {
    expect(PAD_KEYS.filter((k) => /^\d$/.test(k)).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(PAD_KEYS).toContain('back');
  });
});
