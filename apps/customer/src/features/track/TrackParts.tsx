import { color as palette } from '@driver/design-tokens';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import type { CourierCard as CourierCardData } from '@driver/contracts';
import { Avatar, formatClock, Icon, IconButton, Text, usePulse, useTheme, useToast } from '@driver/ui';
import { router } from 'expo-router';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { apiPhoto } from '@/lib/photo';
import type { MoneyLine, RoadDot, RoadKey } from './track-v2';
import { notesFor } from './track-v2';

/**
 * The parts of the redesigned live order (after-order design Step 3, switch `track_v2`): the top bar,
 * the four-dot road (t4), the one time box and the one money line (t3), the courier docked at the
 * bottom with chat first and the call greyed «قريباً» (t5, calls are postponed), the near card with
 * the cash in big digits (a1) and the cash card at the door (a2). Colours from the theme only: saffron
 * for what moves, the ink box for the one time on screen, no teal.
 */

// ───────────────────────── top bar ─────────────────────────

/** Back, the order number, and «شارك» once a courier carries it (the family follows on a link). */
export function TrackTopBar({ orderNo, onShare, floating = false, top = 0 }: { orderNo?: string; onShare?: () => void; floating?: boolean; top?: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      pointerEvents="box-none"
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: theme.space[2] },
        floating ? { position: 'absolute', top: top + theme.space[3], left: theme.space[4], right: theme.space[4] } : { paddingTop: top + theme.space[3], paddingBottom: theme.space[2] },
      ]}
    >
      <IconButton
        icon="chevron-back"
        variant="outline"
        accessibilityLabel={t('action.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/orders'))}
        style={{ backgroundColor: theme.colors.surface }}
        testID="track-back"
      />
      {orderNo ? (
        <View testID="track-order-no" style={{ paddingHorizontal: theme.space[3], height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: theme.colors.inverse }}>
          <Text variant="label" weight={600} color="onInverse" tabular>
            {orderNo}
          </Text>
        </View>
      ) : null}
      {onShare ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('track2.share_a11y')}
          onPress={onShare}
          testID="track-share"
          style={({ pressed }) => ({
            marginStart: 'auto',
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[1],
            paddingHorizontal: theme.space[3],
            borderRadius: 22,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon name="share" size={16} color="text" strokeWidth={2.2} />
          <Text variant="label" weight={600}>
            {t('track2.share')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ───────────────────────── the four-dot road (t4) ─────────────────────────

const ROAD_LABEL: Record<RoadKey, 'track2.road_accepted' | 'track2.road_cooking' | 'track2.road_on_the_way' | 'track2.road_at_you'> = {
  accepted: 'track2.road_accepted',
  cooking: 'track2.road_cooking',
  on_the_way: 'track2.road_on_the_way',
  at_you: 'track2.road_at_you',
};
const DOT = 22;

/**
 * «انقبل · يطبخون · بالطريق · عندك»: done dots are saffron with a check and their time, the current
 * one a ring (breathing only while its event has happened), the rest a plain track. Before the
 * kitchen's yes the first dot reads «ينتظر». One sentence for screen readers.
 */
export function RoadDots({ dots, testID = 'track-road' }: { dots: readonly RoadDot[]; testID?: string }) {
  const t = useT();
  const label = (d: RoadDot) => (d.key === 'accepted' && d.state !== 'done' ? t('track2.road_waiting') : t(ROAD_LABEL[d.key]));
  const spoken = dots
    .filter((d) => d.state !== 'todo')
    .map((d) => t(d.state === 'done' ? 'kitchen.step_done_a11y' : 'kitchen.step_current_a11y', { step: label(d) }))
    .join('، ');
  return (
    <View testID={testID} accessible accessibilityRole="progressbar" accessibilityLabel={t('kitchen.steps_a11y', { steps: spoken })} style={{ flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'stretch' }}>
      {dots.map((d, i) => (
        <RoadStop key={d.key} dot={d} label={label(d)} first={i === 0} last={i === dots.length - 1} nextReached={dots[i + 1] ? dots[i + 1]!.state !== 'todo' : false} />
      ))}
    </View>
  );
}

function RoadStop({ dot, label, first, last, nextReached }: { dot: RoadDot; label: string; first: boolean; last: boolean; nextReached: boolean }) {
  const theme = useTheme();
  const done = dot.state === 'done';
  const current = dot.state === 'current';
  const pulse = usePulse(dot.live);
  const lineOn = theme.colors.accent;
  const lineOff = theme.colors.border;
  return (
    <View testID={`road-${dot.key}`} style={{ flex: 1, alignItems: 'center', gap: theme.space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
        <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: first ? 'transparent' : done || current ? lineOn : lineOff }} />
        <View style={{ width: DOT, height: DOT, alignItems: 'center', justifyContent: 'center' }}>
          {current && dot.live ? <Animated.View style={[{ position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.colors.accentTint }, pulse]} /> : null}
          <View
            style={{
              width: DOT,
              height: DOT,
              borderRadius: DOT / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: done ? theme.colors.accent : current ? theme.colors.surface : theme.colors.surfaceSunken,
              borderWidth: current ? 3 : 0,
              borderColor: theme.colors.accent,
            }}
          >
            {done ? <Icon name="check" size={13} color="onAccent" strokeWidth={3} /> : current ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent }} /> : null}
          </View>
        </View>
        <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: last ? 'transparent' : done && nextReached ? lineOn : lineOff }} />
      </View>
      <Text variant="caption" weight={current ? 700 : done ? 600 : 400} color={current ? 'accentText' : done ? 'text' : 'textMuted'} align="center" numberOfLines={1}>
        {label}
      </Text>
      {dot.at ? (
        <Text variant="caption" color="textMuted" tabular style={{ marginTop: -2 }}>
          {formatClock(dot.at, { period: false })}
        </Text>
      ) : null}
    </View>
  );
}

