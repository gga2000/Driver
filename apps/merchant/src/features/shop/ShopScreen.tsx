import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import type { MerchantInsights, StoreHoursView, StoreStatusView } from '@driver/contracts';
import { Skeleton, Text, useTheme } from '@driver/ui';
import { EntryTile } from '@/components/EntryTile';
import { MIcon, type MIconName } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { Panel } from '@/components/Panel';
import { shiftLabel, stateLine } from '@/features/hours/logic';
import { useStoreHours } from '@/features/hours/queries';
import { useInsights } from '@/features/insights/queries';
import { unregisterPush } from '@/features/notify/Push';
import { closedToast, CloseStoreSheet } from '@/features/store/StoreSheets';
import { useCurrentStore, useStoreStatus, useStoreSwitches } from '@/features/store/queries';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { localDayKey, localParts } from '@/lib/calendar';
import { COUNTER } from '@/lib/counter';
import { useDates } from '@/lib/dates';
import { SUPPORT_PHONE } from '@/lib/env';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { session } from '@/lib/session';
import { clock12 } from '@/lib/time';
import { useCounterToast } from '@/lib/toast';
import { quickPauses, type QuickPause } from './pauses';
import { Shutter } from './Shutter';
import { weekRuns } from './week';

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const PAUSE_ICON: Record<QuickPause['id'], MIconName> = { prayer: 'moon', power: 'power', sold_out: 'utensils' };

/**
 * «المحل» (counter step 5, g1 h1–h3 x1–x3): the shop itself. On top its shutter (one tap opens or closes,
 * customers see the same shutter) and the four pauses a shop takes most, each one tap and each opening
 * again by itself; then the week's hours; then why customers pick it, written from its own numbers; then
 * everything that used to sit under «المزيد» (staff, printer, deals, photos, settings…).
 */
