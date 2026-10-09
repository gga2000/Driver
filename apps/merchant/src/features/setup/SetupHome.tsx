import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AdminMenu, FoodDoor, MerchantSetupView, StoreHoursView } from '@driver/contracts';
import { Button, EmptyState, ModalSheet, PhotoImage, Skeleton, Text, useTheme } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { MIcon } from '@/components/MIcon';
import { shiftLabel } from '@/features/hours/logic';
import { useStoreHours } from '@/features/hours/queries';
import { absoluteUrl, pickPhotos } from '@/features/menu/photo';
import { useMenu, usePhotoUpload } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { COUNTER } from '@/lib/counter';
import { SUPPORT_PHONE } from '@/lib/env';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { iqd } from '@/lib/money';
import { useCounterToast } from '@/lib/toast';
import { doorsOf, greetingName, voiceOf } from './logic';
import { openStep, setupLater, usePayoutLine } from './nav';
import { setupSession, useMe, useSetup, useSetupActions } from './queries';
import { SetupRing } from './SetupRing';
import { MissingTag, SetupSteps, stepHint, stepTitle } from './SetupSteps';
import { DoorChip } from './DoorChip';

/**
 * «جهّز محلك» (f2, f3, f4, f6): his own shop as Aziziyah will see it, the gaps lit saffron, a ring that
 * fills, the minutes left and one next step. «بعدين» is always there and nothing locks the board.
 * Owners only (s5): staff are sent back to the counter.
 */
export function SetupHome() {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const { store, canSeeMoney } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const setup = useSetup(storeId, canSeeMoney);
  const me = useMe();
  const menu = useMenu(canSeeMoney ? storeId : null);
  const hours = useStoreHours(canSeeMoney ? storeId : null);
  const payout = usePayoutLine(storeId, canSeeMoney);
  const [welcome, setWelcome] = useState(false);
  const v = setup.data;
  useEffect(() => {
    setupSession.landed = true;
    if (v && v.active && !v.live && !setupSession.welcomed && !v.progress.steps.some((x) => x.key === 'kind' && x.done)) {
      setupSession.welcomed = true;
      setWelcome(true);
    }
  }, [v]);

  if (store && !canSeeMoney) {
    return (
      <SafeAreaView testID="setup" style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center', padding: theme.space[5] }}>
        <EmptyState icon="shield" title={t('merchant.setup.staff_title')} body={t('merchant.setup.staff_body')} action={{ label: t('merchant.setup.to_board'), onPress: () => router.replace('/') }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView testID="setup" edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Loadable query={setup} stale={false} skeleton={<HomeSkeleton />} failed={t('merchant.setup.load_failed')} testID="setup-home">
        {(view) =>
          !view.active || view.live ? (
            <View style={{ flex: 1, justifyContent: 'center', padding: theme.space[5] }}>
              <EmptyState icon="check" title={t('merchant.setup.all_live_title')} body={t('merchant.setup.all_live_body')} action={{ label: t('merchant.setup.to_board'), onPress: () => router.replace('/') }} />
            </View>
          ) : (
            <Home view={view} name={greetingName(me.data?.name)} menu={menu.data} hours={hours.data} payout={payout} wide={wide} />
          )
        }
      </Loadable>
      {v ? (
        <ModalSheet visible={welcome} onClose={() => setWelcome(false)} title={t('merchant.setup.welcome_title', { shop: v.name })} testID="setup-welcome">
          <View style={{ gap: theme.space[4] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
              <SetupRing percent={v.progress.percent} size={84} label={t('merchant.setup.ring_label', { percent: v.progress.percent })} />
              <Text variant="body" style={{ flex: 1 }}>
                {t('merchant.setup.welcome_body', { done: v.progress.done, total: v.progress.total, minutes: v.progress.minutesLeft })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: COUNTER.sand }}>
              <MIcon name="clock" size={18} color={COUNTER.date} />
              <Text variant="footnote" weight={600} style={{ flex: 1, color: COUNTER.date }}>
                {t('merchant.setup.welcome_later')}
              </Text>
            </View>
            <Button testID="setup-welcome-go" label={t('merchant.setup.welcome_go')} size="lg" fullWidth onPress={() => setWelcome(false)} />
          </View>
        </ModalSheet>
      ) : null}
    </SafeAreaView>
  );
}

function HomeSkeleton() {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.space[5], gap: theme.space[4] }}>
      <Skeleton height={120} radius={theme.radius.xl} />
      <Skeleton height={260} radius={theme.radius.xl} />
      <Skeleton height={200} radius={theme.radius.xl} />
    </View>
  );
}