// ───────────────────────── the one time (t3) ─────────────────────────

/**
 * «يوصلك 5:44 · 28 دقيقة» on the ink box, the one dark card on screen. Running late (t8) it turns light
 * and says «الوقت الجديد», so the late banner above is the only dark thing then.
 */
export function TimeBox({ eta, now, late }: { eta: Date; now: number; late: boolean }) {
  const theme = useTheme();
  const t = useT();
  const minutes = Math.max(1, Math.round((eta.getTime() - now) / 60_000));
  const label = late ? t('track2.eta_new') : t('track.eta_label');
  const mins = t('track.eta_minutes', { minutes });
  return (
    <View
      testID="track-time"
      accessible
      accessibilityLabel={`${label} ${formatClock(eta)}، ${mins}`}
      style={{ minWidth: 96, alignItems: 'center', justifyContent: 'center', paddingVertical: theme.space[2], paddingHorizontal: theme.space[3], borderRadius: theme.radius.xl, backgroundColor: late ? theme.colors.accentTint : theme.colors.inverse }}
    >
      <Text variant="caption" weight={600} color={late ? 'accentText' : 'onInverseMuted'}>
        {label}
      </Text>
      <Text variant="display" tabular color={late ? 'accentText' : 'onInverseAccent'} style={{ fontSize: 30, lineHeight: 40 }} testID="track-time-clock">
        {formatClock(eta, { period: false })}
      </Text>
      <Text variant="caption" color={late ? 'accentText' : 'onInverseMuted'} tabular>
        {mins}
      </Text>
    </View>
  );
}

// ───────────────────────── the one money line (t3) ─────────────────────────

