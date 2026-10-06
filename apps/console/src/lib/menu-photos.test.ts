import { describe, expect, it } from 'vitest';
import { hasKey } from '@driver/i18n';
import { MENU_PHOTO_STATE_KEY, menuPhotoTone, untakenCount } from './menu-photos';

describe('menu photo queue', () => {
  it('shows a request nobody took as needing a person, finished ones as done', () => {
    expect(menuPhotoTone('requested')).toBe('ready');
    expect(menuPhotoTone('scheduled')).toBe('live');
    expect(menuPhotoTone('shot')).toBe('live');
    expect(menuPhotoTone('done')).toBe('done');
    expect(menuPhotoTone('cancelled')).toBe('neutral');
  });

  it('every state has words', () => {
    for (const key of Object.values(MENU_PHOTO_STATE_KEY)) expect(hasKey(key)).toBe(true);
  });

  it('counts the requests still without a visit', () => {
    expect(untakenCount([{ state: 'requested' }, { state: 'scheduled' }, { state: 'requested' }, { state: 'done' }])).toBe(2);
  });
});