export function ShopScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const dates = useDates();
  const toast = useCounterToast();
  const { wide } = useLayout();
  const { store, stores, canSeeMoney } = useCurrentStore();
  const orgId = store?.orgId ?? null;
  const status = useStoreStatus(orgId);
  const hours = useStoreHours(orgId);
  const insights = useInsights(orgId, 30);
  const { setOpen } = useStoreSwitches();
  const now = useNow();
  const [closing, setClosing] = useState<'shutter' | 'other' | null>(null);
  const client = useApiClient();
  const s = status.data;

  const signOut = async () => {
    const refreshToken = session.getSnapshot().session?.refreshToken;
    await unregisterPush(client);
    await client.identity.logout.mutate(refreshToken ? { refreshToken } : {}).catch(() => undefined);
    await session.signOut();
  };
  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
  const reopen = async () => {
    if (!s) return;
    try {
      await setOpen.mutateAsync({ merchantOrgId: s.merchantOrgId, open: true });
      toast.show({ message: t('merchant.status.opened'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };
  const pause = async (p: QuickPause) => {
    if (!s) return;
    try {
      await setOpen.mutateAsync({ merchantOrgId: s.merchantOrgId, open: false, reason: p.reason, ...(p.note ? { note: p.note } : {}), ...(p.minutes !== null ? { pauseMinutes: p.minutes } : {}) });
      toast.show({ message: closedToast(t, p.reason, p.minutes, Date.now()), tone: 'neutral', icon: 'clock' });
    } catch (err) {
      fail(err);
    }
  };

  const grid = { flexDirection: wide ? ('row' as const) : ('column' as const), flexWrap: 'wrap' as const, gap: theme.space[3] };
  const cell = wide ? { flexBasis: '31%' as const, flexGrow: 1 } : undefined;
  const tiles: { id: string; icon: MIconName; title: string; hint: string; href: Parameters<typeof router.push>[0]; owner?: boolean }[] = [
    { id: 'staff', icon: 'people', title: t('merchant.more.staff'), hint: t('merchant.more.staff_hint'), href: '/staff', owner: true },
    { id: 'printer', icon: 'printer', title: t('merchant.printer.title'), hint: t('merchant.more.printer_hint'), href: '/printer' },
    { id: 'deals', icon: 'tag', title: t('merchant.more.deals'), hint: t('merchant.more.deals_hint'), href: '/deals' },
    { id: 'menu-photos', icon: 'utensils', title: t('merchant.more.menu_photos'), hint: t('merchant.more.menu_photos_hint'), href: '/menu-photos' },
    { id: 'pot', icon: 'flame', title: t('merchant.pot.title'), hint: t('merchant.more.pot_hint'), href: '/pot' },
    { id: 'story', icon: 'store', title: t('merchant.story.title'), hint: t('merchant.more.story_hint'), href: '/story' },
    { id: 'pickup-spot', icon: 'map-pin', title: t('merchant.more.pickup_spot'), hint: t('merchant.more.pickup_spot_hint'), href: '/pickup-spot' },
    { id: 'delivery-area', icon: 'grid', title: t('merchant.more.delivery_area'), hint: t('merchant.more.delivery_area_hint'), href: '/delivery-area' },
    { id: 'settings', icon: 'sliders', title: t('merchant.more.settings'), hint: t('merchant.more.settings_hint'), href: '/settings' },
  ];

  const front = s ? (
    <View style={{ gap: theme.space[4] }}>
      <ShopFront status={s} hours={hours.data} wide={wide} busy={setOpen.isPending} onClose={() => setClosing('shutter')} onOpen={() => void reopen()} />
      <Pauses status={s} hours={hours.data} now={now} wide={wide} busy={setOpen.isPending} onPause={(p) => void pause(p)} onOther={() => setClosing('other')} />
    </View>
  ) : (
    <Skeleton height={wide ? 330 : 300} radius={theme.radius.xl} />
  );
  const side = (
    <View style={{ gap: theme.space[4] }}>
      <WeekPanel hours={hours.data} dayMonth={(d) => dates.dayMonth(new Date(`${d}T12:00:00+03:00`))} />
      <WhyPanel data={insights.data} />
    </View>
  );

  return (
    <Page title={t('merchant.shop.title')} subtitle={store?.name} testID="more" maxWidth={1160}>
      <View testID="shop" style={{ flexDirection: wide ? 'row' : 'column', gap: theme.space[4], alignItems: wide ? 'flex-start' : 'stretch' }}>
        <View style={wide ? { flex: 1.15 } : undefined}>{front}</View>
        <View style={wide ? { flex: 1 } : undefined}>{side}</View>
      </View>
      <View style={grid}>
        {tiles
          .filter((x) => !x.owner || canSeeMoney)
          .map((x) => (
            <View key={x.id} style={cell}>
              <EntryTile testID={`more-${x.id}`} icon={x.icon} title={x.title} hint={x.hint} onPress={() => router.push(x.href)} />
            </View>
          ))}
      </View>
      <View style={{ gap: theme.space[3] }}>
        {stores.length > 1 ? <EntryTile icon="swap" title={t('merchant.more.switch_store')} hint={store?.name} onPress={() => router.push('/stores')} /> : null}
        <EntryTile icon="phone" title={t('merchant.more.support')} onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
        <EntryTile testID="sign-out" icon="sign-out" title={t('merchant.more.sign_out')} tone="danger" onPress={() => void signOut()} trailing={<View />} />
      </View>
      <Text variant="caption" color="textMuted" align="center">
        {t('merchant.settings.version', { version: '0.1.0' })}
      </Text>
      {s ? <CloseStoreSheet status={s} visible={closing !== null} lengths onClose={() => setClosing(null)} /> : null}
    </Page>
  );
}

/** The shutter with its line, and what a customer sees right now (x4). */
function ShopFront({ status, hours, wide, busy, onClose, onOpen }: { status: StoreStatusView; hours: StoreHoursView | undefined; wide: boolean; busy: boolean; onClose: () => void; onOpen: () => void }) {
  const theme = useTheme();
  const t = useT();
  const dates = useDates();
  const closed = status.closed;
  const prayer = status.pause !== null && closed === null;
  const back = closed?.until ? clock12(closed.until) : prayer ? status.pause!.until : null;
  const line = closed
    ? back
      ? t('merchant.shop.closed_until', { time: back })
      : t('merchant.status.closed')
    : prayer
      ? t('merchant.status.paused', { time: status.pause!.until })
      : hours
        ? stateLine(t, hours, (d) => dates.dayMonth(new Date(`${d}T12:00:00+03:00`)))
        : t('merchant.status.open');
  const customer = closed || prayer ? (back ? t('merchant.shop.customer_sees_closed_until', { time: back }) : t('merchant.shop.customer_sees_closed')) : status.schedule && !status.schedule.inHours ? t('merchant.shop.customer_sees_out') : t('merchant.shop.customer_sees_open');
  const open = status.open;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Shutter
        storeName={status.name}
        open={open}
        line={line}
        note={back ? t('merchant.shop.back_at', { time: back }) : null}
        label={`${status.name} · ${line}`}
        hint={prayer ? t('merchant.shop.prayer_hint') : open ? t('merchant.shop.tap_close') : t('merchant.shop.tap_open')}
        disabled={busy || prayer}
        wide={wide}
        onPress={open ? onClose : onOpen}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[2] }}>
        <MIcon name="user" size={16} color="textMuted" />
        <Text testID="customer-sees" variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {customer}
        </Text>
      </View>
    </View>
  );
}

