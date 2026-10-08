import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { View } from 'react-native';
import type { SetupCheck } from '@driver/contracts';
import { Button, Skeleton, Text, useTheme } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { MIcon, type MIconName } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { useStartPractice } from '@/features/board/LearnCards';
import { useCurrentStore } from '@/features/store/queries';
import { testChime } from '@/lib/alert-sound';
import { apiErrorMessage } from '@/lib/api';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { requestWakeLock } from '@/lib/keep-awake';
import { prefs } from '@/lib/prefs';
import { useCounterToast } from '@/lib/toast';
import { setupSession, useSetup, useSetupActions } from './queries';
import { usePayoutLine } from './nav';

/**
 * «جرّب الكاونتر» (c1–c4): one short list, each one tap — the order sound, the screen staying on, where
 * couriers wait (one photo), how his money reaches him (seen once, «صح»), the printer (optional, never
 * red) and a practice order on the board (no customer, no courier, no money).
 */
export function CounterScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const setup = useSetup(storeId);
  const payout = usePayoutLine(storeId, true);
  const { check, seePayout } = useSetupActions();
  const startPractice = useStartPractice();
  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
  const mark = async (merchantOrgId: string, c: SetupCheck) => {
    try {
      await check.mutateAsync({ merchantOrgId, check: c });
    } catch (err) {
      fail(err);
    }
  };

  return (
    <Page title={t('merchant.setup.counter_title')} subtitle={t('merchant.setup.counter_sub')} back testID="setup-counter" maxWidth={680}>
      <Loadable query={setup} stale={false} skeleton={<Skeleton height={420} radius={theme.radius.xl} />} failed={t('merchant.setup.load_failed')} testID="setup-counter">
        {(view) => {
          const id = view.merchantOrgId;
          const sound = async () => {
            await prefs.setSound(true);
            const ok = await testChime();
            if (!ok) return toast.show({ message: t('merchant.settings.test_sound_blocked'), tone: 'warning' });
            await mark(id, 'sound');
            toast.show({ message: t('merchant.setup.sound_ok'), tone: 'success', icon: 'check' });
          };
          const screen = async () => {
            const s = await requestWakeLock();
            if (s === 'unsupported') toast.show({ message: t('merchant.setup.screen_settings'), tone: 'neutral' });
            await mark(id, 'screen');
          };
          const practiceNow = () => {
            setupSession.practiceFromSetup = true;
            setupSession.landed = true;
            startPractice();
            router.navigate('/');
          };
          const payoutOk = async () => {
            try {
              await seePayout.mutateAsync({ merchantOrgId: id });
            } catch (err) {
              fail(err);
            }
          };
          return (
            <View style={{ gap: theme.space[3] }}>
              <Row testID="setup-check-sound" icon="volume" title={t('merchant.setup.check_sound')} hint={t('merchant.setup.check_sound_hint')} done={view.counter.sound}>
                <Button testID="setup-sound" label={view.counter.sound ? t('merchant.setup.again') : t('merchant.setup.check_sound_cta')} variant={view.counter.sound ? 'ghost' : 'secondary'} size="md" onPress={() => void sound()} />
              </Row>
              <Row testID="setup-check-screen" icon="screen" title={t('merchant.setup.check_screen')} hint={t('merchant.setup.check_screen_hint')} done={view.counter.screen}>
                {view.counter.screen ? null : <Button testID="setup-screen" label={t('merchant.setup.check_screen_cta')} variant="secondary" size="md" onPress={() => void screen()} />}
              </Row>
              <Row testID="setup-check-pickup" icon="map-pin" title={t('merchant.setup.step_pickup')} hint={view.pickup.set ? t('merchant.setup.pickup_hint_done') : t('merchant.setup.pickup_hint')} done={view.pickup.set}>
                <Button testID="setup-pickup" label={view.pickup.set ? t('merchant.setup.see') : t('merchant.setup.pickup_cta')} variant={view.pickup.set ? 'ghost' : 'secondary'} size="md" onPress={() => router.push('/pickup-spot')} />
              </Row>
              <Row testID="setup-check-money" icon="cash" title={t('merchant.setup.step_money')} hint={payout ?? t('merchant.setup.money_hint')} done={view.payout.seen} strong>
                {view.payout.seen ? null : <Button testID="setup-money-ok" label={t('merchant.setup.yes')} size="md" loading={seePayout.isPending} onPress={() => void payoutOk()} />}
              </Row>
              <Row testID="setup-check-printer" icon="printer" title={t('merchant.setup.check_printer')} hint={view.counter.printerLater ? t('merchant.setup.printer_later_done') : t('merchant.setup.printer_hint')} done={null}>
                {view.counter.printerLater ? (
                  <Button label={t('merchant.setup.printer_connect')} variant="ghost" size="md" onPress={() => router.push('/printer')} />
                ) : (
                  <Button testID="setup-printer-later" label={t('merchant.setup.printer_later')} variant="secondary" size="md" onPress={() => void mark(id, 'printer_later')} />
                )}
              </Row>
              <View testID="setup-check-practice" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: view.counter.practice ? theme.colors.successTint : COUNTER.laneNew, borderWidth: 1, borderColor: view.counter.practice ? theme.colors.successTint : COUNTER.saffron }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                  <Mark icon="bell" done={view.counter.practice} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong" style={{ fontSize: 17 }}>
                      {t('merchant.setup.check_practice')}
                    </Text>
                    <Text variant="footnote" color="textMuted">
                      {view.counter.practice ? t('merchant.setup.practice_done') : t('merchant.setup.practice_hint')}
                    </Text>
                  </View>
                </View>
                <Button testID="setup-practice" label={view.counter.practice ? t('merchant.setup.practice_again') : t('merchant.setup.practice_cta')} icon="bell" variant={view.counter.practice ? 'secondary' : 'primary'} size="lg" fullWidth onPress={practiceNow} />
              </View>
              {view.progress.left === 0 ? (
                <Button testID="setup-counter-open" label={t('merchant.setup.raise_cta')} size="lg" fullWidth haptic="medium" onPress={() => router.push('/setup/open')} />
              ) : (
                <Button testID="setup-counter-back" label={t('merchant.setup.back_to_list')} variant="ghost" size="lg" fullWidth onPress={() => router.navigate('/setup')} />
              )}
            </View>
          );
        }}
      </Loadable>
    </Page>
  );
}

/** Done: a green check. Optional (null): a quiet date-brown icon, never red. Open: a saffron ring. */
function Mark({ icon, done }: { icon: MIconName; done: boolean | null }) {
  return (
    <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? COUNTER.ready : COUNTER.sand, borderWidth: done === false ? 2 : 0, borderColor: COUNTER.saffron }}>
      <MIcon name={done ? 'check' : icon} size={22} color={done ? COUNTER.onDate : COUNTER.date} strokeWidth={done ? 2.6 : 2} />
    </View>
  );
}

function Row({ icon, title, hint, done, strong, children, testID }: { icon: MIconName; title: string; hint: string; done: boolean | null; strong?: boolean; children?: ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
      <Mark icon={icon} done={done} />
      <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
        <Text variant="bodyStrong" style={{ fontSize: 16 }}>
          {title}
        </Text>
        <Text variant={strong ? 'body' : 'footnote'} weight={strong ? 600 : undefined} color={strong ? 'text' : 'textMuted'}>
          {hint}
        </Text>
      </View>
      {children}
    </View>
  );
}