function Home({ view, name, menu, hours, payout, wide }: { view: MerchantSetupView; name: string | null; menu: AdminMenu | undefined; hours: StoreHoursView | undefined; payout: string | null; wide: boolean }) {
  const theme = useTheme();
  const t = useT();
  const voice = voiceOf(doorsOf(view));
  const next = view.progress.next;
  const shop = t(voice === 'drinks' ? 'merchant.setup.your_shop_drinks' : 'merchant.setup.your_shop');
  const header = (
    <View style={{ backgroundColor: COUNTER.date, borderRadius: wide ? theme.radius['2xl'] : 0, paddingHorizontal: theme.space[5], paddingVertical: theme.space[5], gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
        <View style={{ flex: 1, gap: theme.space[1] }}>
          <Text testID="setup-hello" accessibilityRole="header" style={[theme.face('display'), { color: COUNTER.onDate, fontSize: wide ? 30 : 24, lineHeight: wide ? 44 : 36 }]}>
            {name ? t('merchant.setup.hello', { name }) : t('merchant.setup.hello_plain')}
          </Text>
          <Text variant="body" style={{ color: COUNTER.onDateMuted }}>
            {t('merchant.setup.ready_line', { shop, percent: view.progress.percent })}
          </Text>
          <Text variant="footnote" weight={600} tabular style={{ color: COUNTER.onDateMuted }}>
            {view.progress.left === 1 ? t('merchant.setup.left_one', { minutes: view.progress.minutesLeft }) : t('merchant.setup.left_line', { count: view.progress.left, minutes: view.progress.minutesLeft })}
          </Text>
        </View>
        <SetupRing testID="setup-ring" percent={view.progress.percent} size={wide ? 104 : 84} onDark label={t('merchant.setup.ring_label', { percent: view.progress.percent })} />
      </View>
      <Pressable testID="setup-later" accessibilityRole="button" onPress={setupLater} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, borderWidth: 1, borderColor: COUNTER.dateEdge, opacity: pressed ? 0.75 : 1 })}>
        <Text variant="label" weight={700} style={{ color: COUNTER.onDate }}>
          {t('merchant.setup.later')}
        </Text>
      </Pressable>
    </View>
  );

  const steps = (
    <View testID="setup-list" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[4] }}>
        <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
          {t('merchant.setup.title')}
        </Text>
        <Text variant="label" weight={700} tabular style={{ color: COUNTER.newBadge }}>
          {t('merchant.setup.done_of', { done: view.progress.done, total: view.progress.total })}
        </Text>
      </View>
      <SetupSteps view={view} payoutLine={payout} onOpen={openStep} />
    </View>
  );

  const cta = (
    <View style={{ gap: theme.space[2] }}>
      {next ? (
        <Button testID="setup-next" label={t('merchant.setup.continue', { step: stepTitle(t, next, voice) })} size="lg" fullWidth onPress={() => openStep(next)} />
      ) : (
        <Button testID="setup-open" label={t('merchant.setup.raise_cta')} icon="arrow-forward" size="lg" fullWidth haptic="medium" onPress={() => router.push('/setup/open')} />
      )}
      <Pressable testID="setup-help" accessibilityRole="button" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2] }}>
        <MIcon name="phone" size={16} color="textMuted" />
        <Text variant="footnote" color="textMuted">
          {t('merchant.setup.help')}
        </Text>
      </Pressable>
    </View>
  );

  const preview = <ShopPreview view={view} menu={menu} hours={hours} wide={wide} />;

  return (
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: wide ? 1160 : 640, alignSelf: 'center', paddingHorizontal: wide ? theme.space[8] : 0, paddingTop: wide ? theme.space[6] : 0, paddingBottom: theme.space[10], gap: theme.space[5] }}>
      {header}
      {wide ? (
        <View style={{ flexDirection: 'row', gap: theme.space[5], alignItems: 'flex-start' }}>
          <View style={{ flex: 1.1 }}>{preview}</View>
          <View style={{ flex: 1, gap: theme.space[4] }}>
            {steps}
            {cta}
          </View>
        </View>
      ) : (
        <View style={{ paddingHorizontal: theme.space[4], gap: theme.space[4] }}>
          {preview}
          {steps}
          {cta}
        </View>
      )}
    </ScrollView>
  );
}

/**
 * f2: «هذا اللي يشوفه الزبون» — his shop as the customer app shows it, with every gap a small «ناقص» label
 * (d14: not a pulsing dot, which read as loading) that opens its step. The shop photo is optional (it never holds him back) but lit the same way.
 */