/** «وقفة قصيرة»: four one-tap pauses (h2). Orders already in keep going. */
function Pauses({ status, hours, now, wide, busy, onPause, onOther }: { status: StoreStatusView; hours: StoreHoursView | undefined; now: number; wide: boolean; busy: boolean; onPause: (p: QuickPause) => void; onOther: () => void }) {
  const theme = useTheme();
  const t = useT();
  const off = !status.open;
  const pauses = quickPauses(hours, now, { friday: t('merchant.shop.pause_friday_note'), prayer: t('merchant.shop.pause_prayer_note') });
  const dates = useDates();
  const sub = (p: QuickPause) => {
    if (p.until === null) return t('merchant.shop.until_hand');
    if (p.id === 'sold_out')
      return localDayKey(p.until) === localDayKey(now + 86_400_000) ? t('merchant.shop.until_tomorrow', { time: clock12(p.until) }) : t('merchant.shop.until_day', { day: dates.dow(localParts(p.until).dow), time: clock12(p.until) });
    return p.friday ? t('merchant.shop.until_time', { time: clock12(p.until) }) : t('merchant.common.minutes', { minutes: p.minutes ?? 0 });
  };
  const title = (p: QuickPause): TKey => (p.id === 'prayer' ? (p.friday ? 'merchant.shop.pause_friday' : 'merchant.shop.pause_prayer') : p.id === 'power' ? 'merchant.shop.pause_power' : 'merchant.shop.pause_sold_out');
  return (
    <Panel title={t('merchant.shop.pauses_title')} caption={off ? t('merchant.shop.pauses_closed') : t('merchant.shop.pauses_body')} icon="pause" testID="pauses">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {pauses.map((p) => (
          <PauseChip key={p.id} testID={`pause-${p.id}`} icon={PAUSE_ICON[p.id]} title={t(title(p))} sub={sub(p)} wide={wide} disabled={off || busy} onPress={() => onPause(p)} />
        ))}
        <PauseChip testID="pause-other" icon="sliders" title={t('merchant.shop.pause_other')} sub={t('merchant.shop.pause_other_sub')} wide={wide} disabled={off || busy} onPress={onOther} />
      </View>
    </Panel>
  );
}

