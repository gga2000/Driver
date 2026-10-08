import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { PhotoImage } from './PhotoImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHAT_TEXT_MAX, quickReplyText, voiceAllowedIn, type CallSession, type QuickReplyKey, type ChatMessage, type ChatThreadKind, type ChatThreadView, type LatLng } from '@driver/contracts';
import type { Locale, MessageKey } from '@driver/i18n';
import { formatClock, ltr } from '../format';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { usePhotoFallback } from '../logic/photo-fallback';
import { chatRows, lastSeqOf, newClientId, pendingKind, pinUrl, roleKey, telUrl, type ChatRow, type PendingMessage, type SendBody } from '../logic/chat';
import { VOICE_MIN_MS, voiceAtLimit, voiceDurationSec, voiceSlideCancels, voiceSlideProgress, type MicPermission, type VoiceClip } from '../logic/voice-note';
import { withAlpha } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Chip } from './Chip';
import { EmptyState } from './EmptyState';
import { CallSoonIcon } from './CallSoon';
import { IconButton } from './IconButton';
import { PermissionPrompt } from './PermissionPrompt';
import { Skeleton } from './Skeleton';
import { Text } from './Text';
import { TextField } from './TextField';
import { useToast } from './Toast';
import { MicHoldButton, VoiceNotePlayer, VoiceRecorderBar, type VoicePlayState } from './VoiceNote';

const COLUMN = 640;

