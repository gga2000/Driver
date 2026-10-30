import { describe, expect, it } from 'vitest';
import { parcelStage, pinComplete, typePin } from './logic';

const view = { refused: false, pinVerified: false, pinTriesLeft: 5 };

describe('parcelStage', () => {
  it('asks for the pickup photo only once he is at the sender', () => {
    expect(parcelStage(view, { type: 'pickup', state: 'pending' })).toBe('none');
    expect(parcelStage(view, { type: 'pickup', state: 'arrived' })).toBe('pickup');
    expect(parcelStage(view, { type: 'pickup', state: 'completed' })).toBe('none');
  });

  it('asks for the code at the receiver’s door, says so on the way', () => {
    expect(parcelStage(view, { type: 'dropoff', state: 'pending' })).toBe('to_door');
    expect(parcelStage(view, { type: 'dropoff', state: 'arrived' })).toBe('pin');
  });

  it('a verified code lets the hand-over continue; no tries left locks it', () => {
    expect(parcelStage({ ...view, pinVerified: true }, { type: 'dropoff', state: 'arrived' })).toBe('verified');
    expect(parcelStage({ ...view, pinTriesLeft: 0 }, { type: 'dropoff', state: 'arrived' })).toBe('locked');
  });

  it('a refusal wins over everything', () => {
    expect(parcelStage({ ...view, refused: true }, { type: 'dropoff', state: 'arrived' })).toBe('refused');
    expect(parcelStage({ ...view, refused: true }, null)).toBe('refused');
  });
});

describe('typePin', () => {
  it('takes four digits, ignores the rest, deletes with back', () => {
    let pin = '';
    for (const k of ['1', 'x', '2', '3', '4', '5']) pin = typePin(pin, k);
    expect(pin).toBe('1234');
    expect(pinComplete(pin)).toBe(true);
    expect(typePin(pin, 'back')).toBe('123');
    expect(pinComplete('123')).toBe(false);
  });
});
