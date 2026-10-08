import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Text, useTheme, withAlpha } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { PickupCode } from './PickupCode';
import { practice, practiceOrder } from './practice';

function Card({ n, title, hint, children, testID }: { n: number; title: string; hint?: string; children: ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: COUNTER.paper, borderWidth: 1, borderColor: theme.colors.border }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: COUNTER.date, alignItems: 'center', justifyContent: 'center' }}>
        <Text weight={700} tabular style={{ color: COUNTER.onDate, fontSize: 18, lineHeight: 26 }}>
          {n}
        </Text>
      </View>
      <View style={{ flex: 1, gap: theme.space[2] }}>
        <Text variant="bodyStrong" style={{ fontSize: 17, lineHeight: 26 }}>
          {title}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[2] }}>{children}</View>
        {hint ? (
          <Text variant="footnote" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A drawn button, not a real one: what the cook will press on the ticket. */
function Pretend({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  const theme = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 34, paddingHorizontal: theme.space[3], borderRadius: theme.radius.md, backgroundColor: bg, justifyContent: 'center' }}>
      <Text weight={700} style={{ color: fg, fontSize: 15, lineHeight: 22 }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * «تعلّم بدقيقة» (counter step 6, s1): three things, the first time a person signs in on this device —
 * read the red first and accept; «صار جاهز» when the food is done; match the courier's code. Then a
 * practice order (s2) or straight to work. Either button also starts the shift: it is the tap the
 * browser needs before the order sound can play.
 */
export function LearnCards({ onPractice, onDone }: { onPractice: () => void; onDone: () => void }) {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  return (
    <View testID="learn-cards" accessibilityViewIsModal style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, zIndex: 21, backgroundColor: withAlpha(theme.colors.text, 0.42), justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? theme.space[6] : 0 }}>
      <Animated.View
        entering={theme.reduceMotion ? undefined : FadeInDown.duration(220)}
        style={{ width: '100%', maxWidth: wide ? 560 : undefined, maxHeight: '100%', backgroundColor: theme.colors.bg, borderRadius: theme.radius['2xl'], borderBottomStartRadius: wide ? theme.radius['2xl'] : 0, borderBottomEndRadius: wide ? theme.radius['2xl'] : 0, shadowColor: theme.colors.shadow, shadowOpacity: 0.2, shadowRadius: 30, shadowOffset: { width: 0, height: 10 }, elevation: 12 }}
      >
        <ScrollView contentContainerStyle={{ padding: theme.space[5], paddingBottom: theme.space[6], gap: theme.space[4] }}>
          <View style={{ gap: theme.space[1] }}>
            <Text variant="heading" accessibilityRole="header">
              {t('merchant.learn.title')}
            </Text>
            <Text variant="body" color="textMuted">
              {t('merchant.learn.body')}
            </Text>
          </View>
          <View style={{ gap: theme.space[2] }}>
            <Card n={1} testID="learn-1" title={t('merchant.learn.one')} hint={t('merchant.learn.one_hint')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.danger }}>
                <MIcon name="alert" size={16} color="onDanger" strokeWidth={2.4} />
                <Text variant="footnote" weight={700} style={{ color: theme.colors.onDanger }}>
                  {t('merchant.learn.one_allergy')}
                </Text>
              </View>
              <MIcon name="arrow-forward" size={18} color="textMuted" />
              <Pretend label={t('merchant.accept')} bg={theme.colors.accent} fg={theme.colors.onAccent} />
            </Card>
            <Card n={2} testID="learn-2" title={t('merchant.learn.two')}>
              <Pretend label={t('merchant.card.mark_ready')} bg={COUNTER.ready} fg={COUNTER.onDate} />
            </Card>
            <Card n={3} testID="learn-3" title={t('merchant.learn.three')} hint={t('merchant.learn.three_hint')}>
              <PickupCode code="6574" />
            </Card>
          </View>
          <View style={{ gap: theme.space[2] }}>
            <Button testID="learn-practice" label={t('merchant.learn.practice')} icon="bell" size="lg" fullWidth haptic="medium" onPress={onPractice} />
            <Text variant="footnote" color="textMuted" style={{ textAlign: 'center' }}>
              {t('merchant.learn.practice_hint')}
            </Text>
            <Button testID="learn-done" label={t('merchant.learn.done')} variant="ghost" size="lg" fullWidth onPress={onDone} />
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/** Starts the practice order with its dishes in the app's language. */
export function useStartPractice(): () => void {
  const t = useT();
  return () =>
    practice.start(
      practiceOrder(Date.now(), {
        tikka: t('merchant.practice.dish_tikka'),
        soup: t('merchant.practice.dish_soup'),
        samoon: t('merchant.practice.mod_samoon'),
        spicy: t('merchant.practice.mod_spicy'),
        note: t('merchant.practice.note'),
      }),
    );
}
