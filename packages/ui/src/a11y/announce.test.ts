import { describe, expect, it } from 'vitest';
import { shouldAnnounce } from './announce';

describe('useAnnounce (REL-17)', () => {
  it('announces explicitly only on iOS, where VoiceOver ignores live regions', () => {
    expect(shouldAnnounce('ios')).toBe(true);
    expect(shouldAnnounce('android')).toBe(false);
    expect(shouldAnnounce('web')).toBe(false);
  });
});
