import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, IconButton, Text, useTheme, type IconName } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { PracticeBand } from '@/features/practice/Practice';
import { practiceKindFor, ring, type PracticeKind } from '@/features/practice/scenario';
import { practiceStore, usePracticeState } from '@/features/practice/store';
import { useStatus } from '@/features/work/queries';
import type { MessageKey } from '@driver/i18n';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';

const STEPS: Record<'food' | 'ride', { icon: IconName; key: MessageKey }[]> = {
  food: [
    { icon: 'bell', key: 'partner.practice_intro_ring' },
    { icon: 'bag', key: 'partner.practice_intro_kitchen' },
    { icon: 'cash', key: 'partner.practice_intro_cash' },
    { icon: 'camera', key: 'partner.practice_intro_photo' },
  ],
  ride: [
    { icon: 'bell', key: 'partner.practice_intro_ring_ride' },
    { icon: 'user', key: 'partner.practice_intro_rider' },
    { icon: 'location-arrow', key: 'partner.practice_intro_ride' },
    { icon: 'cash', key: 'partner.practice_intro_fare' },
  ],
};

/**
 * «جرّب طلب تجريبي» (partner redesign l4): what the practice is, then the pretend order rings on the real
 * slip. A missed or declined one comes back here, said kindly, to ring again.
 */
export default function PracticeIntro() {
  const theme = useTheme();
  const t = useT();
  const status = useStatus();
  const s = usePracticeState();
  const qc = useQueryClient();
  const api = useApi();
  const kind: PracticeKind = practiceKindFor(status.data?.vehicleClass) ?? 'food';
  const steps = STEPS[kind === 'food' ? 'food' : 'ride'];
  // A round rang and was missed or declined: «راح الطلب».
  const missed = s?.stage === 'idle' && s.round > 0;

  const start = () => {
    const fresh = missed && s?.kind === kind ? s : practiceStore.start(kind);
    const next = ring(fresh, Date.now());
    practiceStore.set(next);
    // The slip reads this at once (a cached «no offer» from the last round would close it).
    qc.setQueryData(api.partner.currentOffer.queryKey(), next.offer);
    router.push('/practice/offer');
  };

  return (
    <View testID="practice-intro" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <PracticeBand />
      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', padding: theme.space[5], gap: theme.space[5] }}>
          <IconButton
            icon="chevron-back"
            variant="outline"
            accessibilityLabel={t('action.back')}
            onPress={() => {
              practiceStore.clear();
              router.dismissTo('/');
            }}
          />
          <View style={{ gap: theme.space[2] }}>
            <Text variant="heading" weight={700} testID="practice-title">
              {t(kind === 'food' ? 'partner.practice_title_food' : 'partner.practice_title_ride')}
            </Text>
            <Text variant="body" color="textMuted">
              {t('partner.practice_intro_body')}
            </Text>
          </View>

          {missed ? (
            <View testID="practice-missed" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.warningTint }}>
              <Icon name="clock" size={20} color="warningText" strokeWidth={2.2} />
              <Text variant="body" weight={600} color="warningText" style={{ flex: 1 }}>
                {t('partner.practice_missed')}
              </Text>
            </View>
          ) : null}

          <View style={{ gap: theme.space[4] }}>
            {steps.map((step, i) => (
              <View key={step.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <View style={{ width: 44, height: 44, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
                  <Icon name={step.icon} size={22} color="text" strokeWidth={2} />
                </View>
                <Text variant="body" weight={600} tabular style={{ flex: 1 }}>
                  {`${i + 1}. ${t(step.key)}`}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="lock" size={18} color="successText" strokeWidth={2.2} />
            <Text variant="label" weight={600} color="successText" style={{ flex: 1 }}>
              {t('partner.practice_nothing_sent')}
            </Text>
          </View>
        </ScrollView>
        <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: theme.space[4], borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <Button testID="practice-start" label={t(missed ? 'partner.practice_ring_again' : 'partner.practice_start')} size="lg" fullWidth icon="bell" onPress={start} />
        </View>
      </SafeAreaView>
    </View>
  );
}