function ShopPreview({ view, menu, hours, wide }: { view: MerchantSetupView; menu: AdminMenu | undefined; hours: StoreHoursView | undefined; wide: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const upload = usePhotoUpload();
  const { shopPhoto } = useSetupActions();
  const [busy, setBusy] = useState(false);
  const doors = doorsOf(view);
  const kindsSet = view.kinds.confirmed !== null;
  const items = (menu?.categories ?? []).flatMap((c) => c.items).slice(0, 4);
  const hoursLine = hours && hours.source !== 'none' ? hoursSummary(t, hours, locale) : null;

  const addShopPhoto = async () => {
    const res = await pickPhotos('library');
    if (res === 'denied') return toast.show({ message: t('merchant.item.photo_denied'), tone: 'warning' });
    const p = res?.[0];
    if (!p) return;
    setBusy(true);
    try {
      const uploadId = await upload(p);
      await shopPhoto.mutateAsync({ merchantOrgId: view.merchantOrgId, uploadId });
      toast.show({ message: t('merchant.setup.shop_photo_saved'), tone: 'success', icon: 'check' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="setup-preview" style={{ backgroundColor: COUNTER.paper, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], backgroundColor: COUNTER.date }}>
        <MIcon name="user" size={16} color={COUNTER.onDateMuted} />
        <Text variant="caption" weight={600} style={{ flex: 1, color: COUNTER.onDateMuted }}>
          {t('merchant.setup.customer_sees')}
        </Text>
      </View>
      <Pressable testID="setup-gap-photo" accessibilityRole="button" accessibilityLabel={t('merchant.setup.shop_photo')} disabled={busy} onPress={() => void addShopPhoto()} style={{ height: wide ? 200 : 150, backgroundColor: COUNTER.sand, alignItems: 'center', justifyContent: 'center', gap: theme.space[2] }}>
        {view.shopPhotoUrl ? (
          <PhotoImage uri={absoluteUrl(view.shopPhotoUrl)} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, width: '100%', height: '100%' }} />
        ) : (
          <>
            <MissingTag testID="setup-missing-photo" />
            <View style={{ paddingHorizontal: theme.space[3], height: 30, borderRadius: 15, justifyContent: 'center', backgroundColor: COUNTER.paper }}>
              <Text variant="caption" weight={700} style={{ color: COUNTER.date }}>
                {busy ? t('merchant.setup.uploading') : t('merchant.setup.shop_photo')}
              </Text>
            </View>
          </>
        )}
      </Pressable>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Text style={[theme.face('display'), { flex: 1, minWidth: 140, color: COUNTER.date, fontSize: 22, lineHeight: 34 }]} numberOfLines={1}>
            {view.name}
          </Text>
          {kindsSet ? (
            doors.map((d: FoodDoor) => <DoorChip key={d} door={d} small />)
          ) : (
            <Pressable testID="setup-gap-kind" accessibilityRole="button" onPress={() => openStep('kind')} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44 }}>
              <MissingTag />
              <Text variant="label" weight={700} style={{ color: COUNTER.newBadge }}>
                {t('merchant.setup.step_kind')}
              </Text>
            </Pressable>
          )}
        </View>
        <Pressable testID="setup-gap-hours" accessibilityRole="button" onPress={() => openStep('hours')} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44 }}>
          {hoursLine ? <MIcon name="clock" size={16} color="textMuted" /> : <MissingTag />}
          <Text variant="footnote" color={hoursLine ? 'textMuted' : 'text'} weight={hoursLine ? 400 : 700} tabular style={{ flex: 1 }}>
            {hoursLine ? t('merchant.setup.hours_preview', { hours: hoursLine }) : t('merchant.setup.hours_missing')}
          </Text>
        </Pressable>
        {items.length === 0 ? (
          <Pressable testID="setup-gap-menu" accessibilityRole="button" onPress={() => openStep('menu')} style={{ minHeight: 96, borderRadius: theme.radius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: COUNTER.saffron, alignItems: 'center', justifyContent: 'center', gap: theme.space[2], padding: theme.space[3] }}>
            <MissingTag />
            <Text variant="label" weight={700} style={{ color: COUNTER.newBadge }} align="center">
              {view.menu.pendingCards > 0 || view.menu.cards === 'reading' ? stepHint(t, view, 'menu', null) : t('merchant.setup.menu_empty_gap')}
            </Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {items.map((i) => (
              <Pressable key={i.id} accessibilityRole="button" accessibilityLabel={i.nameAr} onPress={() => openStep(i.photoUrl ? 'menu' : 'photos')} style={{ flexBasis: '47%', flexGrow: 1, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
                <View style={{ aspectRatio: 4 / 3, backgroundColor: COUNTER.sand, alignItems: 'center', justifyContent: 'center' }}>
                  {i.photoUrl ? <Image source={{ uri: absoluteUrl(i.photoUrl) }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <MissingTag />}
                </View>
                <View style={{ padding: theme.space[2] }}>
                  <Text variant="label" weight={700} numberOfLines={1}>
                    {i.nameAr}
                  </Text>
                  <Text variant="caption" color="textMuted" tabular>
                    {iqd(i.priceIqd, { locale })}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

/** The week in one line for the preview: the usual shift (the most common), Friday when it differs. */
function hoursSummary(t: ReturnType<typeof useT>, hours: StoreHoursView, locale: ReturnType<typeof useLocale>): string {
  const sat = hours.days.find((d) => d.dow === 6) ?? hours.days[0];
  const main = sat?.shifts[0];
  if (!main) return t('merchant.setup.hours_custom');
  return shiftLabel(t, main, locale);
}