/** The app's `t` (shared `chat.*` keys; every app reads them from @driver/i18n). */
export type ChatT = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The slice of a React Query result the thread renders. */
export interface ChatThreadQuery {
  data: ChatThreadView | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** A picked and uploaded photo, or why there is none. */
export type ChatPhotoResult = { uploadId: string; localUri: string } | 'denied' | null;

/** The app's microphone (expo-audio on phones, MediaRecorder in the browser). */
export interface ChatVoiceRecorder {
  /** The permission as it stands, without asking. */
  permission: () => Promise<MicPermission>;
  /** The OS (or browser) prompt. */
  requestPermission: () => Promise<MicPermission>;
  /** The phone's settings for this app; absent in the browser. */
  openSettings?: () => void;
  /** Opens the mic and starts; false when it could not. */
  start: () => Promise<boolean>;
  /** Stops and hands over the recording (null when nothing usable came out). */
  stop: () => Promise<VoiceClip | null>;
  /** Stops and throws the recording away. */
  cancel: () => Promise<void>;
  /** Live length of the running recording. */
  elapsedMs: number;
}

/** One player for the whole thread: starting a note stops the one playing. */
export interface ChatVoicePlayer {
  /** The message (or pending client id) the player holds. */
  activeId: string | null;
  state: VoicePlayState;
  positionSec: number;
  toggle: (id: string, uri: string) => void;
  stop: () => void;
}

/** Voice notes (ride ideas n7/n8): offered in the customer ↔ courier / driver and support chats. */
export interface ChatVoice {
  recorder: ChatVoiceRecorder;
  player: ChatVoicePlayer;
  /** `chat.voiceUpload` and the PUT; resolves with the upload id. */
  upload: (clip: VoiceClip) => Promise<string>;
  /** Absolute URL of a voice note. */
  audioUri: (url: string) => string;
}

export interface ChatThreadProps {
  orderId: string;
  kind: ChatThreadKind;
  /** The number this app shows for the order (the kitchen's ticket number); the id's tail otherwise. */
  orderNumber?: string;
  thread: ChatThreadQuery;
  t: ChatT;
  locale: Locale;
  /** `chat.send`; resolves once the server has it. */
  send: (input: { orderId: string; kind: ChatThreadKind; clientId: string } & SendBody) => Promise<unknown>;
  /** `chat.markRead` up to `seq`. */
  markRead: (seq: number) => void;
  /** Re-reads the thread and the badges. */
  refresh: () => Promise<unknown>;
  /** Masked call (see `useMaskedCall`). */
  call: () => void;
  calling: boolean;
  /** Calls aren't live yet (G0-10): the header's call button shows greyed with «قريباً»; `call` explains. */
  callSoon?: boolean;
  onBack: () => void;
  /** The API error's copy in this locale, or `fallback`. */
  errorMessage: (err: unknown, fallback: string) => string;
  errorCode: (err: unknown) => string | null;
  /** Absolute URL of a message photo. */
  photoUri: (url: string) => string;
  /** Camera on phones, library on the web; then the upload. */
  attachPhoto: () => Promise<ChatPhotoResult>;
  /** The phone's position for "send my location"; omit to hide the button (the kitchen). */
  currentLocation?: () => Promise<LatLng | 'denied' | null>;
  /** Joy l7: live status in the header instead of the role line («بالطريق · 4 دقايق» / «عند بابك»), tapping back to the map. */
  liveStatus?: { text: string; onPress?: () => void } | null;
  /** Joy l7: the server's quick replies reordered for the moment (at the door «طالع هسة» first). */
  orderReplies?: (keys: readonly QuickReplyKey[]) => QuickReplyKey[];
  /** Hold-to-record voice notes; omit to leave them out (the kitchen). Shown only where `voiceAllowedIn(kind)`. */
  voice?: ChatVoice;
}

type RecordPhase = 'idle' | 'starting' | 'recording';

/**
 * One conversation of an order, the same screen in all three apps (S-05): bubbles in RTL (mine on
 * the far side, as chat apps read in Arabic), quick-reply chips, photo and location, read receipts,
 * the closed-thread banner and a masked call in the header. Data and side effects come in as props
 * (each app has its own API client, live channel and photo picker); marks what is on screen as read.
 */
export function ChatThread({
  orderId,
  kind,
  orderNumber,
  thread,
  t,
  locale,
  send: sendRequest,
  markRead,
  refresh,
  call,
  calling,
  callSoon = false,
  onBack,
  errorMessage,
  errorCode,
  photoUri,
  attachPhoto,
  currentLocation,
  liveStatus,
  orderReplies,
  voice: voiceProp,
}: ChatThreadProps) {
  const theme = useTheme();
  const toast = useToast();
  const v = thread.data;
  const ride = v?.ride ?? false;
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [attaching, setAttaching] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const voice = voiceProp && voiceAllowedIn(kind) ? voiceProp : null;
  // Recording state: the ref is what the gesture handlers read (they fire faster than renders).
  const [rec, setRec] = useState<{ phase: RecordPhase; locked: boolean; slide: number }>({ phase: 'idle', locked: false, slide: 0 });
  const recRef = useRef({ phase: 'idle' as RecordPhase, locked: false, released: false, aborted: false, granted: false });
  const [micPrompt, setMicPrompt] = useState<'ask' | 'denied' | null>(null);
  const [micAsking, setMicAsking] = useState(false);

  const messages = useMemo(() => v?.messages ?? [], [v]);
  const lastSeq = lastSeqOf(messages);
  const rows = useMemo(() => chatRows(messages, pending, new Date()), [messages, pending]);

  // Mark what is on screen as read (the other side's receipts and the badges follow).
  useEffect(() => {
    if (v && lastSeq > v.myReadSeq) markRead(lastSeq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSeq, v?.myReadSeq]);

  const send = async (body: SendBody, preview: { text: string | null; localPhotoUri?: string | null; voice?: PendingMessage['voice'] }, clientId = newClientId()) => {
    const p: PendingMessage = { clientId, body, text: preview.text, localPhotoUri: preview.localPhotoUri ?? null, voice: preview.voice ?? null, status: 'sending', createdAt: new Date() };
    setPending((cur) => [...cur.filter((x) => x.clientId !== clientId), p]);
    try {
      await sendRequest({ orderId, kind, clientId, ...body });
      await refresh();
      setPending((cur) => cur.filter((x) => x.clientId !== clientId));
    } catch (err) {
      const code = errorCode(err);
      if (code === 'chat_closed' || code === 'chat_not_open' || code === 'chat_quick_reply_invalid') setPending((cur) => cur.filter((x) => x.clientId !== clientId));
      else setPending((cur) => cur.map((x) => (x.clientId === clientId ? { ...x, status: 'failed' } : x)));
      toast.show({ message: errorMessage(err, t('error.network')), tone: 'warning' });
      void refresh();
    }
  };

  const sendText = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void send({ text }, { text });
  };

  const sendPhoto = async () => {
    if (attaching) return;
    setAttaching(true);
    try {
      const picked = await attachPhoto();
      if (picked === 'denied') toast.show({ message: t('error.camera_denied'), tone: 'warning' });
      else if (picked) await send({ photoUploadId: picked.uploadId }, { text: null, localPhotoUri: picked.localUri });
    } catch {
      toast.show({ message: t('error.upload_failed'), tone: 'warning' });
    } finally {
      setAttaching(false);
    }
  };

  const sendLocation = async () => {
    if (attaching || !currentLocation) return;
    setAttaching(true);
    try {
      const fix = await currentLocation();
      if (fix === 'denied' || fix === null) toast.show({ message: t('chat.location_off'), tone: 'warning', icon: 'location-arrow' });
      else await send({ location: fix }, { text: t('chat.location_label') });
    } finally {
      setAttaching(false);
    }
  };

  // ───────────── voice notes: hold to record, release to send, slide to cancel ─────────────

  const setPhase = (phase: RecordPhase, locked = false) => {
    recRef.current.phase = phase;
    recRef.current.locked = locked;
    setRec({ phase, locked, slide: 0 });
  };

  /** Upload, then send; a failed upload stays as a red bubble that uploads again on a tap. */
  const sendVoice = async (clip: VoiceClip, clientId = newClientId()) => {
    if (!voice) return;
    const v = { clip, durationSec: voiceDurationSec(clip.durationMs) };
    setPending((cur) => [...cur.filter((x) => x.clientId !== clientId), { clientId, body: null, text: null, localPhotoUri: null, voice: v, status: 'sending', createdAt: new Date() }]);
    let uploadId: string;
    try {
      uploadId = await voice.upload(clip);
    } catch {
      setPending((cur) => cur.map((x) => (x.clientId === clientId ? { ...x, status: 'failed' } : x)));
      toast.show({ message: t('chat.voice.upload_failed'), tone: 'warning', icon: 'mic' });
      return;
    }
    await send({ voiceUploadId: uploadId, durationSec: v.durationSec }, { text: null, voice: v }, clientId);
  };

  const startRecording = async (locked: boolean) => {
    if (!voice || recRef.current.phase !== 'idle') return;
    recRef.current.released = false;
    recRef.current.aborted = false;
    setPhase('starting', locked);
    if (!recRef.current.granted) {
      const perm = await voice.recorder.permission().catch((): MicPermission => 'undetermined');
      if (perm !== 'granted') {
        // The first hold explains before the OS asks; a refusal says where to turn it on.
        setPhase('idle');
        setMicPrompt(perm === 'denied' ? 'denied' : 'ask');
        return;
      }
      recRef.current.granted = true;
    }
    voice.player.stop();
    const ok = await voice.recorder.start().catch(() => false);
    if (!ok) {
      setPhase('idle');
      toast.show({ message: t('chat.voice.record_failed'), tone: 'warning', icon: 'mic' });
      return;
    }
    if (recRef.current.released || recRef.current.aborted) {
      // Let go (or slid away) before the mic even opened: a tap, not a note.
      await voice.recorder.cancel().catch(() => undefined);
      setPhase('idle');
      if (recRef.current.released) toast.show({ message: t('chat.voice.hold_hint'), tone: 'info', icon: 'mic' });
      return;
    }
    theme.haptic('light');
    setPhase('recording', locked);
  };

  const finishRecording = async (reason: 'release' | 'limit') => {
    if (!voice || recRef.current.phase !== 'recording') return;
    setPhase('idle');
    const clip = await voice.recorder.stop().catch(() => null);
    if (!clip) {
      toast.show({ message: t('chat.voice.record_failed'), tone: 'warning', icon: 'mic' });
      return;
    }
    if (clip.durationMs < VOICE_MIN_MS) {
      toast.show({ message: t('chat.voice.hold_hint'), tone: 'info', icon: 'mic' });
      return;
    }
    if (reason === 'limit') toast.show({ message: t('chat.voice.max_reached'), tone: 'info', icon: 'mic' });
    void sendVoice(clip);
  };

  const discardRecording = async (say: boolean) => {
    if (!voice || recRef.current.phase !== 'recording') return;
    setPhase('idle');
    theme.haptic('light');
    await voice.recorder.cancel().catch(() => undefined);
    if (say) toast.show({ message: t('chat.voice.cancelled'), tone: 'info', icon: 'trash' });
  };

  const onHoldMove = (dx: number) => {
    const r = recRef.current;
    if (r.locked) return;
    if (r.phase === 'starting' && voiceSlideCancels(dx, theme.isRTL)) r.aborted = true;
    if (r.phase !== 'recording') return;
    if (voiceSlideCancels(dx, theme.isRTL)) void discardRecording(true);
    else setRec((cur) => ({ ...cur, slide: voiceSlideProgress(dx, theme.isRTL) }));
  };

  const onHoldEnd = () => {
    const r = recRef.current;
    if (r.locked) return;
    if (r.phase === 'starting') r.released = true;
    else void finishRecording('release');
  };

  const onHoldAbort = () => {
    const r = recRef.current;
    if (r.locked) return;
    if (r.phase === 'starting') r.aborted = true;
    else void discardRecording(false);
  };

  const onMicActivate = () => {
    if (recRef.current.phase === 'idle') void startRecording(true);
    else if (recRef.current.locked) void finishRecording('release');
  };

  const askMic = async () => {
    if (!voice || micAsking) return;
    if (micPrompt === 'denied' && voice.recorder.openSettings) {
      voice.recorder.openSettings();
      setMicPrompt(null);
      return;
    }
    setMicAsking(true);
    const perm = await voice.recorder.requestPermission().catch((): MicPermission => 'denied');
    setMicAsking(false);
    if (perm === 'granted') {
      recRef.current.granted = true;
      setMicPrompt(null);
      toast.show({ message: t('chat.voice.hold_hint'), tone: 'info', icon: 'mic' });
    } else setMicPrompt('denied');
  };

  // One minute is the cap: the note stops and goes by itself.
  const elapsedMs = voice?.recorder.elapsedMs ?? 0;
  useEffect(() => {
    if (rec.phase === 'recording' && voiceAtLimit(elapsedMs)) void finishRecording('limit');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedMs, rec.phase]);

  // Leaving the screen mid-recording throws the recording away.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  useEffect(
    () => () => {
      if (recRef.current.phase !== 'idle') void voiceRef.current?.recorder.cancel().catch(() => undefined);
    },
    [],
  );

