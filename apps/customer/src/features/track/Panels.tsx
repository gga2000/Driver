import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DisputeKind, LatLng, OrderTracking } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, ChipGroup, CountdownRing, Icon, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useCancellationPreview, useCancelOrder, useOpenDispute } from './queries';
import { metresFromDoor, standingLine, unreachableLeftMs } from './unreachable-logic';
import { color } from '@driver/design-tokens';

/** A modal card from the bottom over a dimmed screen (cancel, report, street hand-over, unreachable). */
export function BottomPanel({ children, onClose, testID, dim = true }: { children: ReactNode; onClose?: () => void; testID?: string; dim?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {dim ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.scrim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={onClose ? 'close' : undefined} disabled={!onClose} />
        </Animated.View>
      ) : null}
      <Animated.View
        testID={testID}
        entering={SlideInDown.springify().damping(18)}
        exiting={SlideOutDown.duration(180)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingTop: theme.space[5],
          paddingHorizontal: theme.space[5],
          paddingBottom: Math.max(insets.bottom, theme.space[5]),
          gap: theme.space[4],
          backgroundColor: theme.colors.surfaceRaised,
          borderTopLeftRadius: theme.radius['2xl'],
          borderTopRightRadius: theme.radius['2xl'],
          shadowColor: color.neutral[1000],
          shadowOpacity: 0.16,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

// ───────────────────────── cancel with fee preview ─────────────────────────

export function CancelPanel({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const preview = useCancellationPreview(orderId, true);
  const cancel = useCancelOrder(orderId);
  const p = preview.data;
  return (
    <BottomPanel onClose={onClose} testID="cancel-panel">
      <Text variant="heading">{t('cancel.title')}</Text>
      {preview.isPending ? (
        <Skeleton height={20} width="70%" />
      ) : preview.isError ? (
        <Text color="dangerText">{apiErrorMessage(preview.error, t('error.network'), locale)}</Text>
      ) : p ? (
        <View style={{ gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name={p.free ? 'check' : 'receipt'} size={18} color={p.free ? 'successText' : 'warningText'} strokeWidth={2.2} />
            <Text variant="bodyStrong" color={p.free ? 'successText' : 'warningText'}>
              {!p.allowed ? t('track.cancel_not_allowed') : p.free ? t('track.cancel_free') : `${p.label_ar} · ${amountParam(p.amountIqd)} ${t('quote.currency')}`}
            </Text>
          </View>
          {p.reason_ar ? <Text color="textMuted">{p.reason_ar}</Text> : null}
        </View>
      ) : null}
      <View style={{ gap: theme.space[2] }}>
        {p?.allowed ? (
          <Button
            label={t('cancel.confirm')}
            variant="destructive"
            loading={cancel.isPending}
            fullWidth
            testID="cancel-confirm"
            onPress={() =>
              cancel.mutate(
                { orderId },
                {
                  onSuccess: () => {
                    toast.show({ message: t('track.cancelled'), tone: 'neutral' });
                    onClose();
                  },
                  onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }),
                },
              )
            }
          />
        ) : null}
        <Button label={t('cancel.keep')} variant="ghost" fullWidth onPress={onClose} />
      </View>
    </BottomPanel>
  );
}

// ───────────────────────── report a problem ─────────────────────────

const DISPUTE_KINDS: ReadonlyArray<{ kind: DisputeKind; key: MessageKey }> = [
  { kind: 'cold_or_late', key: 'dispute.reason_late' },
  { kind: 'missing_item', key: 'dispute.reason_missing' },
  { kind: 'wrong_item', key: 'dispute.reason_wrong' },
  { kind: 'not_delivered', key: 'dispute.reason_not_delivered' },
  { kind: 'other', key: 'dispute.reason_other' },
];

/** "بلّغ عن مشكلة": a complaint once the order reached him; before that, the order's support chat. */
export function DisputePanel({ view, onClose, onSupport }: { view: OrderTracking; onClose: () => void; onSupport?: (() => void) | undefined }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const open = useOpenDispute(view.order.id);
  const [kind, setKind] = useState<DisputeKind | null>(null);
  const deliveredish = view.order.state === 'delivered' || view.order.state === 'completed';
  const kinds = view.order.type === 'ride' ? [{ kind: 'ride_fare' as const, key: 'dispute.reason_fare' as MessageKey }, DISPUTE_KINDS[4]!] : DISPUTE_KINDS;
  return (
    <BottomPanel onClose={onClose} testID="dispute-panel">
      <Text variant="heading">{t('dispute.title')}</Text>
      {deliveredish ? (
        <>
          <ChipGroup
            items={kinds.map((k) => ({ id: k.kind, label: t(k.key) }))}
            value={kind ? [kind] : []}
            onChange={(next) => setKind((next[0] as DisputeKind | undefined) ?? null)}
            mode="single"
          />
          <Text variant="footnote" color="textMuted">
            {t('dispute.window_note')}
          </Text>
          <Button
            label={t('dispute.submit')}
            disabled={!kind}
            loading={open.isPending}
            fullWidth
            onPress={() =>
              kind &&
              open.mutate(
                { orderId: view.order.id, kind },
                {
                  onSuccess: () => {
                    toast.show({ message: t('dispute.submitted'), tone: 'success' });
                    onClose();
                  },
                  onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }),
                },
              )
            }
          />
        </>
      ) : (
        <>
          <Text color="textMuted">{t('track.dispute_after_delivery')}</Text>
          {onSupport ? <Button label={t('track.support')} icon="chat" fullWidth onPress={onSupport} testID="dispute-support-chat" /> : null}
        </>
      )}
      <Button label={t('action.close')} variant="ghost" fullWidth onPress={onClose} />
    </BottomPanel>
  );
}

// ───────────────────────── street hand-over ─────────────────────────

/** Street hand-over saves 250 (pricing: `streetHandover` −250). */
export const STREET_SAVING_IQD = 250;

/** Not offered while `LIVE_STREET_SWITCH_ENABLED` (./street-switch) is off: it calls no server yet (HUNT-01). */
export function StreetPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  return (
    <BottomPanel onClose={onClose} testID="street-panel">
      <Text variant="heading">{t('track.switch_street')}</Text>
      <Text color="textMuted">{t('track.switch_street_hint', { amount: amountParam(STREET_SAVING_IQD) })}</Text>
      {/* TODO(api): orders.switchHandover (re-quote −250 before pickup). Until then the courier is told by message. */}
      <Button
        label={t('action.confirm')}
        fullWidth
        onPress={() => {
          toast.show({ message: t('track.switch_street_sent'), tone: 'success' });
          onClose();
        }}
      />
      <Button label={t('cancel.keep')} variant="ghost" fullWidth onPress={onClose} />
    </BottomPanel>
  );
}

