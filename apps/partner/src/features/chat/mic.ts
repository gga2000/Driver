import { requestRecordingPermissionsAsync } from 'expo-audio';
import type { VoiceContentType } from '@driver/contracts';
import { voiceContentType, type MicPermission } from '@driver/ui';

/**
 * The browser's microphone (the web build; phones use `mic.native.ts`). Permissions are read through
 * `navigator.permissions` without prompting; Firefox cannot be asked that, so a grant in this tab
 * is remembered here instead. MediaRecorder writes WebM (Chrome), Ogg (Firefox) or MP4 (Safari):
 * the blob says which.
 */
let grantedHere = false;

export async function micPermission(): Promise<MicPermission> {
  if (grantedHere) return 'granted';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'granted') grantedHere = true;
    return status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

/** The browser's own prompt. */
export async function requestMic(): Promise<MicPermission> {
  const res = await requestRecordingPermissionsAsync();
  grantedHere = res.granted;
  return res.granted ? 'granted' : 'denied';
}

/** A browser has no settings page to send him to: the prompt's button asks again instead. */
export const openMicSettings: (() => void) | undefined = undefined;

/** The upload type of a finished recording (a `blob:` URL). */
export async function clipContentType(uri: string): Promise<VoiceContentType | null> {
  const blob = await (await fetch(uri)).blob();
  return voiceContentType(blob.type, uri);
}
