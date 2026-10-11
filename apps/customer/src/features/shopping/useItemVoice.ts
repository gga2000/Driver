import { useEffect, useState } from 'react';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
  AudioQuality,
  IOSOutputFormat,
} from 'expo-audio';
import { micPermission, requestMic } from '@/features/chat/mic';

/** The chat's speech settings: mono AAC at 48 kb/s on phones, Opus in WebM in Chrome. */
const SPEECH: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 48000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 48000 },
};

/** A دوّرلي item said out loud keeps to a minute. */
export const ITEM_VOICE_MAX_MS = 60_000;

/**
 * A voice note for one دوّرلي item («لمبات للصالة، مثل اللي عندي بس أبيض»): tap to record, tap to
 * stop, play it back, or delete it. The note stays on the phone until the order is placed.
 */
export function useItemVoice() {
  const recorder = useAudioRecorder(SPEECH);
  const rec = useAudioRecorderState(recorder, 250);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [denied, setDenied] = useState(false);

  useEffect(
    () => () => {
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: false }).catch(
        () => undefined,
      );
    },
    [],
  );

  const start = async (): Promise<boolean> => {
    let perm = await micPermission();
    if (perm !== 'granted') perm = await requestMic();
    if (perm !== 'granted') {
      setDenied(true);
      return false;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      return true;
    } catch {
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      return false;
    }
  };

  const stop = async (): Promise<{ uri: string; durationMs: number } | null> => {
    const durationMs = recorder.getStatus().durationMillis;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    return recorder.uri ? { uri: recorder.uri, durationMs } : null;
  };

  const toggle = (uri: string) => {
    if (status.playing) {
      player.pause();
      return;
    }
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(
      () => undefined,
    );
    player.replace({ uri });
    player.play();
  };

  return {
    recording: rec.isRecording,
    elapsedMs: rec.isRecording ? rec.durationMillis : 0,
    denied,
    playing: status.playing,
    start,
    stop,
    toggle,
  };
}