/** «جهّز 20,000 دينار» and, under it, what the note covers; the wallet: «مدفوع من محفظتك». */
export function MoneyLineView({ money, compact = false }: { money: MoneyLine; compact?: boolean }) {
  const theme = useTheme();
  const t = useT();
  if (money.kind === 'paid') {
    return (
      <View testID="track-money" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="wallet" size={18} color="successText" strokeWidth={2.2} />
        <Text variant="label" weight={600} color="successText" tabular style={{ flexShrink: 1 }}>
          {t('track.paid_wallet', { amount: amountParam(money.amountIqd) })}
        </Text>
      </View>
    );
  }
  const sub =
    money.tenderChangeIqd > 0
      ? t('track2.money_change', { total: amountParam(money.totalIqd), change: amountParam(money.tenderChangeIqd) })
      : money.roundedIqd > 0
        ? t('track2.money_rounded', { price: amountParam(money.totalIqd - money.roundedIqd), change: amountParam(money.roundedIqd) })
        : null;
  return (
    <View testID="track-money" style={{ gap: 2, flexShrink: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="cash" size={compact ? 16 : 20} color="accentText" strokeWidth={2.2} />
        <Text variant={compact ? 'label' : 'title'} weight={700} tabular testID="track-money-hand" style={{ flexShrink: 1 }}>
          {t('track2.money_cash', { amount: amountParam(money.handIqd) })}
        </Text>
      </View>
      {sub ? (
        <Text variant="caption" color="textMuted" tabular>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

// ───────────────────────── courier docked (t5, t6) ─────────────────────────

/**
 * Who brings it, docked at the bottom: his approved photo (or his initial), his name, where he is,
 * chat first in saffron (with the unread count), and the call greyed «قريباً» (calls are postponed,
 * before-launch §1): tapping it says so instead of looking broken.
 */
export function DockedCourier({ courier, line, unread, canChat, onChat }: { courier: CourierCardData; line: string | null; unread: number; canChat: boolean; onChat: () => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const name = courier.firstName ?? t('track.courier_fallback');
  const rating = courier.rating ? `★ ${courier.rating.toFixed(1)}` : null;
  return (
    <View
      testID="track-courier"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}
    >
      <Avatar name={name} uri={apiPhoto(courier.photoUrl) ?? undefined} size={48} ring={Boolean(courier.verifiedTodayAt)} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={2} tabular>
          {[line, rating].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('track.call_soon')}
        onPress={() => toast.show({ message: t('track.call_soon'), tone: 'info', icon: 'phone' })}
        testID="track-call-soon"
        style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
          <Icon name="phone" size={18} color="textMuted" />
        </View>
        <Text variant="caption" color="textMuted" style={{ fontSize: 10, lineHeight: 14 }}>
          {t('track2.call_soon')}
        </Text>
      </Pressable>
      {canChat ? (
        <IconButton
          icon="chat"
          variant="accent"
          size={44}
          badge={unread > 0 ? unread : undefined}
          accessibilityLabel={unread > 0 ? `${t('track.message_courier')} · ${t('chat.unread_label', { count: unread })}` : t('track.message_courier')}
          onPress={onChat}
          testID="track-chat"
        />
      ) : null}
    </View>
  );
}

// ───────────────────────── near (a1) ─────────────────────────

/**
 * «حيدر قريب، جهّز» over the map with the cash in big digits, so the note is in hand before the knock;
 * the wallet: «الطلب مدفوع، بس استعد للباب». Announced at once to screen readers.
 */
export function NearCard({ name, money, top, onClose }: { name: string | null; money: MoneyLine; top: number; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Animated.View
      testID="track-near"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      entering={theme.reduceMotion ? undefined : FadeInDown.duration(260)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(180)}
      style={{
        position: 'absolute',
        top,
        left: theme.space[4],
        right: theme.space[4],
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[4],
        paddingEnd: theme.space[2],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 2,
        borderColor: theme.colors.accent,
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.16,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 5,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={700}>
          {name ? t('track2.near_title', { name }) : t('track2.near_title_any')}
        </Text>
        {money.kind === 'cash' ? (
          <>
            <Text variant="display" tabular color="accentText" style={{ fontSize: 34, lineHeight: 46 }} testID="track-near-amount">
              {`${amountParam(money.handIqd)} ${t('quote.currency')}`}
            </Text>
            {money.tenderChangeIqd > 0 ? (
              <Text variant="caption" color="textMuted" tabular>
                {t('track2.money_change', { total: amountParam(money.totalIqd), change: amountParam(money.tenderChangeIqd) })}
              </Text>
            ) : null}
          </>
        ) : (
          <Text variant="footnote" color="textMuted">
            {t('track.near_paid')}
          </Text>
        )}
      </View>
      <IconButton icon="x" variant="plain" accessibilityLabel={t('action.close')} onPress={onClose} testID="track-near-close" />
    </Animated.View>
  );
}

// ───────────────────────── at the door (a2) ─────────────────────────

/**
 * The cash card at the door: «جهّز للدليفري 20,000» in big saffron digits on ink, the notes that make
 * it (two 10,000s; there is no 20,000 note), and what the note covers: the change comes back in cash,
 * or as credit only if he has none. The wallet: nothing to hand over.
 */
export function DoorCash({ money }: { money: MoneyLine }) {
  const theme = useTheme();
  const t = useT();
  if (money.kind === 'paid') {
    return (
      <View testID="door-paid" style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius['2xl'], backgroundColor: theme.colors.successTint }}>
        <Icon name="wallet" size={24} color="successText" strokeWidth={2.2} />
        <Text variant="title" weight={700} color="successText" style={{ flex: 1 }}>
          {t('track.door_paid')}
        </Text>
      </View>
    );
  }
  const notes = notesFor(money.handIqd);
  return (
    <View
      testID="door-cash"
      accessible
      accessibilityLabel={`${t('track2.door_hand')} ${t('tip.chip', { amount: amountParam(money.handIqd) })}${notes ? `، ${t('track2.notes_a11y', { notes: notes.map((n) => amountParam(n)).join(' + ') })}` : ''}`}
      style={{ alignSelf: 'stretch', alignItems: 'center', gap: theme.space[2], paddingVertical: theme.space[5], paddingHorizontal: theme.space[4], borderRadius: theme.radius['2xl'], backgroundColor: theme.colors.inverse }}
    >
      <Text variant="label" weight={600} color="onInverseMuted">
        {t('track2.door_hand')}
      </Text>
      <Text variant="display" tabular color="onInverseAccent" style={{ fontSize: 48, lineHeight: 64 }} testID="door-cash-amount">
        {amountParam(money.handIqd)}
      </Text>
      {notes && notes.length > 1 ? (
        <View testID="door-notes" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: theme.space[2] }}>
          {notes.map((n, i) => (
            <View key={`${n}-${i}`} style={{ paddingHorizontal: theme.space[2], paddingVertical: 2, borderRadius: theme.radius.sm, backgroundColor: theme.colors.onInverse }}>
              <Text variant="caption" weight={700} tabular color="inverse">
                {amountParam(n)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text variant="caption" color="onInverseCaution" align="center" tabular>
        {money.tenderChangeIqd > 0
          ? t('track2.door_change', { total: amountParam(money.totalIqd), change: amountParam(money.tenderChangeIqd) })
          : money.roundedIqd > 0
            ? t('track2.money_rounded', { price: amountParam(money.totalIqd - money.roundedIqd), change: amountParam(money.roundedIqd) })
            : t('track2.door_exact', { total: amountParam(money.totalIqd) })}
      </Text>
    </View>
  );
}

/** Two quiet buttons at the bottom of the live order: «التفاصيل» and «تحتاج شي؟» (t10). */
export function TrackFooter({ onDetails, onHelp, children }: { onDetails: () => void; onHelp: () => void; children?: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[2] }}>
      {children}
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <FooterButton label={t('track2.details')} icon="receipt" onPress={onDetails} testID="track-details" />
        <FooterButton label={t('track.actions_title')} icon="chat" onPress={onHelp} testID="track-help" />
      </View>
    </View>
  );
}

function FooterButton({ label, icon, onPress, testID }: { label: string; icon: 'receipt' | 'chat'; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space[2],
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.borderStrong,
        backgroundColor: theme.colors.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={18} color="text" />
      <Text variant="label" weight={600}>
        {label}
      </Text>
    </Pressable>
  );
}
