import { useRef } from 'react';
import { ActivityIndicator, Pressable, View, type GestureResponderEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import type { MessageKey } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import { formatVoiceClock, VOICE_CANCEL_SLIDE_PX } from '../logic/voice-note';
import { usePressScale, usePulse } from '../motion/motion';
import { useTheme } from '../theme/ThemeProvider';
import { IconButton } from './IconButton';
import { Text } from './Text';

/** The app's `t` (the shared `chat.voice.*` keys). */
type VoiceT = (key: MessageKey, params?: Record<string, string | number>) => string;

export type VoicePlayState = 'idle' | 'loading' | 'playing' | 'paused';

export interface VoiceNotePlayerProps {
  durationSec: number;
  /** Seconds played so far (only the note that is playing or paused has one). */
  positionSec?: number;
  state?: VoicePlayState;
  /** False when the file went with the closed chat: the bubble says so instead of a player. */
  available: boolean;
  onToggle?: () => void;
  t: VoiceT;
  testID?: string;
}

/**
 * A voice note inside a chat bubble (ride ideas n7/n8): one round play / pause key (44 px), a thin
 * progress line that fills from the start side, and the seconds (the length; the position while it
 * plays). No waveform: the clean player Ali asked for.
 */
export function VoiceNotePlayer({
  durationSec,
  positionSec = 0,
  state = 'idle',
  available,
  onToggle,
  t,
  testID,
}: VoiceNotePlayerProps) {
  const theme = useTheme();
  if (!available) {
    return (
      <View
        testID={testID}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          paddingVertical: theme.space[1],
          minHeight: 44,
        }}
      >
        <Icon name="mic-off" size={20} color="textMuted" />
        <Text variant="label" color="textMuted" style={{ flexShrink: 1 }}>
          {t('chat.voice.expired')}
        </Text>
      </View>
    );
  }
  const active = state === 'playing' || state === 'paused' || state === 'loading';
  const progress = durationSec > 0 && active ? Math.min(1, positionSec / durationSec) : 0;
  const shown =
    state === 'playing' || (state === 'paused' && positionSec > 0) ? positionSec : durationSec;
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        width: 216,
        maxWidth: '100%',
        paddingVertical: 2,
      }}
      accessible={false}
    >
      <Pressable
        testID={testID ? `${testID}-toggle` : undefined}
        accessibilityRole="button"
        accessibilityLabel={t(state === 'playing' ? 'chat.voice.pause' : 'chat.voice.play')}
        accessibilityHint={t('chat.voice.seconds_a11y', { seconds: durationSec })}
        onPress={onToggle}
        disabled={!onToggle}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.accent,
        }}
      >
        {state === 'loading' ? (
          <ActivityIndicator size="small" color={theme.colors.onAccent} />
        ) : (
          <Icon
            name={state === 'playing' ? 'pause' : 'play'}
            size={20}
            color="onAccent"
            filled
            strokeWidth={1.5}
          />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 6 }}>
        <View
          style={{
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.colors.border,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              start: 0,
              width: `${Math.round(progress * 100)}%`,
              backgroundColor: theme.colors.accentText,
              borderRadius: 2,
            }}
          />
        </View>
        <Text
          variant="caption"
          color="textMuted"
          tabular
          style={{ lineHeight: 16 }}
          testID={testID ? `${testID}-clock` : undefined}
        >
          {formatVoiceClock(shown)}
        </Text>
      </View>
    </View>
  );
}

export interface VoiceRecorderBarProps {
  elapsedMs: number;
  /** How far the finger has slid towards cancel (0–1); ignored when `locked`. */
  slide: number;
  /**
   * Recording without a held finger (a screen reader's double tap): the bar has its own delete and
   * send keys instead of the slide hint.
   */
  locked?: boolean;
  onDiscard?: () => void;
  onSend?: () => void;
  t: VoiceT;
}

/**
 * What replaces the text field while a voice note records: a softly pulsing red dot, the running
 * seconds, and «‹ اسحب للإلغاء» that follows the finger towards the start side and reddens near the
 * cancel line.
 */