/** Two to a row on a tablet; one per row on a phone, so «لباچر · يفتح 1:15 م» is never cut. */
function PauseChip({ icon, title, sub, wide, disabled, onPress, testID }: { icon: MIconName; title: string; sub: string; wide: boolean; disabled: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title} · ${sub}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        theme.haptic('medium');
        onPress();
      }}
      style={({ pressed }) => ({
        flexBasis: wide ? '47%' : '100%',
        flexGrow: 1,
        minHeight: wide ? 64 : 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: theme.space[3],
        paddingVertical: theme.space[2],
        borderRadius: theme.radius.lg,
        backgroundColor: COUNTER.paper,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: COUNTER.sand }}>
        <MIcon name={icon} size={20} color={COUNTER.date} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

/** «الدوام بالأسبوع» (h3): the week folded into a few lines, «عدّل» opens the hours screen. */
function WeekPanel({ hours, dayMonth }: { hours: StoreHoursView | undefined; dayMonth: (date: string) => string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const edit = (
    <Pressable testID="shop-hours-edit" accessibilityRole="button" hitSlop={10} onPress={() => router.push('/hours')} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space[2] }}>
      <Text variant="label" weight={700} color="accentText">
        {hours?.canEdit ? t('merchant.shop.edit') : t('merchant.shop.see')}
      </Text>
    </Pressable>
  );
  const day = (dow: number) => t(`merchant.date.dow_${dow}` as TKey);
  return (
    <Panel title={t('merchant.shop.week_title')} icon="clock" aside={edit} testID="shop-week">
      {!hours ? (
        <Skeleton height={64} />
      ) : hours.source === 'none' ? (
        <Text variant="body" color="textMuted">
          {t('merchant.shop.week_none')}
        </Text>
      ) : (
        <View style={{ gap: theme.space[2] }}>
          {weekRuns(hours.days).map((r) => (
            <View key={r.from} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
              <Text variant="bodyStrong" style={{ width: 128 }}>
                {r.from === r.to ? day(r.from) : `${day(r.from)}–${day(r.to)}`}
              </Text>
              <Text variant="body" color={r.shifts.length ? 'text' : 'textMuted'} tabular style={{ flex: 1 }}>
                {r.shifts.length ? r.shifts.map((x) => shiftLabel(t, x, locale)).join('، ') : t('merchant.shop.day_closed')}
              </Text>
            </View>
          ))}
          {hours.holidays[0] ? (
            <Text variant="footnote" color="warningText">
              {t('merchant.hours.state_holiday', { date: dayMonth(hours.holidays[0].to) })}
            </Text>
          ) : null}
        </View>
      )}
    </Panel>
  );
}

/**
 * «ليش الزبون يختارك» (x1–x3): the shop's own numbers that customers' «أحسن 3» reasons are made from,
 * the dish it is known for, and how to earn a place. Written by Driver from real orders, never bought.
 */
function WhyPanel({ data }: { data: MerchantInsights | undefined }) {
  const theme = useTheme();
  const t = useT();
  const onTime = data?.prepHonesty.onTimeShare;
  const prep = data?.prepHonesty.actualAvgMin;
  const signature = data?.bestSellers[0]?.nameAr ?? null;
  const facts = [
    onTime !== null && onTime !== undefined ? t('merchant.shop.why_on_time', { percent: Math.round(onTime * 100) }) : null,
    prep !== null && prep !== undefined ? t('merchant.shop.why_prep', { minutes: Math.round(prep) }) : null,
    signature ? t('merchant.shop.why_signature', { name: signature }) : null,
  ].filter((x): x is string => x !== null);
  return (
    <Panel title={t('merchant.shop.why_title')} caption={t('merchant.shop.why_caption')} icon="star" testID="shop-why">
      {!data ? (
        <Skeleton height={72} />
      ) : (
        <View style={{ gap: theme.space[2] }}>
          {facts.length === 0 ? (
            <Text variant="body" color="textMuted">
              {t('merchant.shop.why_none')}
            </Text>
          ) : (
            facts.map((f) => (
              <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <MIcon name="check" size={18} color="successText" strokeWidth={2.2} />
                <Text variant="body" style={{ flex: 1 }}>
                  {f}
                </Text>
              </View>
            ))
          )}
          <View style={{ marginTop: theme.space[1], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: COUNTER.sand }}>
            <Text variant="footnote" weight={600} style={{ color: COUNTER.date }}>
              {t('merchant.shop.why_earn')}
            </Text>
          </View>
        </View>
      )}
    </Panel>
  );
}
