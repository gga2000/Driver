import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { HOURS_PRESETS, hoursPresetsFor, presetDays, type FridayRule, type HoursPreset } from '@driver/contracts';
import { Button, Chip, Skeleton, Text, useTheme } from '@driver/ui';
import { both, Loadable } from '@/components/Loadable';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { shiftLabel, timeLabel } from '@/features/hours/logic';
import { useSaveHours, useStoreHours } from '@/features/hours/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage, useApi } from '@/lib/api';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';
import { doorsOf, fridayPrayer } from './logic';
import { useSetup } from './queries';

const FRIDAY_RULES: readonly FridayRule[] = ['after_prayer', 'same', 'closed'];

/**
 * «إيمته تفتح؟» (h2, h3): a ready schedule in one tap (a café is offered café hours first), Friday after
 * the prayer by default, and what customers see outside the hours: «مسدود · يفتح 11 الصبح». «وقت ثاني»
 * is the full hours screen. Saving here is `merchant.setHours`, the same as the hours screen.
 */
export function HoursSetupScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const api = useApi();
  const qc = useQueryClient();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const setup = useSetup(storeId);
  const hours = useStoreHours(storeId);
  const save = useSaveHours();
  const [preset, setPreset] = useState<HoursPreset | null>(null);
  const [friday, setFriday] = useState<FridayRule>('after_prayer');

  return (
    <Page title={t('merchant.setup.hours_title')} subtitle={t('merchant.setup.hours_sub')} back testID="setup-hours" maxWidth={640}>
      <Loadable query={both(setup, hours)} stale={false} skeleton={<Skeleton height={380} radius={theme.radius.xl} />} failed={t('merchant.setup.load_failed')} testID="setup-hours">
        {([view, h]) => {
          const offered = hoursPresetsFor(doorsOf(view));
          const chosen = preset ?? offered[0]!;
          const prayer = fridayPrayer(h.pauses);
          const shift = HOURS_PRESETS[chosen];
          const onSave = async () => {
            try {
              await save.mutateAsync({ merchantOrgId: view.merchantOrgId, days: presetDays(chosen, friday, prayer), holidays: h.holidays });
              void qc.invalidateQueries(api.merchant.setup.get.pathFilter());
              theme.haptic('success');
              toast.show({ message: t('merchant.hours.saved'), tone: 'success', icon: 'check' });
              if (router.canGoBack()) router.back();
              else router.replace('/setup');
            } catch (err) {
              toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
            }
          };
          return (
            <View style={{ gap: theme.space[4] }}>
              {h.source !== 'none' && preset === null ? (
                <View testID="setup-hours-current" style={{ flexDirection: 'row', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
                  <MIcon name="check" size={18} color="successText" strokeWidth={2.4} />
                  <Text variant="footnote" weight={600} color="successText" style={{ flex: 1 }}>
                    {t('merchant.setup.hours_has')}
                  </Text>
                </View>
              ) : null}
              <View style={{ gap: theme.space[3] }}>
                {offered.map((p) => {
                  const on = chosen === p;
                  return (
                    <Pressable
                      key={p}
                      testID={`setup-preset-${p}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => setPreset(p)}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 72, padding: theme.space[4], borderRadius: theme.radius.xl, borderWidth: on ? 3 : 1, borderColor: on ? COUNTER.saffron : theme.colors.border, backgroundColor: COUNTER.paper, opacity: pressed ? 0.88 : 1 })}
                    >
                      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? COUNTER.ready : 'transparent', borderWidth: on ? 0 : 2, borderColor: theme.colors.borderStrong }}>
                        {on ? <MIcon name="check" size={16} color={COUNTER.onDate} strokeWidth={2.6} /> : null}
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="bodyStrong" style={{ fontSize: 17 }}>
                          {t(`merchant.setup.preset_${p}`)}
                        </Text>
                        <Text variant="footnote" color="textMuted" tabular>
                          {shiftLabel(t, HOURS_PRESETS[p], locale)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                <Pressable testID="setup-preset-other" accessibilityRole="button" onPress={() => router.push('/hours')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56, paddingHorizontal: theme.space[4], borderRadius: theme.radius.xl, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, opacity: pressed ? 0.8 : 1 })}>
                  <MIcon name="sliders" size={20} color="textMuted" />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {t('merchant.setup.preset_other')}
                  </Text>
                  <MIcon name="chevron-forward" size={18} color="textMuted" />
                </Pressable>
              </View>

              <View style={{ gap: theme.space[2] }}>
                <Text variant="title">{t('merchant.setup.friday_title')}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                  {FRIDAY_RULES.map((f) => (
                    <Chip key={f} testID={`setup-friday-${f}`} role="radio" selected={friday === f} label={t(`merchant.setup.friday_${f}`)} onPress={() => setFriday(f)} />
                  ))}
                </View>
                {friday === 'after_prayer' && prayer ? (
                  <Text variant="footnote" color="textMuted">
                    {t('merchant.setup.friday_after', { time: timeLabel(t, prayer.end) })}
                  </Text>
                ) : null}
              </View>

              <View testID="setup-hours-outside" style={{ gap: theme.space[1], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: COUNTER.sand }}>
                <Text variant="caption" weight={600} style={{ color: COUNTER.date }}>
                  {t('merchant.setup.outside_title')}
                </Text>
                <Text variant="bodyStrong" style={{ color: COUNTER.date }}>
                  {t('merchant.setup.outside_line', { time: timeLabel(t, shift.start) })}
                </Text>
              </View>

              <Button testID="setup-hours-save" label={t('merchant.setup.hours_save')} icon="check" size="lg" fullWidth loading={save.isPending} disabled={!h.canEdit} onPress={() => void onSave()} />
            </View>
          );
        }}
      </Loadable>
    </Page>
  );
}