export function VoiceRecorderBar({
  elapsedMs,
  slide,
  locked = false,
  onDiscard,
  onSend,
  t,
}: VoiceRecorderBarProps) {
  const theme = useTheme();
  const pulse = usePulse(true);
  // Towards the start side: the right in Arabic.
  const shift = (theme.isRTL ? 1 : -1) * slide * VOICE_CANCEL_SLIDE_PX * 0.6;
  return (
    <View
      testID="chat-voice-recording"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('chat.voice.recording')}
      style={{
        flex: 1,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.surfaceSunken,
      }}
    >
      {locked ? (
        <IconButton
          icon="trash"
          variant="plain"
          accessibilityLabel={t('chat.voice.discard')}
          onPress={onDiscard}
          haptic="light"
          testID="chat-voice-discard"
        />
      ) : null}
      <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: theme.colors.danger,
            },
            pulse,
          ]}
        />
        <View
          style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.danger }}
        />
      </View>
      <Text variant="bodyStrong" tabular testID="chat-voice-elapsed">
        {formatVoiceClock(elapsedMs / 1000)}
      </Text>
      {locked ? (
        <>
          <View style={{ flex: 1 }} />
          <IconButton
            icon="send"
            variant="accent"
            accessibilityLabel={t('chat.voice.send')}
            onPress={onSend}
            haptic="light"
            testID="chat-voice-send"
          />
        </>
      ) : (
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            opacity: 1 - slide * 0.5,
            transform: [{ translateX: shift }],
          }}
        >
          <Icon name="chevron-back" size={16} color={slide > 0.6 ? 'dangerText' : 'textMuted'} />
          <Text variant="label" color={slide > 0.6 ? 'dangerText' : 'textMuted'} numberOfLines={1}>
            {t('chat.voice.slide_cancel')}
          </Text>
        </View>
      )}
    </View>
  );
}

export interface MicHoldButtonProps {
  /** The finger went down: start recording (or ask for the microphone). */
  onHoldStart: () => void;
  /** Horizontal travel since the press, in px (physical: right is positive). */
  onHoldMove: (dx: number) => void;
  /** The finger lifted: send. */
  onHoldEnd: () => void;
  /** The system took the touch away (a call, a scroll): drop the recording. */
  onHoldAbort: () => void;
  /** A screen reader's activation: record without holding (the bar gets send and delete keys). */
  onActivate: () => void;
  recording: boolean;
  disabled?: boolean;
  t: VoiceT;
}

/**
 * The composer's mic (shown while the text field is empty): press and hold to record, release to
 * send, slide towards the start side to cancel. Built on the responder system so it works with a
 * finger on phones and a mouse in the browser; the touch is never handed to a parent scroll view.
 */
export function MicHoldButton({
  onHoldStart,
  onHoldMove,
  onHoldEnd,
  onHoldAbort,
  onActivate,
  recording,
  disabled = false,
  t,
}: MicHoldButtonProps) {
  const theme = useTheme();
  const press = usePressScale(1.18);
  const startX = useRef(0);
  const x = (e: GestureResponderEvent) => e.nativeEvent.pageX;
  return (
    <Animated.View
      testID="chat-mic"
      accessible
      accessibilityRole="button"
      accessibilityLabel={t('chat.voice.record')}
      accessibilityHint={t('chat.voice.hold_hint')}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate' && !disabled) onActivate();
      }}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => false}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        startX.current = x(e);
        press.onPressIn();
        onHoldStart();
      }}
      onResponderMove={(e) => onHoldMove(x(e) - startX.current)}
      onResponderRelease={() => {
        press.onPressOut();
        onHoldEnd();
      }}
      onResponderTerminate={() => {
        press.onPressOut();
        onHoldAbort();
      }}
      style={[
        {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: recording ? theme.colors.danger : theme.colors.accent,
          opacity: disabled ? 0.5 : 1,
          // The browser must not select text or open a menu under a held mouse / finger.
          userSelect: 'none',
        } as object,
        press.style,
      ]}
    >
      <Icon name="mic" size={22} color={recording ? 'onDanger' : 'onAccent'} strokeWidth={2} />
    </Animated.View>
  );
}
