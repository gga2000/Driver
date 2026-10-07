'use client';

import type { ChatMessage } from '@driver/contracts';
import { t } from '@driver/i18n';
import { fileUrl } from '@/lib/control-room';
import { API_URL } from '@/lib/trpc';

/** `m:ss` with Western digits, as the apps show a voice note's length. */
export function voiceClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A chat voice note in the Console (ride ideas n7/n8): the browser's own player on the signed file
 * (it goes with the chat when it closes; the line then says so) and the note's length.
 */
export function ChatVoiceNote({ m }: { m: Pick<ChatMessage, 'audioUrl' | 'durationSec' | 'seq'> }) {
  if (!m.audioUrl) return <span className="text-muted">{t('chat.voice.expired')}</span>;
  const seconds = m.durationSec ?? 0;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <audio
        controls
        preload="none"
        src={fileUrl(m.audioUrl, API_URL)}
        aria-label={t('chat.voice.seconds_a11y', { seconds })}
        className="h-9 max-w-full"
        data-testid={`chat-voice-${m.seq}`}
      />
      <span className="num text-xs text-muted">{voiceClock(seconds)}</span>
    </span>
  );
}
