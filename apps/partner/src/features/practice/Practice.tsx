import { createTRPCClient } from '@trpc/client';
import { router } from 'expo-router';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppRouter } from '@driver/contracts';
import { partnerServices } from '@driver/design-tokens';
import { Button, Icon, Text, useTheme } from '@driver/ui';
import { ApiScope, useApiClient, type ApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { practiceLink, type Forward } from './practice-link';
import { PRACTICE_STEPS, practiceMinutes, practiceStep, practiceTip, type PracticeState } from './scenario';
import { practiceStore, usePracticeState } from './store';

/**
 * «البروفة» on screen (partner redesign l4): the provider that runs the real slip and job screens on the
 * pretend order, the purple band on top of both, the one tip per step, and the done screen.
 */

const PracticeContext = createContext(false);

/** True inside the practice screens: the real screens use it to stay on the practice routes. */
export function useInPractice(): boolean {
  return useContext(PracticeContext);
}

/** Where the slip and the job screen go next: the practice routes inside the practice. */
export function useWorkRoutes() {
  const practice = useInPractice();
  return practice ? ({ job: '/practice/job', home: '/practice' } as const) : ({ job: '/job', home: '/' } as const);
}

function forwardTo(client: ApiClient): Forward {
  return (path, input) => {
    const proc = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], client) as { query(input: unknown): Promise<unknown> };
    return proc.query(input);
  };
}

/** Wraps the practice routes: their API calls are answered on this phone (practice-link.ts). */
export function PracticeProvider({ children }: { children: ReactNode }) {
  const real = useApiClient();
  const [client] = useState(() => createTRPCClient<AppRouter>({ links: [practiceLink(practiceStore, forwardTo(real))] }) as ApiClient);
  return (
    <PracticeContext.Provider value>
      <ApiScope client={client}>{children}</ApiScope>
    </PracticeContext.Provider>
  );
}

/** The practice colour: plum, the same on the band and the tips, on every practice screen. */
function usePracticeColor() {
  const theme = useTheme();
  return partnerServices[theme.scheme === 'dark' ? 'ember' : 'sun'].tuktuk;
}

/** «بروفة · طلب تجريبي، ما يروح لأحد» across the top, with the step: a real order never looks like this. */
export function PracticeBand() {
  const practice = useInPractice();
  const s = usePracticeState();
  const theme = useTheme();
  const t = useT();
  const color = usePracticeColor();
  if (!practice) return null;
  const n = !s ? 1 : s.stage === 'done' ? PRACTICE_STEPS : practiceStep(s);
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: color.fill }} testID="practice-band">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3], paddingHorizontal: theme.space[4], minHeight: 40, paddingVertical: 6 }}>
        <Text variant="label" weight={700} style={{ color: color.on, flexShrink: 1 }} numberOfLines={1}>
          {t('partner.practice_band')}
        </Text>
        <Text variant="label" weight={700} tabular style={{ color: color.on }} testID="practice-step">
          {t('partner.practice_step', { n, total: PRACTICE_STEPS })}
        </Text>
      </View>
    </SafeAreaView>
  );
}

/** The one purple tip for the step he is on, at the top of the sheet. */
export function PracticeTip() {
  const practice = useInPractice();
  const s = usePracticeState();
  const theme = useTheme();
  const t = useT();
  const color = usePracticeColor();
  const key = s ? practiceTip(s) : null;
  if (!practice || !s || !key) return null;
  const params = { amount: amountParam(s.job?.stops[1]?.collectIqd ?? s.offer?.collectIqd ?? 0), paid: amountParam(s.job?.stops[1]?.tenderIqd ?? 0) };
  return (
    <Animated.View
      key={key}
      entering={theme.reduceMotion ? undefined : FadeIn.duration(220)}
      testID="practice-tip"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: color.tint, borderStartWidth: 4, borderStartColor: color.fill }}
    >
      <Icon name="bulb" size={20} color={color.ink} strokeWidth={2.2} />
      <Text variant="body" weight={600} style={{ color: color.ink, flex: 1 }}>
        {t(key, params)}
      </Text>
    </Animated.View>
  );
}

/** The done screen: what he did in four lines, «جاهز لأول طلب حقيقي», home or once more. */
export function PracticeDone() {
  const s = usePracticeState();
  const theme = useTheme();
  const t = useT();
  if (!s) return null;
  const lines = doneLines(s, t);
  return (
    <View testID="practice-done" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <PracticeBand />
      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', padding: theme.space[5], gap: theme.space[5] }}>
          <View style={{ gap: theme.space[2], paddingTop: theme.space[4] }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.successTint }}>
              <Icon name="check" size={30} color="successText" strokeWidth={2.6} />
            </View>
            <Text variant="heading" weight={700}>
              {t('partner.practice_done_title')}
            </Text>
            <Text variant="body" color="textMuted" tabular>
              {t('partner.practice_done_minutes', { n: practiceMinutes(s) })}
            </Text>
          </View>
          <View style={{ gap: theme.space[3] }}>
            {lines.map((line) => (
              <View key={line} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <Icon name="check" size={20} color="successText" strokeWidth={2.4} />
                <Text variant="body" weight={600} tabular style={{ flex: 1 }}>
                  {line}
                </Text>
              </View>
            ))}
          </View>
          <View testID="practice-saved" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
            <Icon name="award" size={20} color="successText" strokeWidth={2.2} />
            <Text variant="label" weight={700} color="successText" style={{ flex: 1 }}>
              {t('partner.practice_saved')}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <View style={{ gap: theme.space[3] }}>
            <Button
              testID="practice-home"
              label={t('partner.practice_home')}
              size="lg"
              fullWidth
              onPress={() => {
                practiceStore.clear();
                router.dismissTo('/');
              }}
            />
            <Button testID="practice-again" label={t('partner.practice_again')} size="lg" variant="secondary" fullWidth icon="refresh" onPress={() => router.replace('/practice')} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function doneLines(s: PracticeState, t: ReturnType<typeof useT>): string[] {
  const accepted = t('partner.practice_learned_accept');
  if (s.kind !== 'food') return [accepted, t('partner.practice_learned_rider'), t('partner.practice_learned_rider_in'), t('partner.practice_learned_fare')];
  const cash = s.learned.cashIqd ?? 0;
  const paid = s.learned.paidWithIqd ?? cash;
  return [
    accepted,
    t('partner.practice_learned_picked_up'),
    paid > cash ? t('partner.practice_learned_change', { change: amountParam(paid - cash), paid: amountParam(paid) }) : t('partner.practice_learned_cash', { amount: amountParam(cash) }),
    s.learned.photo ? t('partner.practice_learned_photo') : t('partner.practice_learned_door'),
  ];
}
