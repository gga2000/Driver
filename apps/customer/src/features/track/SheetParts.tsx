import { color as palette } from '@driver/design-tokens';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { quickReplyText, type CourierCard as CourierCardData, type OrderTracking, type QuickReplyKey, type VehicleClass } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import {
  Avatar,
  Chip,
  DepartureTime,
  DriverChip,
  formatClock,
  Icon,
  IconButton,
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
import { amountParam, iqd } from '@/lib/money';
import { ChangeReceiptLine } from './ChangeCredited';
import { promiseCopy } from './late-promise';
import type { Phase } from './timeline';
import { color } from '@driver/design-tokens';
import { apiPhoto } from '@/lib/photo';

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
  below,
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
  /** Full width under the header row, still in the collapsed sheet (rides: the notification ask, joy f1). */
  below?: ReactNode;
}) {
  const theme = useTheme();
  const t = useT();
  const minutes = eta ? Math.max(1, Math.round((eta.getTime() - now) / 60_000)) : null;
  const live = phase !== 'done' && phase !== 'arrived' && phase !== 'cancelled' && phase !== 'failed' && phase !== 'disputed';
  const row = (
    <View testID="sheet-header" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <View style={{ flex: 1, gap: theme.space[1] }}>
        <StatusPill size="sm" tone={lateMin > 0 ? 'warning' : PHASE_TONE[phase]} live={live} label={lateMin > 0 ? t('track.running_late', { minutes: lateMin }) : pill} />
        {/* L-23: screen readers read each new status by itself, politely (the ETA box stays quiet). */}
        <Text variant="title" numberOfLines={2} testID="status-line" accessibilityLiveRegion="polite">
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
          accessible
          accessibilityLabel={`${t('track.eta_label')} ${formatClock(eta)}، ${t('track.eta_minutes', { minutes })}`}
          style={{ alignItems: 'center', paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: lateMin > 0 ? theme.colors.warningTint : theme.colors.accentTint, minWidth: 84 }}
        >
          {/* "يوصلك 7:00" on the same split-flap tiles as a الرجعة departure (audit d-2). */}
          <DepartureTime at={eta} now={now} size="compact" align="center" label={t('track.eta_label')} tone={lateMin > 0 ? 'warning' : 'ink'} countdown={false} note={t('track.eta_minutes', { minutes })} testID="eta-time" />
        </View>
      ) : null}
    </View>
  );
  if (!below) return row;
  return (
    <View style={{ gap: theme.space[3] }}>
      {row}
      {below}
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
  // The model and colour say more than the class ("تويوتا كورولا · أبيض"); the class only when that is all we know.
  const vehicle = courier.vehicleLabel ?? (courier.vehicleClass ? t(VEHICLE_KEY[courier.vehicleClass]) : '');
  return (
    <View testID="courier-card" style={{ gap: theme.space[3] }}>
      {/* C-19 / C-20: photo (his initial until portraits exist), first name, "متحقق اليوم", the car,
          and the plate in its own chip on its own line — never cut off by the buttons. */}
      <DriverChip
        testID="courier-chip"
        name={name}
        unnamed={!courier.firstName}
        photoUrl={apiPhoto(courier.photoUrl)}
        vehicle={[vehicle, courier.rating ? `★ ${t('track.rating_value', { rating: courier.rating.toFixed(1), count: courier.ratingCount })}` : null].filter(Boolean).join(' · ') || null}
        plate={courier.plate}
        plateLabel={t('driver.plate')}
        verifiedLabel={courier.verifiedTodayAt ? t('trip.verified_today') : null}
        size="lg"
        trailing={
          <>
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
          </>
        }
      />
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
          <Icon name="food" size={18} color="textMuted" />
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
  // J-D6: the small-order fee the order was placed with.
  if ((o.smallOrderFeeIqd ?? 0) > 0) items.push({ key: 'small_order', label: t('quote.small_order_fee'), amount: o.smallOrderFeeIqd ?? 0 });
  // The deal at its exact promised saving. A cash total's change is PriceBreakdown's "الباقي رصيد" strip; orders
  // placed before 2026-10-04 (deal trimmed onto 500) still show their difference as a small "تقريب" line.
  if (o.discountIqd > 0) {
    const merchantDeal = o.discount?.funder === 'merchant';
    const label = merchantDeal ? t(o.discount?.target === 'delivery' ? 'quote.deal_free_delivery' : 'quote.deal_discount') : t('quote.promo');
    items.push({ key: 'discount', label, amount: -Math.max(o.discountIqd, o.discount?.dealIqd ?? 0) });
  }
  // W-02: the points spent on it (delivery first, then the service fee).
  if ((o.pointsIqd ?? 0) > 0) items.push({ key: 'points', label: t('quote.points'), amount: -(o.pointsIqd ?? 0) });
  if (o.tipIqd > 0) items.push({ key: 'tip', label: t('quote.tip'), amount: o.tipIqd });
  if (o.cancellationFeeIqd > 0) items.push({ key: 'cancel', label: t('quote.cancellation'), amount: o.cancellationFeeIqd });
  return items;
}

export function PriceSection({ view }: { view: OrderTracking }) {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const ride = view.order.type === 'ride';
  const note = ride ? (view.order.paymentMethod === 'cash' ? t('ride.pay_cash_hint') : t('ride.paid_wallet')) : undefined;
  const credited = view.order.paymentMethod === 'cash' ? (view.order.changeToWalletIqd ?? 0) : 0;
  const credit = view.latePromise?.credit ?? null;
  return (
    <View style={{ gap: theme.space[2] }}>
      <PriceBreakdown items={priceItems(view, t)} total={view.order.totalIqd} change={view.order.changeIqd ?? 0} note={note} testID="track-price" />
      {/* "الخردة علينا": the rest of his note that went to the wallet at the door, under the bill. */}
      {credited > 0 ? <ChangeReceiptLine paidIqd={view.order.totalIqd + credited} creditedIqd={credited} /> : null}
      {/* Audit d-5: the honest-delay credit on the receipt, under the total — money back, not a discount. */}
      {credit && view.latePromise ? (
        <View
          testID="track-price-late-credit"
          accessible
          accessibilityLabel={`${t('promise.receipt_line')} ${iqd(credit.amountIqd, { locale, sign: true })}. ${t(promiseCopy(view.latePromise.basis).receiptHint, { minutes: view.latePromise.afterMin, amount: amountParam(credit.amountIqd) })}`}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], backgroundColor: theme.colors.successTint, borderRadius: theme.radius.md, paddingVertical: theme.space[2], paddingHorizontal: theme.space[3] }}
        >
          <View style={{ marginTop: 2 }}>
            <Icon name="gift" size={18} color="successText" strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space[2] }}>
              <Text variant="label" weight={600} color="successText">
                {t('promise.receipt_line')}
              </Text>
              <Text variant="label" weight={700} color="successText" tabular>
                {iqd(credit.amountIqd, { locale, sign: true })}
              </Text>
            </View>
            <Text variant="caption" color="textMuted">
              {t(promiseCopy(view.latePromise.basis).receiptHint, { minutes: view.latePromise.afterMin, amount: amountParam(credit.amountIqd) })}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
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

