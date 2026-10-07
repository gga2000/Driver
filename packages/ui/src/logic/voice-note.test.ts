import { describe, expect, it } from 'vitest';
import { VOICE_RULES } from '@driver/contracts';
import { pendingKind, type PendingMessage } from './chat';
import { formatVoiceClock, VOICE_CANCEL_SLIDE_PX, voiceAtLimit, voiceContentType, voiceDurationSec, voiceSlideCancels, voiceSlideProgress } from './voice-note';

describe('voice notes (ride ideas n7/n8)', () => {
  it('cancels on a slide towards the start side: the right in Arabic, the left in English', () => {
    expect(voiceSlideProgress(VOICE_CANCEL_SLIDE_PX / 2, true)).toBe(0.5);
    expect(voiceSlideCancels(VOICE_CANCEL_SLIDE_PX, true)).toBe(true);
    expect(voiceSlideCancels(-VOICE_CANCEL_SLIDE_PX, true)).toBe(false);
    expect(voiceSlideProgress(-VOICE_CANCEL_SLIDE_PX * 3, true)).toBe(0);
    expect(voiceSlideCancels(-VOICE_CANCEL_SLIDE_PX, false)).toBe(true);
    expect(voiceSlideProgress(VOICE_CANCEL_SLIDE_PX * 2, false)).toBe(0);
  });

  it('sends whole seconds rounded up, 1 to 60; stops at one minute', () => {
    expect(voiceDurationSec(400)).toBe(1);
    expect(voiceDurationSec(7_001)).toBe(8);
    expect(voiceDurationSec(75_000)).toBe(VOICE_RULES.maxSec);
    expect(voiceAtLimit(59_999)).toBe(false);
    expect(voiceAtLimit(60_000)).toBe(true);
  });

  it('shows m:ss with Western digits', () => {
    expect(formatVoiceClock(0)).toBe('0:00');
    expect(formatVoiceClock(7.9)).toBe('0:07');
    expect(formatVoiceClock(60)).toBe('1:00');
  });

  it('uploads as the type the server sniffs: MIME without codecs, else the file extension', () => {
    expect(voiceContentType('audio/webm;codecs=opus', 'blob:x')).toBe('audio/webm');
    expect(voiceContentType('audio/ogg; codecs=opus', 'blob:x')).toBe('audio/ogg');
    expect(voiceContentType('audio/mp4', 'blob:x')).toBe('audio/mp4');
    expect(voiceContentType('audio/x-m4a', 'file:///a.m4a')).toBe('audio/mp4');
    expect(voiceContentType(null, 'file:///data/cache/recording-1.m4a')).toBe('audio/mp4');
    expect(voiceContentType('', 'file:///a.aac')).toBe('audio/aac');
    expect(voiceContentType('audio/wav', 'file:///a.wav')).toBeNull();
    expect(voiceContentType(undefined, 'file:///a.3gp')).toBeNull();
  });

  it('a pending voice note draws as a voice bubble, uploaded or not', () => {
    const base: PendingMessage = { clientId: 'm-1', body: null, text: null, localPhotoUri: null, voice: { clip: { uri: 'blob:1', durationMs: 3000, contentType: 'audio/webm' }, durationSec: 3 }, status: 'sending', createdAt: new Date() };
    expect(pendingKind(base)).toBe('voice');
    expect(pendingKind({ ...base, body: { voiceUploadId: 'up_1', durationSec: 3 } })).toBe('voice');
    expect(pendingKind({ ...base, voice: null, body: { photoUploadId: 'up_2' } })).toBe('photo');
    expect(pendingKind({ ...base, voice: null, body: { location: { lat: 1, lng: 2 } } })).toBe('location');
  });
});
