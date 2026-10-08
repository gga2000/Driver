import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioQuality, IOSOutputFormat, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState, type RecordingOptions } from 'expo-audio';
import { VOICE_RULES, type ChatThreadKind } from '@driver/contracts';
import { useToast, type ChatVoice, type VoiceClip, type VoicePlayState } from '@driver/ui';
import { absoluteUrl } from '@/features/account/photo';
import { useApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { clipContentType, micPermission, openMicSettings, requestMic } from './mic';
import { countData, HEADERS_BYTES } from '@/lib/data-usage';

/**
 * Speech, not music: mono AAC at 48 kb/s in an .m4a on phones (a minute is about 360 KB, under
 * `VOICE_RULES.maxBytes`), Opus in WebM at the same rate in Chrome (Safari falls back to MP4).
 */
const VOICE_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 48000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  web: { mimeType: 'audio/webm', bitsPerSecond: 48000 },
};
/** A note that has not started playing by then is reported as failed. */
const LOAD_TIMEOUT_MS = 10_000;

/**
 * Voice notes with the customer (ride ideas n7/n8): expo-audio's recorder (MediaRecorder in the
 * browser) and one player for the whole thread, wired to `chat.voiceUpload`. The recording mode is on
 * only while he holds the mic; the silent switch never mutes a note (nor the offer alert).
 */
export function useChatVoice(orderId: string, kind: ChatThreadKind): ChatVoice {
  const t = useT();
  const toast = useToast();
  const client = useApiClient();
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const recState = useAudioRecorderState(recorder, 250);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [activeId, setActiveId] = useState<string | null>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoadTimer = () => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = null;
  };

  // A note that played to the end goes back to its length.
  useEffect(() => {
    if (!status.didJustFinish) return;
    setActiveId(null);
    void player.seekTo(0).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish]);

  useEffect(() => {
    if (status.playing) clearLoadTimer();
  }, [status.playing]);

  // Leaving the chat: the mic is closed for good.
  useEffect(
    () => () => {
      clearLoadTimer();
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    },
    [],
  );

  const playState: VoicePlayState = !activeId ? 'idle' : status.playing ? 'playing' : !status.isLoaded || status.isBuffering ? 'loading' : 'paused';

  return useMemo<ChatVoice>(
    () => ({
      recorder: {
        permission: micPermission,
        requestPermission: requestMic,
        ...(openMicSettings ? { openSettings: openMicSettings } : {}),
        start: async () => {
          try {
            await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
            await recorder.prepareToRecordAsync();
            recorder.record();
            return true;
          } catch {
            await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
            return false;
          }
        },
        stop: async (): Promise<VoiceClip | null> => {
          const durationMs = recorder.getStatus().durationMillis;
          await recorder.stop();
          await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
          const uri = recorder.uri;
          if (!uri) return null;
          const contentType = await clipContentType(uri);
          return contentType ? { uri, durationMs, contentType } : null;
        },
        cancel: async () => {
          if (recorder.isRecording) await recorder.stop().catch(() => undefined);
          await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
        },
        elapsedMs: recState.isRecording ? recState.durationMillis : 0,
      },
      player: {
        activeId,
        state: playState,
        positionSec: activeId ? status.currentTime : 0,
        toggle: (id, uri) => {
          if (id === activeId) {
            if (status.playing) player.pause();
            else player.play();
            return;
          }
          clearLoadTimer();
          void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
          player.replace({ uri });
          setActiveId(id);
          player.play();
          loadTimer.current = setTimeout(() => {
            // Never started: an expired link, no network, or a file the phone cannot play.
            player.pause();
            setActiveId(null);
            toast.show({ message: t('chat.voice.play_failed'), tone: 'warning', icon: 'mic' });
          }, LOAD_TIMEOUT_MS);
        },
        stop: () => {
          clearLoadTimer();
          if (activeId) player.pause();
          setActiveId(null);
        },
      },
      upload: async (clip) => {
        const blob = await (await fetch(clip.uri)).blob();
        if (blob.size === 0 || blob.size > VOICE_RULES.maxBytes) throw new Error('voice_size');
        const ticket = await client.chat.voiceUpload.mutate({ orderId, kind, contentType: clip.contentType, sizeBytes: blob.size });
        const put = await fetch(absoluteUrl(ticket.uploadUrl), { method: ticket.method, headers: ticket.headers, body: blob });
        countData(blob.size + HEADERS_BYTES);
        if (!put.ok) throw new Error(`upload_${put.status}`);
        return ticket.uploadId;
      },
      audioUri: (url) => absoluteUrl(url),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, playState, status.currentTime, status.playing, recState.isRecording, recState.durationMillis, orderId, kind],
  );
}
