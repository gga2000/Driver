import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Linking } from 'react-native';
import type { VoiceContentType } from '@driver/contracts';
import { voiceContentType, type MicPermission } from '@driver/ui';

/**
 * The driver's phone microphone (iOS NSMicrophoneUsageDescription, Android RECORD_AUDIO through the
 * expo-audio plugin). "Undetermined" while the OS may still ask; "denied" once only the settings can turn it on.
 */
export async function micPermission(): Promise<MicPermission> {
  const res = await getRecordingPermissionsAsync();
  return res.granted ? 'granted' : res.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestMic(): Promise<MicPermission> {
  const res = await requestRecordingPermissionsAsync();
  return res.granted ? 'granted' : 'denied';
}

export const openMicSettings: (() => void) | undefined = () => void Linking.openSettings().catch(() => undefined);

/** Phones record AAC in an .m4a file. */
export async function clipContentType(uri: string): Promise<VoiceContentType | null> {
  return voiceContentType(null, uri);
}
