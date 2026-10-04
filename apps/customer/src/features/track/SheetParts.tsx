import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { quickReplyText, type CourierCard as CourierCardData, type OrderTracking, type QuickReplyKey, type VehicleClass } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import {
  Avatar,
  Chip,
  formatClock,
  Icon,
  IconButton,
  ltr,
  PriceBreakdown,
  StatusPill,
  Text,
  useTheme,
  withAlpha,
  type IconName,
  type PriceItem,
  type StatusTone,
} from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import type { Phase } from './timeline';
import { color } from '@driver/design-tokens';

// ───────────────────────── collapsed header ─────────────────────────

const PHASE_TONE: Record<Phase, StatusTone> = {
  waiting_merchant: 'accent',
  preparing: 'accent',
  searching: 'accent',
  reassigning: 'info',
  to_pickup: 'accent',
  at_pickup: 'success',
  on_the_way: 'accent',
  unreachable: 'warning',
  arrived: 'success',
  done: 'success',
  cancelled: 'neutral',
  failed: 'danger',
  disputed: 'warning',
};

/** Collapsed sheet: status line + ETA (spec §4). */
export function SheetHeader({
  phase,
  status,
  pill,
  eta,
  now,
  lateMin,
  note,
  aside,
}: {
  phase: Phase;
  status: string;
  pill: string;
  eta: Date | null;
  now: number;
  lateMin: number;
  /** One muted line under the status (rides: the search wave). */
  note?: string | null;
  /** Replaces the ETA box (rides: the search counter). */
  aside?: ReactNode;
}) {
  const theme = useTheme();
  const t = useT();
  const minutes = eta ? Math.max(1, Math.round((eta.getTime() - now) / 60_000)) : null;
  const live = phase !== 'done' && phase !== 'arrived' && phase !== 'cancelled' && phase !== 'failed' && phase !== 'disputed';
  return (
    <View testID="sheet-header" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <View style={{ flex: 1, gap: theme.space[1] }}>
        <StatusPill size="sm" tone={lateMin > 0 ? 'warning' : PHASE_TONE[phase]} live={live} label={lateMin > 0 ? t('track.running_late', { minutes: lateMin }) : pill} />
        <Text variant="title" numberOfLines={2} testID="status-line">
          {status}
        </Text>
        {note ? (
          <Text variant="caption" color="textMuted" numberOfLines={1} testID="status-note" style={{ marginTop: -2 }}>
            {note}
          </Text>
        ) : null}
      </View>
      {aside ? (
        aside
      ) : eta && minutes !== null ? (
        <View
          testID="eta"
          style={{ alignItems: 'center', paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderRadius: theme.radius.lg, backgroundColor: lateMin > 0 ? theme.colors.warningTint : theme.colors.accentTint, minWidth: 84 }}
        >
          <Text variant="caption" color={lateMin > 0 ? 'warningText' : 'accentText'} style={{ lineHeight: 16 }}>
            {t('track.eta_label')}
          </Text>
          <Text variant="amount" tabular color={lateMin > 0 ? 'warningText' : 'accentText'} style={{ lineHeight: 30 }}>
            {formatClock(eta)}
          </Text>
          <Text variant="caption" color="textMuted" tabular style={{ lineHeight: 16 }}>
            {t('track.eta_minutes', { minutes })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ───────────────────────── degraded banners ─────────────────────────

export function DegradedBanner({ icon, tone, title, body, testID }: { icon: IconName; tone: 'warning' | 'info'; title: string; body?: string; testID?: string }) {
  const theme = useTheme();
  const bg = tone === 'warning' ? theme.colors.warningTint : theme.colors.infoTint;
  const fg = tone === 'warning' ? 'warningText' : 'infoText';
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[3],
        paddingVertical: theme.space[2],
        borderRadius: theme.radius.lg,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: withAlpha(tone === 'warning' ? theme.colors.warning : theme.colors.info, 0.35),
        shadowColor: color.neutral[1000],
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <Icon name={icon} size={18} color={fg} strokeWidth={2.2} />
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={600} color={fg}>
          {title}
        </Text>
        {body ? (
          <Text variant="caption" color="textMuted">
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ───────────────────────── courier card ─────────────────────────

const VEHICLE_KEY: Record<VehicleClass, MessageKey> = {
  bike: 'track.vehicle.bike',
  tuktuk: 'track.vehicle.tuktuk',
  car: 'track.vehicle.car',
  suv: 'track.vehicle.suv',
  van: 'track.vehicle.van',
  intercity: 'track.vehicle.intercity',
};

/**
 * The courier card (customer app §4): photo, name, vehicle + plate, rating, "verified today", and
 * the three ways to reach him — chat (unread badge), masked call, share trip — plus one-tap quick
 * replies that go straight into the chat (`chat.send`).
 */
export function CourierCard({
  courier,
  ride,
  quickReplies,
  unread,
  canChat,
  onReply,
  onChat,
  onCall,
  onShare,
}: {
  courier: CourierCardData;
  ride: boolean;
  quickReplies: readonly QuickReplyKey[];
  unread: number;
  canChat: boolean;
  onReply: (key: QuickReplyKey) => void;
  onChat: () => void;
  onCall: () => void;
  onShare: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const name = courier.firstName ?? t(ride ? 'track.driver_fallback' : 'track.courier_fallback');
  const vehicle = [courier.vehicleClass ? t(VEHICLE_KEY[courier.vehicleClass]) : null, courier.vehicleLabel].filter(Boolean).join(' · ');
  return (
    <View testID="courier-card" style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        {/* Photo placeholder until profile photos ship: initial on a stable tone, ringed when verified today. */}
        <Avatar name={name} size={56} ring={Boolean(courier.verifiedTodayAt)} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
            <Text variant="title">{name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }} accessibilityLabel={courier.rating ? `${courier.rating}` : t('track.rating_new')}>
              <Icon name="star" size={14} color="accent" filled />
              <Text variant="caption" weight={600} color="textMuted" tabular>
                {courier.rating ? t('track.rating_value', { rating: courier.rating.toFixed(1), count: courier.ratingCount }) : t('track.rating_new')}
              </Text>
            </View>
          </View>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {vehicle}
            {courier.plate ? ` · ${ltr(courier.plate)}` : ''}
          </Text>
          {courier.verifiedTodayAt ? (
            <View
              testID="verified-today"
              style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: theme.space[2], height: 22, borderRadius: 11, backgroundColor: theme.colors.successTint }}
            >
              <Icon name="shield" size={13} color="successText" strokeWidth={2.2} />
              <Text variant="caption" weight={600} color="successText">
                {t('trip.verified_today')}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {canChat ? (
            <IconButton
              icon="chat"
              variant="tonal"
              badge={unread > 0 ? unread : undefined}
              accessibilityLabel={unread > 0 ? `${t(ride ? 'track.message_driver' : 'track.message_courier')} · ${t('chat.unread_label', { count: unread })}` : t(ride ? 'track.message_driver' : 'track.message_courier')}
              onPress={onChat}
              testID="chat-courier"
            />
          ) : null}
          {canChat ? <IconButton icon="phone" variant="tonal" accessibilityLabel={t('track.call_masked')} onPress={onCall} testID="call-courier" /> : null}
          <IconButton icon="share" variant="outline" accessibilityLabel={t('trip.share')} onPress={onShare} testID="share-trip" />
        </View>
      </View>
      {canChat && quickReplies.length > 0 ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="caption" color="textMuted">
            {t('track.quick_replies')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {quickReplies.map((k) => (
              <Chip key={k} label={quickReplyText(k, locale)} icon="chat" role="button" onPress={() => onReply(k)} testID={`reply-${k}`} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ───────────────────────── order details ─────────────────────────

export function OrderItems({ view }: { view: OrderTracking }) {
  const theme = useTheme();
  const t = useT();
  if (view.items.length === 0) return null;
  const groups = new Map<string | null, OrderTracking['items']>();
  for (const it of view.items) groups.set(it.participantId, [...(groups.get(it.participantId) ?? []), it]);
  const guestNo = new Map(view.order.participants.map((p, i) => [p.id, i + 1]));
  const labelOf = (pid: string | null) => {
    if (pid === null) return t('track.for_me');
    const p = view.order.participants.find((x) => x.id === pid);
    return p?.label ?? t('track.for_guest', { n: guestNo.get(pid) ?? 1 });
  };
  const keys = [...groups.keys()].sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
  return (
    <View testID="order-items" style={{ gap: theme.space[3] }}>
      {view.merchant ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="bag" size={18} color="textMuted" />
          <Text variant="bodyStrong">{view.merchant.name}</Text>
        </View>
      ) : null}
      {keys.map((pid) => (
        <View key={pid ?? 'me'} style={{ gap: theme.space[1] }}>
          {groups.size > 1 || pid !== null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Avatar name={labelOf(pid)} size={22} />
              <Text variant="label" color="textMuted">
                {labelOf(pid)}
              </Text>
            </View>
          ) : null}
          {groups.get(pid)!.map((it) => (
            <View key={it.lineId} style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
              <Text variant="body" tabular color="textMuted" style={{ minWidth: 28 }}>
                {`${it.qty}×`}
              </Text>
              <Text variant="body" style={{ flex: 1 }} numberOfLines={2}>
                {it.name}
              </Text>
              <Text variant="body" tabular>
                {iqd(it.totalIqd)}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function priceItems(view: OrderTracking, t: ReturnType<typeof useT>): PriceItem[] {
  const o = view.order;
  const items: PriceItem[] = [];
  // A ride is one fare (the locked quote), not items + delivery.
  if (o.type === 'ride') items.push({ key: 'fare', label: t('ride.fare'), amount: Math.max(0, o.totalIqd - o.tipIqd) });
  if (o.itemsTotalIqd > 0) items.push({ key: 'items', label: t('quote.subtotal'), amount: o.itemsTotalIqd });
  if (o.deliveryFeeIqd > 0) items.push({ key: 'delivery', label: t('quote.delivery'), amount: o.deliveryFeeIqd });
  if (o.serviceFeeIqd > 0) items.push({ key: 'service', label: t('quote.service_fee'), amount: o.serviceFeeIqd, reason: t('quote.reason.service_fee') });
  // The deal at its exact promised saving; a rounded total shows the difference as PriceBreakdown's "تقريب" line.
  if (o.discountIqd > 0) {
    const merchantDeal = o.discount?.funder === 'merchant';
    const label = merchantDeal ? t(o.discount?.target === 'delivery' ? 'quote.deal_free_delivery' : 'quote.deal_discount') : t('quote.promo');
    items.push({ key: 'discount', label, amount: -Math.max(o.discountIqd, o.discount?.dealIqd ?? 0) });
  }
  if (o.tipIqd > 0) items.push({ key: 'tip', label: t('quote.tip'), amount: o.tipIqd });
  if (o.cancellationFeeIqd > 0) items.push({ key: 'cancel', label: t('quote.cancellation'), amount: o.cancellationFeeIqd });
  return items;
}

export function PriceSection({ view }: { view: OrderTracking }) {
  const t = useT();
  const ride = view.order.type === 'ride';
  const note = ride ? (view.order.paymentMethod === 'cash' ? t('ride.pay_cash_hint') : t('ride.paid_wallet')) : undefined;
  return <PriceBreakdown items={priceItems(view, t)} total={view.order.totalIqd} note={note} testID="track-price" />;
}

// ───────────────────────── context actions ─────────────────────────

export function ActionRow({ icon, label, hint, tone = 'text', onPress, testID }: { icon: IconName; label: string; hint?: string; tone?: 'text' | 'dangerText'; onPress: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3], opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'dangerText' ? theme.colors.dangerTint : theme.colors.surfaceSunken }}>
        <Icon name={icon} size={18} color={tone} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body" weight={500} color={tone}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}
