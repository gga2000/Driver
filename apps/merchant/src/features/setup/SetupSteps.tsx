import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { MerchantSetupView, SetupStep } from '@driver/contracts';
import { Text, usePulse, useTheme } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';
import { useT, type TFn, type TKey } from '@/lib/i18n';
import { doorsOf, stepMinutes, voiceOf, type SetupVoice } from './logic';

export const STEP_ICON: Readonly<Record<SetupStep, MIconName>> = { kind: 'store', menu: 'utensils', photos: 'camera', hours: 'clock', money: 'cash', pickup: 'map-pin', counter: 'bell' };

/** A step's name in his shop's words (k2: «صور المشروبات» for a juice shop). */
export function stepTitle(t: TFn, step: SetupStep, voice: SetupVoice): string {
  if (step === 'photos') return t(voice === 'drinks' ? 'merchant.setup.step_photos_drinks' : 'merchant.setup.step_photos');
  return t(`merchant.setup.step_${step}` as TKey);
}

/** What is left in it, from what the server knows (or what is done, once done). */
export function stepHint(t: TFn, view: MerchantSetupView, step: SetupStep, payoutLine: string | null): string {
  const voice = voiceOf(doorsOf(view));
  const dishes = (count: number) => t(voice === 'drinks' ? 'merchant.setup.count_drinks' : 'merchant.setup.count_dishes', { count });
  const done = view.progress.steps.find((s) => s.key === step)?.done ?? false;
  switch (step) {
    case 'kind':
      return doorsOf(view)
        .map((d) => t(`merchant.setup.door_${d}` as TKey))
        .join(' · ');
    case 'menu':
      if (done) return dishes(view.menu.items);
      if (view.menu.pendingCards > 0) return t('merchant.setup.menu_hint_cards', { what: dishes(view.menu.pendingCards) });
      if (view.menu.cards === 'reading') return t('merchant.setup.menu_hint_reading');
      return t('merchant.setup.menu_hint_none');
    case 'photos':
      if (view.menu.items === 0) return t('merchant.setup.photos_hint_after');
      return done ? t('merchant.setup.photos_hint_done') : t('merchant.setup.photos_hint', { what: dishes(view.menu.missingPhotos) });
    case 'hours':
      return done ? t('merchant.setup.hours_hint_done') : t('merchant.setup.hours_hint');
    case 'money':
      return payoutLine ?? t('merchant.setup.money_hint');
    case 'pickup':
      return done ? t('merchant.setup.pickup_hint_done') : t('merchant.setup.pickup_hint');
    case 'counter':
      return t('merchant.setup.counter_hint');
  }
}

/** A saffron dot that breathes: «this is missing, tap it». Still when the phone asks for less motion. */
export function GapDot({ n, size = 26 }: { n?: number; size?: number }) {
  const pulse = usePulse(true);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: COUNTER.saffron }, pulse]} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COUNTER.saffron, borderWidth: 2, borderColor: COUNTER.paper, alignItems: 'center', justifyContent: 'center' }}>
        {n !== undefined ? (
          <Text weight={700} tabular style={{ color: COUNTER.date, fontSize: 13, lineHeight: 18 }}>
            {String(n)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The seven steps as a list (setup home, the board's card): what is done folds into one line, the next
 * one is lit saffron, every open one says its minutes and opens its screen.
 */
export function SetupSteps({ view, payoutLine, onOpen, compact = false }: { view: MerchantSetupView; payoutLine: string | null; onOpen: (step: SetupStep) => void; compact?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const voice = voiceOf(doorsOf(view));
  const done = view.progress.steps.filter((s) => s.done);
  const open = view.progress.steps.filter((s) => !s.done);
  return (
    <View testID="setup-steps">
      {done.length > 0 ? (
        <View testID="setup-steps-done" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 48, paddingHorizontal: theme.space[4], paddingVertical: theme.space[2] }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: COUNTER.ready, alignItems: 'center', justifyContent: 'center' }}>
            <MIcon name="check" size={16} color={COUNTER.onDate} strokeWidth={2.6} />
          </View>
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {done.map((s) => stepTitle(t, s.key, voice)).join(' · ')}
          </Text>
        </View>
      ) : null}
      {open.map((s, i) => {
        const next = s.key === view.progress.next;
        const n = i + 1;
        const minutes = stepMinutes(s.seconds);
        return (
          <Pressable
            key={s.key}
            testID={`setup-step-${s.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${stepTitle(t, s.key, voice)} · ${stepHint(t, view, s.key, payoutLine)} · ${t('merchant.common.minutes', { minutes })}`}
            onPress={() => onOpen(s.key)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              minHeight: compact ? 56 : 68,
              paddingHorizontal: theme.space[4],
              paddingVertical: theme.space[2],
              borderTopWidth: done.length > 0 || i > 0 ? 1 : 0,
              borderTopColor: theme.colors.border,
              backgroundColor: next ? COUNTER.laneNew : pressed ? theme.colors.surfaceSunken : 'transparent',
            })}
          >
            {next ? (
              <GapDot n={n} size={28} />
            ) : (
              <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" weight={700} color="textMuted" tabular>
                  {String(n)}
                </Text>
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" style={{ fontSize: compact ? 15 : 16 }}>
                {stepTitle(t, s.key, voice)}
              </Text>
              {compact && !next ? null : (
                <Text variant="footnote" color="textMuted" numberOfLines={2}>
                  {stepHint(t, view, s.key, payoutLine)}
                </Text>
              )}
            </View>
            <Text variant="caption" weight={600} color="textMuted" tabular>
              {t('merchant.common.minutes', { minutes })}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
