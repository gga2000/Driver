import { VOICE_RULES, VoiceContentType } from '@driver/contracts';

/**
 * Pure voice-note logic of the chat (ride ideas n7/n8; no React Native imports, unit-tested): the
 * hold-to-record gesture's thresholds, the clock on the bubble and the recorder bar, and the content
 * type a recording is uploaded as.
 */

/** A hold shorter than this is a tap: nothing is sent, the hint says to hold. */
export const VOICE_MIN_MS = 600;
/** Sliding this far towards the start side (right in Arabic) cancels the recording. */
export const VOICE_CANCEL_SLIDE_PX = 96;

/** A recording on the phone, ready to upload. */
export interface VoiceClip {
  /** `file://…` on a phone, `blob:…` in a browser. */
  uri: string;
  durationMs: number;
  contentType: VoiceContentType;
}

/**
 * How far (0–1) the finger has slid towards the start side: in RTL the start is the right, so a
 * positive dx; in LTR a negative one. Sliding the other way counts as nothing.
 */
export function voiceSlideProgress(dx: number, rtl: boolean): number {
  const towardsStart = rtl ? dx : -dx;
  return Math.max(0, Math.min(1, towardsStart / VOICE_CANCEL_SLIDE_PX));
}

/** The slide has reached the cancel line. */
export function voiceSlideCancels(dx: number, rtl: boolean): boolean {
  return voiceSlideProgress(dx, rtl) >= 1;
}

/** The length sent to the server: whole seconds rounded up, 1–`VOICE_RULES.maxSec`. */
export function voiceDurationSec(durationMs: number): number {
  return Math.max(1, Math.min(VOICE_RULES.maxSec, Math.ceil(durationMs / 1000)));
}

/** The recording reached the one-minute cap: stop and send it. */
export function voiceAtLimit(elapsedMs: number): boolean {
  return elapsedMs >= VOICE_RULES.maxSec * 1000;
}

/** `m:ss` with Western digits ("0:07", "1:00"): the bubble and the recorder bar. */
export function formatVoiceClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const EXT_TYPES: Record<string, VoiceContentType> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
};

/**
 * The upload type of a recording: the blob's MIME type without codecs ("audio/webm;codecs=opus" →
 * "audio/webm"; "audio/x-m4a" → "audio/mp4"), else the file extension (native recorders write .m4a).
 * Null when it is nothing the server takes.
 */
export function voiceContentType(
  mime: string | null | undefined,
  uri: string,
): VoiceContentType | null {
  const base = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  const aliased =
    base === 'audio/x-m4a' || base === 'audio/m4a' || base === 'video/mp4'
      ? 'audio/mp4'
      : base === 'audio/x-aac'
        ? 'audio/aac'
        : base;
  const parsed = VoiceContentType.safeParse(aliased);
  if (parsed.success) return parsed.data;
  if (base) return null;
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri)?.[1]?.toLowerCase();
  return ext ? (EXT_TYPES[ext] ?? null) : null;
}

/** Where a press on the mic leads, decided once the permission is known. */
export type MicPermission = 'granted' | 'undetermined' | 'denied';
