import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHAT_TEXT_MAX, quickReplyText, type CallSession, type QuickReplyKey, type ChatMessage, type ChatThreadKind, type ChatThreadView, type LatLng } from '@driver/contracts';
import type { Locale, MessageKey } from '@driver/i18n';
import { formatClock, ltr } from '../format';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { chatRows, lastSeqOf, newClientId, pinUrl, roleKey, telUrl, type ChatRow, type PendingMessage, type SendBody } from '../logic/chat';
import { withAlpha } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Chip } from './Chip';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';
import { Skeleton } from './Skeleton';
import { Text } from './Text';
import { TextField } from './TextField';
import { useToast } from './Toast';

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
}

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
  onBack,
  errorMessage,
  errorCode,
  photoUri,
  attachPhoto,
  currentLocation,
  liveStatus,
  orderReplies,
}: ChatThreadProps) {
  const theme = useTheme();
  const toast = useToast();
  const v = thread.data;
  const ride = v?.ride ?? false;
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [attaching, setAttaching] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const messages = useMemo(() => v?.messages ?? [], [v]);
  const lastSeq = lastSeqOf(messages);
  const rows = useMemo(() => chatRows(messages, pending, new Date()), [messages, pending]);

  // Mark what is on screen as read (the other side's receipts and the badges follow).
  useEffect(() => {
    if (v && lastSeq > v.myReadSeq) markRead(lastSeq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSeq, v?.myReadSeq]);

  const send = async (body: SendBody, preview: { text: string | null; localPhotoUri?: string | null }, clientId = newClientId()) => {
    const p: PendingMessage = { clientId, body, text: preview.text, localPhotoUri: preview.localPhotoUri ?? null, status: 'sending', createdAt: new Date() };
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

  const counterpart = v ? (v.participants.find((p) => !p.you && p.role !== 'support') ?? null) : null;
  const counterpartLabel = counterpart ? t(roleKey(counterpart.role, ride)) : '';
  const title = counterpart?.name ?? counterpartLabel;
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
                      {t('chat.subtitle', { role: counterpartLabel, order: t('order.number', { id: orderNumber ?? orderId.replace(/^ord_/, '').slice(-6).toUpperCase() }) })}
                    </Text>
                  )}
                </>
              ) : (
                <Skeleton width={140} height={20} />
              )}
            </View>
            {v?.canCall ? <IconButton icon="phone" variant="tonal" accessibilityLabel={t('chat.call')} onPress={call} disabled={calling} testID="chat-call" /> : null}
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
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <EmptyState icon="chat" title={t('chat.empty_title')} body={open ? t('chat.empty_body') : undefined} />
            </View>
          ) : (
            rows.map((row) => <Row key={row.key} row={row} t={t} photoUri={photoUri} onRetry={(p) => void send(p.body, { text: p.text, localPhotoUri: p.localPhotoUri }, p.clientId)} />)
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
                  <IconButton icon="send" variant="accent" accessibilityLabel={t('chat.send')} onPress={sendText} disabled={!draft.trim()} testID="chat-send" />
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

function Row({ row, t, photoUri, onRetry }: { row: ChatRow; t: ChatT; photoUri: (url: string) => string; onRetry: (p: PendingMessage) => void }) {
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
        <Bubble t={t} mine kind={'photoUploadId' in p.body ? 'photo' : 'location' in p.body ? 'location' : 'text'} text={p.text} photo={p.localPhotoUri} location={'location' in p.body ? p.body.location : null} senderLabel={null}>
          <Meta mine time={p.createdAt} state={p.status === 'failed' ? 'failed' : 'sending'} t={t} />
        </Bubble>
      </Pressable>
    );
  }
  const m = row.message;
  const senderLabel = !m.mine && m.senderRole === 'support' ? t('chat.role.support') : null;
  return (
    <View testID={`chat-msg-${m.seq}`}>
      <Bubble t={t} mine={m.mine} kind={m.kind} text={m.text} photo={m.photoUrl ? photoUri(m.photoUrl) : null} location={m.location} senderLabel={senderLabel}>
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
  senderLabel,
  children,
}: {
  t: ChatT;
  mine: boolean;
  kind: ChatMessage['kind'];
  text: string | null;
  photo: string | null;
  location: { lat: number; lng: number } | null;
  senderLabel: string | null;
  children: ReactNode;
}) {
  const theme = useTheme();
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
      {kind === 'photo' && photo ? (
        <Image source={{ uri: photo }} accessibilityLabel={t('chat.photo_label')} style={{ width: 220, height: 220, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }} resizeMode="cover" />
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