/** Height the floating courier card takes over the map (the camera keeps the courier above it). */
export const COURIER_FLOAT_H = 76;
/** With the plate on its own line (rides before pickup, L-06). */
export const COURIER_FLOAT_PLATE_H = 112;

/**
 * Who is coming, over the map (maps program SP5b, c6): his photo (or initial), first name, vehicle,
 * and chat / call — visible with the sheet collapsed. Rides before pickup add the plate (the safety
 * check at the kerb, L-06); on the trip the rider sits in his car, so "شارك" leads and the call moves
 * into the sheet (L-16). The full card with quick replies stays in the sheet.
 */
export function CourierFloat({
  courier,
  ride,
  unread,
  canChat,
  onChat,
  onCall,
  onShare,
  mode = 'plate',
  bottom,
}: {
  courier: CourierCardData;
  ride: boolean;
  unread: number;
  canChat: boolean;
  onChat: () => void;
  onCall: () => void;
  onShare?: () => void;
  /** Rides only: `plate` before pickup, `trip` once he drives you. */
  mode?: 'plate' | 'trip';
  bottom: number;
}) {
  const theme = useTheme();
  const t = useT();
  const name = courier.firstName ?? t(ride ? 'track.driver_fallback' : 'track.courier_fallback');
  const vehicle = courier.vehicleLabel ?? (courier.vehicleClass ? t(VEHICLE_KEY[courier.vehicleClass]) : null);
  const onTrip = ride && mode === 'trip';
  const chat = canChat ? (
    <IconButton
      icon="chat"
      variant="tonal"
      badge={unread > 0 ? unread : undefined}
      accessibilityLabel={t(ride ? 'track.message_driver' : 'track.message_courier')}
      onPress={onChat}
      testID="float-chat"
    />
  ) : null;
  return (
    <View
      testID="courier-float"
      style={{
        position: 'absolute',
        bottom,
        left: theme.space[4],
        right: theme.space[4],
        minHeight: COURIER_FLOAT_H - theme.space[2],
        justifyContent: 'center',
        paddingHorizontal: theme.space[3],
        paddingVertical: theme.space[2],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.14,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
      }}
    >
      <DriverChip
        testID="float-driver"
        name={name}
        unnamed={!courier.firstName}
        photoUrl={apiPhoto(courier.photoUrl)}
        vehicle={vehicle}
        plate={ride && mode === 'plate' ? courier.plate : null}
        plateLabel={t('driver.plate')}
        verifiedLabel={courier.verifiedTodayAt ? t('trip.verified_today') : null}
        trailing={
          onTrip ? (
            <>
              {chat}
              {onShare ? <IconButton icon="share" variant="accent" accessibilityLabel={t('trip.share')} onPress={onShare} testID="float-share" /> : null}
            </>
          ) : canChat ? (
            <>
              {chat}
              <IconButton icon="phone" variant="accent" accessibilityLabel={t('track.call_masked')} onPress={onCall} testID="float-call" />
            </>
          ) : null
        }
      />
    </View>
  );
}
