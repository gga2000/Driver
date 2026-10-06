import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUES, cueRoute, momentBehavior, momentChannelId, MOMENT_SOUND_FILES } from './moment-sound';

describe('moment sounds on a silent Android (f7, L-24)', () => {
  it('Android plays through the ring stream; iOS and web through the media player (expo-audio / HTML audio)', () => {
    expect(cueRoute('android')).toBe('ring');
    expect(cueRoute('ios')).toBe('media');
    expect(cueRoute('web')).toBe('media');
  });

  it('one channel per cue, and only moment notifications are silenced to "sound, no alert"', () => {
    expect(momentChannelId('near')).toBe('moment_near');
    expect(momentBehavior({ moment: 'near' })).toEqual({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: true, shouldSetBadge: false });
    expect(momentBehavior({ moment: 'party' })).toBeNull();
    expect(momentBehavior({ deliveryId: 'd1' })).toBeNull();
    expect(momentBehavior(null)).toBeNull();
  });

  it('every cue file is a valid Android raw resource and is bundled by the notifications plugin', () => {
    const app = JSON.parse(readFileSync(join(__dirname, '../../app.json'), 'utf8')) as { expo: { plugins: unknown[] } };
    const plugin = app.expo.plugins.find((p): p is [string, { sounds?: string[] }] => Array.isArray(p) && p[0] === 'expo-notifications');
    const bundled = (plugin?.[1].sounds ?? []).map((s) => s.split('/').pop());
    for (const cue of CUES) {
      expect(MOMENT_SOUND_FILES[cue]).toMatch(/^[a-z][a-z0-9_]*\.wav$/);
      expect(bundled).toContain(MOMENT_SOUND_FILES[cue]);
    }
  });
});