  const voiceNote = (id: string, uri: string | null, durationSec: number) => {
    const active = voiceProp && voiceProp.player.activeId === id ? voiceProp.player : null;
    return (
      <VoiceNotePlayer
        durationSec={durationSec}
        available={uri !== null}
        state={active?.state ?? 'idle'}
        positionSec={active?.positionSec ?? 0}
        onToggle={voiceProp && uri ? () => voiceProp.player.toggle(id, uri) : undefined}
        t={t}
        testID={`chat-voice-${id}`}
      />
    );
  };

  // «كلّم الدعم»: the other side is our support team, not a person of the order.
  const supportChat = kind === 'customer_support';
  const counterpart = v ? (v.participants.find((p) => !p.you && (supportChat || p.role !== 'support')) ?? null) : null;
  const counterpartLabel = counterpart ? t(roleKey(counterpart.role, ride)) : '';
  const title = supportChat ? t('chat.support_title') : (counterpart?.name ?? counterpartLabel);
  const orderLabel = t('order.number', { id: orderNumber ?? orderId.replace(/^ord_/, '').slice(-6).toUpperCase() });
  const open = v?.status === 'open';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="chat-screen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Header: back · who · masked call */}
        <View style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
          <View style={{ width: '100%', maxWidth: COLUMN, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3] }}>
            <IconButton icon="chevron-back" variant="outline" size={44} accessibilityLabel={t('action.back')} onPress={onBack} testID="chat-back" />
            {v ? <Avatar name={title || '؟'} size={44} /> : <Skeleton width={44} height={44} radius={22} />}
            <View style={{ flex: 1, gap: 0 }}>
              {v ? (
                <>
                  <Text variant="title" numberOfLines={1} testID="chat-title" accessibilityRole="header">
                    {title}
                  </Text>
                  {liveStatus ? (
                    <Pressable
                      testID="chat-live-status"
                      accessibilityRole={liveStatus.onPress ? 'button' : 'text'}
                      accessibilityLiveRegion="polite"
                      onPress={liveStatus.onPress}
                      disabled={!liveStatus.onPress}
                      hitSlop={8}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.live }} />
                      <Text variant="caption" color="liveText" weight={600} numberOfLines={1}>
                        {liveStatus.text}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text variant="caption" color="textMuted" numberOfLines={1}>
                      {supportChat ? orderLabel : t('chat.subtitle', { role: counterpartLabel, order: orderLabel })}
                    </Text>
                  )}
                </>
              ) : (
                <Skeleton width={140} height={20} />
              )}
            </View>
            {v?.canCall ? (
              callSoon ? (
                <CallSoonIcon locale={locale} onPress={call} testID="chat-call" />
              ) : (
                <IconButton icon="phone" variant="tonal" accessibilityLabel={t('chat.call')} onPress={call} disabled={calling} testID="chat-call" />
              )
            ) : null}
          </View>
        </View>

        {/* Messages */}
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{ width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: theme.space[4], paddingTop: theme.space[4], paddingBottom: theme.space[4], gap: theme.space[2], flexGrow: 1 }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
          testID="chat-messages"
        >
          {thread.isError ? (
            <EmptyState icon="chat" title={errorMessage(thread.error, t('error.network'))} action={{ label: t('action.retry'), onPress: () => void thread.refetch() }} />
          ) : !v ? (
            <View style={{ gap: theme.space[3] }}>
              <Skeleton width="60%" height={44} radius={18} />
              <Skeleton width="45%" height={44} radius={18} style={{ alignSelf: 'flex-end' }} />
              <Skeleton width="55%" height={44} radius={18} />
            </View>
          ) : rows.length === 0 ? (
            <View style={{ flex: 1, justifyContent: 'center' }} testID={supportChat ? 'chat-support-empty' : undefined}>
              <EmptyState
                icon="chat"
                title={t(supportChat ? 'chat.support_empty_title' : 'chat.empty_title')}
                body={open ? t(supportChat ? 'chat.support_empty_body' : 'chat.empty_body') : undefined}
              />
            </View>
          ) : (
            rows.map((row) => (
              <Row
                key={row.key}
                row={row}
                t={t}
                photoUri={photoUri}
                audioUri={(url) => (voiceProp ? voiceProp.audioUri(url) : url)}
                voiceNote={voiceNote}
                onRetry={(p) => {
                  if (p.voice && !p.body) void sendVoice(p.voice.clip, p.clientId);
                  else if (p.body) void send(p.body, { text: p.text, localPhotoUri: p.localPhotoUri, voice: p.voice }, p.clientId);
                }}
              />
            ))
          )}
          {v?.closesAt && open ? (
            <Text variant="caption" color="textMuted" style={{ textAlign: 'center', marginTop: theme.space[2] }} testID="chat-closes-at">
              {t('chat.closes_at', { time: formatClock(v.closesAt) })}
            </Text>
          ) : null}
        </ScrollView>

        {/* Composer, or why there is none */}
        <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
          <View style={{ width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], gap: theme.space[3] }}>
            {!v ? null : v.status === 'closed' ? (
              <Banner icon="clock" text={t('chat.closed')} testID="chat-closed" />
            ) : v.status === 'not_open' ? (
              <Banner icon="clock" text={t('chat.not_open')} testID="chat-not-open" />
            ) : (
              <>
                {v.quickReplies.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} testID="chat-quick-replies">
                    {(orderReplies ? orderReplies(v.quickReplies) : v.quickReplies).map((k) => (
                      <Chip key={k} label={quickReplyText(k, locale)} role="button" onPress={() => void send({ quickReplyKey: k }, { text: quickReplyText(k, locale) })} testID={`qr-${k}`} />
                    ))}
                  </ScrollView>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space[2] }}>
                  {rec.phase === 'recording' ? (
                    <VoiceRecorderBar
                      elapsedMs={elapsedMs}
                      slide={rec.slide}
                      locked={rec.locked}
                      onDiscard={() => void discardRecording(true)}
                      onSend={() => void finishRecording('release')}
                      t={t}
                    />
                  ) : (
                    <>
                      <IconButton icon="camera" variant="plain" accessibilityLabel={t('chat.attach_photo')} onPress={() => void sendPhoto()} disabled={attaching} testID="chat-photo" />
                      {currentLocation ? (
                        <IconButton icon="map-pin" variant="plain" accessibilityLabel={t('chat.attach_location')} onPress={() => void sendLocation()} disabled={attaching} testID="chat-location" />
                      ) : null}
                      <TextField
                        style={{ flex: 1 }}
                        value={draft}
                        onChangeText={setDraft}
                        placeholder={t('chat.placeholder')}
                        maxLength={CHAT_TEXT_MAX}
                        // Web: a single-line input keeps the placeholder centred; Enter sends.
                        multiline={Platform.OS !== 'web'}
                        returnKeyType="send"
                        blurOnSubmit={false}
                        onSubmitEditing={sendText}
                        onKeyPress={(e) => {
                          // Web: Enter sends, Shift+Enter breaks the line.
                          const ne = e.nativeEvent as { key?: string; shiftKey?: boolean };
                          if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
                            (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                            sendText();
                          }
                        }}
                        pill
                        testID="chat-input"
                      />
                    </>
                  )}
                  {voice && (rec.phase !== 'idle' || !draft.trim()) ? (
                    <MicHoldButton
                      recording={rec.phase === 'recording'}
                      onHoldStart={() => void startRecording(false)}
                      onHoldMove={onHoldMove}
                      onHoldEnd={onHoldEnd}
                      onHoldAbort={onHoldAbort}
                      onActivate={onMicActivate}
                      t={t}
                    />
                  ) : (
                    <IconButton icon="send" variant="accent" accessibilityLabel={t('chat.send')} onPress={sendText} disabled={!draft.trim()} testID="chat-send" />
                  )}
                </View>
                {draft.length > CHAT_TEXT_MAX - 80 ? (
                  <Text variant="caption" color={draft.length >= CHAT_TEXT_MAX ? 'dangerText' : 'textMuted'} tabular style={{ textAlign: 'center' }}>
                    {t('chat.char_count', { count: draft.length, max: CHAT_TEXT_MAX })}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
      {voice ? (
        <PermissionPrompt
          visible={micPrompt !== null}
          icon={micPrompt === 'denied' ? 'mic-off' : 'mic'}
          title={t(micPrompt === 'denied' ? 'chat.voice.mic_denied_title' : 'chat.voice.mic_title')}
          body={t(micPrompt === 'denied' ? 'chat.voice.mic_denied_body' : 'chat.voice.mic_body')}
          allowLabel={t(micPrompt === 'denied' ? (voice.recorder.openSettings ? 'chat.voice.open_settings' : 'action.retry') : 'chat.voice.mic_allow')}
          laterLabel={t('chat.voice.not_now')}
          onAllow={() => void askMic()}
          onLater={() => setMicPrompt(null)}
          busy={micAsking}
          testID="chat-mic-prompt"
        />
      ) : null}
    </SafeAreaView>
  );
}