// ───────────────────────── unreachable protocol ─────────────────────────

/** Height the unreachable panel takes over the map (the camera keeps the courier above it). */
export const UNREACHABLE_PANEL_H = 360;

/**
 * The courier is at the door and cannot reach the customer (domain §2; joy f18, L-10). The map stays
 * undimmed with a ring around him, so the customer sees where he stands («حيدر واقف هنا · 40 متر من
 * بابك»). The timer is a small chip; the actions say what to do: «أني نازل» (2 more free minutes,
 * once — J-D8, server-side), a masked call, and sending him my location.
 */
export function UnreachablePanel({
  view,
  clock,
  courier,
  onComingOut,
  onCall,
  onSendLocation,
}: {
  view: OrderTracking;
  clock: () => number;
  courier: LatLng | null;
  /** Resolves true once the server took it. */
  onComingOut: () => Promise<boolean>;
  onCall: () => void;
  onSendLocation: () => Promise<boolean>;
}) {
  const theme = useTheme();
  const t = useT();
  const u = view.trip!.unreachable!;
  const started = u.startedAt.getTime();
  const total = u.failAllowedAt.getTime() - started;
  const left = unreachableLeftMs(u.failAllowedAt, clock());
  const [coming, setComing] = useState<'idle' | 'busy' | 'done'>(u.extendedAt ? 'done' : 'idle');
  const [location, setLocation] = useState<'idle' | 'busy' | 'done'>('idle');
  const door = view.dropoff?.pin ?? view.trip?.stops.find((s) => s.mine && s.type === 'dropoff')?.target ?? null;
  return (
    <BottomPanel testID="unreachable-panel" dim={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ flex: 1, gap: theme.space[1] }}>
          <Text variant="title">{t('unreachable.customer_title')}</Text>
          <Text variant="label" weight={600} testID="unreachable-standing">
            {standingLine(t, view.courier?.firstName ?? null, metresFromDoor(courier, door))}
          </Text>
        </View>
        {/* The timer, small (L-10): guidance first. It counts to the server's fail time, extended or not. */}
        <CountdownRing key={total} mode="accept" startedAt={started} durationMs={total} clock={clock} size={56} strokeWidth={5} format="clock" urgentMs={60_000} testID="unreachable-ring" />
      </View>
      <Text color="textMuted">{left <= 60_000 ? t('unreachable.customer_final') : t('unreachable.customer_body', { minutes: Math.ceil(left / 60_000) })}</Text>
      <Button
        label={coming === 'done' ? t('unreachable.coming_out_again') : t('unreachable.coming_out')}
        icon={coming === 'done' ? 'check' : 'location-arrow'}
        size="lg"
        fullWidth
        loading={coming === 'busy'}
        testID="coming-out"
        onPress={() => {
          setComing('busy');
          void onComingOut().then((ok) => setComing(ok ? 'done' : 'idle'));
        }}
      />
      <Button label={t('unreachable.call_hidden')} icon="phone" variant="secondary" fullWidth onPress={onCall} testID="unreachable-call" />
      <Button
        label={location === 'done' ? t('unreachable.location_sent') : t('unreachable.send_location')}
        icon={location === 'done' ? 'check' : 'map-pin'}
        variant="ghost"
        fullWidth
        loading={location === 'busy'}
        testID="unreachable-location"
        onPress={() => {
          setLocation('busy');
          void onSendLocation().then((ok) => setLocation(ok ? 'done' : 'idle'));
        }}
      />
    </BottomPanel>
  );
}