function Banner({ icon, text, testID }: { icon: IconName; text: string; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
      <Icon name={icon} size={18} color="textMuted" />
      <Text variant="label" color="textMuted" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function Row({
  row,
  t,
  photoUri,
  audioUri,
  voiceNote,
  onRetry,
}: {
  row: ChatRow;
  t: ChatT;
  photoUri: (url: string) => string;
  audioUri: (url: string) => string;
  /** The player of a voice note (`uri` null: the file went with the closed chat). */
  voiceNote: (id: string, uri: string | null, durationSec: number) => ReactNode;
  onRetry: (p: PendingMessage) => void;
}) {
  const theme = useTheme();
  if (row.type === 'day') {
    return (
      <View style={{ alignSelf: 'center', paddingHorizontal: theme.space[3], paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken, marginVertical: theme.space[1] }}>
        <Text variant="caption" color="textMuted">
          {row.label === 'today' ? t('chat.today') : row.label.toLocaleDateString()}
        </Text>
      </View>
    );
  }
  if (row.type === 'pending') {
    const p = row.pending;
    return (
      <Pressable disabled={p.status !== 'failed'} onPress={() => onRetry(p)} accessibilityRole={p.status === 'failed' ? 'button' : undefined} testID={`chat-pending-${p.status}`}>
        <Bubble
          t={t}
          mine
          kind={pendingKind(p)}
          text={p.text}
          photo={p.localPhotoUri}
          location={p.body && 'location' in p.body ? p.body.location : null}
          voice={p.voice ? voiceNote(p.clientId, p.voice.clip.uri, p.voice.durationSec) : null}
          senderLabel={null}
        >
          <Meta mine time={p.createdAt} state={p.status === 'failed' ? 'failed' : 'sending'} t={t} />
        </Bubble>
      </Pressable>
    );
  }
  const m = row.message;
  // A line the server writes into the thread (ride s7 «الراكب يدور على غرض نساه»): centred, no bubble.
  if (m.kind === 'system') {
    return (
      <View testID={`chat-msg-${m.seq}`} style={{ alignSelf: 'center', maxWidth: '88%', flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint, marginVertical: theme.space[1] }}>
        <Icon name="bag" size={15} color="accentText" />
        <Text variant="caption" weight={600} style={{ flexShrink: 1 }}>
          {m.text}
        </Text>
      </View>
    );
  }
  const senderLabel = !m.mine && m.senderRole === 'support' ? t('chat.role.support') : null;
  return (
    <View testID={`chat-msg-${m.seq}`}>
      <Bubble
        t={t}
        mine={m.mine}
        kind={m.kind}
        text={m.text}
        photo={m.photoUrl ? photoUri(m.photoUrl) : null}
        location={m.location}
        voice={m.kind === 'voice' ? voiceNote(m.id, m.audioUrl ? audioUri(m.audioUrl) : null, m.durationSec ?? 1) : null}
        senderLabel={senderLabel}
      >
        <Meta mine={m.mine} time={m.createdAt} state={m.mine ? (m.read ? 'read' : 'sent') : null} t={t} />
      </Bubble>
      {m.masked ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: m.mine ? 'flex-end' : 'flex-start', marginTop: 4, maxWidth: '82%' }}>
          <Icon name="shield" size={13} color="textMuted" />
          <Text variant="caption" color="textMuted">
            {t('chat.masked_note')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Bubble({
  t,
  mine,
  kind,
  text,
  photo,
  location,
  voice,
  senderLabel,
  children,
}: {
  t: ChatT;
  mine: boolean;
  kind: ChatMessage['kind'];
  text: string | null;
  photo: string | null;
  location: { lat: number; lng: number } | null;
  /** A voice note's player. */
  voice: ReactNode;
  senderLabel: string | null;
  children: ReactNode;
}) {
  const theme = useTheme();
  // A photo link that expired shows as the word «صورة» instead of an empty grey square.
  const shown = usePhotoFallback(kind === 'photo' ? photo : null);
  const r = theme.radius.xl;
  // Mine sits on the far side (left in RTL), its tail corner towards the edge it hangs from.
  const corners = mine ? { borderTopLeftRadius: r, borderTopRightRadius: r, borderBottomStartRadius: r, borderBottomEndRadius: 6 } : { borderTopLeftRadius: r, borderTopRightRadius: r, borderBottomEndRadius: r, borderBottomStartRadius: 6 };
  return (
    <View
      style={[
        {
          alignSelf: mine ? 'flex-end' : 'flex-start',
          maxWidth: '82%',
          backgroundColor: mine ? theme.colors.accentTint : theme.colors.surface,
          borderWidth: mine ? 0 : 1,
          borderColor: theme.colors.border,
          paddingHorizontal: kind === 'photo' ? 4 : theme.space[3],
          paddingTop: kind === 'photo' ? 4 : theme.space[2],
          paddingBottom: theme.space[1],
          gap: 2,
        },
        corners,
      ]}
    >
      {senderLabel ? (
        <Text variant="caption" weight={700} color="infoText">
          {senderLabel}
        </Text>
      ) : null}
      {kind === 'voice' ? (
        voice
      ) : kind === 'photo' && shown.uri ? (
        <PhotoImage uri={shown.uri} onError={shown.onError} accessibilityLabel={t('chat.photo_label')} style={{ width: 220, height: 220, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }} />
      ) : kind === 'location' && location ? (
        <Pressable onPress={() => void Linking.openURL(pinUrl(location)).catch(() => undefined)} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingVertical: 2 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(theme.colors.accent, 0.18) }}>
            <Icon name="map-pin" size={22} color="accentText" strokeWidth={2} />
          </View>
          <View>
            <Text variant="bodyStrong">{mine ? t('chat.location_label') : t('chat.location_shared')}</Text>
            <Text variant="caption" color="accentText" weight={600}>
              {t('chat.open_map')}
            </Text>
          </View>
        </Pressable>
      ) : kind === 'photo' ? (
        <Text variant="body" color="textMuted" style={{ paddingHorizontal: theme.space[2], paddingVertical: theme.space[1] }}>
          {t('chat.photo_label')}
        </Text>
      ) : (
        <Text variant="body" style={{ lineHeight: 26 }} selectable>
          {text ?? ''}
        </Text>
      )}
      {children}
    </View>
  );
}

function Meta({ mine, time, state, t }: { mine: boolean; time: Date; state: 'sending' | 'sent' | 'read' | 'failed' | null; t: ChatT }) {
  const theme = useTheme();
  const tone = state === 'failed' ? 'dangerText' : state === 'read' ? 'successText' : 'textMuted';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: mine ? 'flex-start' : 'flex-end', paddingHorizontal: theme.space[1] }}>
      <Text variant="caption" color="textMuted" tabular style={{ lineHeight: 18 }}>
        {formatClock(time)}
      </Text>
      {state ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }} accessibilityLabel={t(`chat.${state}` as const)}>
          <Icon name={state === 'read' ? 'check-double' : state === 'failed' ? 'x' : state === 'sending' ? 'clock' : 'check'} size={13} color={tone} strokeWidth={2.2} />
          {state === 'failed' || state === 'read' ? (
            <Text variant="caption" color={tone} weight={600} style={{ lineHeight: 18 }}>
              {t(`chat.${state}` as const)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Masked call to the other party of a thread (`chat.requestCall`). Production dials the platform
 * number (the provider bridges the call, nobody sees a number); a development API hands back the
 * real number and says so. The web build only shows the toast (a browser cannot place the call).
 */
export function useMaskedCall(opts: { request: () => Promise<CallSession>; enabled: boolean; ride: boolean; t: ChatT; errorMessage: (err: unknown, fallback: string) => string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { request, enabled, ride, t, errorMessage } = opts;

  const call = async () => {
    if (busy || !enabled) return;
    setBusy(true);
    try {
      const s = await request();
      const who = t(roleKey(s.counterpart, ride));
      const message = s.mode === 'dev_direct' ? `${t('chat.call_connecting', { role: who })} · ${t('chat.call_dev')} ${ltr(s.dial)}` : t('chat.call_connecting', { role: who });
      toast.show({ message, tone: 'info', icon: 'phone' }, 5000);
      if (Platform.OS !== 'web') await Linking.openURL(telUrl(s.dial)).catch(() => undefined);
    } catch (err) {
      toast.show({ message: errorMessage(err, t('error.network')), tone: 'warning', icon: 'phone' }, 5000);
    } finally {
      setBusy(false);
    }
  };
  return { call, busy };
}
