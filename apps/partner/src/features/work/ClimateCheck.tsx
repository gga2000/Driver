import { Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { PartnerClimateCheck } from '@driver/contracts';
import { Button, Icon, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useAnswerClimateCheck } from './queries';

/**
 * Ride idea x1, «المكيّفة شغالة اليوم؟»: once a shift, on a hot (cold) day, a car driver whose AC
 * (heating) ops confirmed says whether it works today. Unanswered: the question with إي / لا, right
 * above the switch. «لا»: a quiet line that riders don't see it this shift, with «رجعت تشتغل» to take it
 * back. «إي»: nothing more to show.
 */
export function ClimateCheckCard({ check }: { check: PartnerClimateCheck }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const answer = useAnswerClimateCheck();
  const ac = check.feature === 'ac';
  const send = async (working: boolean) => {
    try {
      await answer.mutateAsync({ working });
      toast.show({ message: t('partner.climate_saved'), tone: 'success', icon: 'check' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  if (check.working === true) return null;
  if (check.working === false) {
    return (
      <View testID="climate-off" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingStart: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
        <Icon name={ac ? 'snow' : 'flame'} size={18} color="textMuted" strokeWidth={2} />
        <Text variant="caption" color="textMuted" style={{ flex: 1, paddingVertical: theme.space[2] }}>
          {t(ac ? 'partner.climate_off_ac' : 'partner.climate_off_heating')}
        </Text>
        <Pressable
          testID="climate-fixed"
          accessibilityRole="button"
          disabled={answer.isPending}
          onPress={() => void send(true)}
          style={{ minHeight: theme.hitTarget, justifyContent: 'center', paddingHorizontal: theme.space[3] }}
        >
          <Text variant="caption" weight={700} color="accentText">
            {t('partner.climate_fixed')}
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Animated.View
      entering={theme.reduceMotion ? undefined : FadeInDown.duration(260)}
      testID="climate-check"
      accessibilityLiveRegion="polite"
      style={{ gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: ac ? theme.colors.infoTint : theme.colors.accentTint }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={ac ? 'snow' : 'flame'} size={22} color={ac ? 'infoText' : 'accentText'} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700} color={ac ? 'infoText' : 'accentText'}>
            {t(ac ? 'partner.climate_q_ac' : 'partner.climate_q_heating')}
          </Text>
          <Text variant="caption" color="textMuted">
            {t(ac ? 'partner.climate_body_ac' : 'partner.climate_body_heating')}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <Button testID="climate-yes" label={t('partner.climate_yes')} icon="check" size="md" onPress={() => void send(true)} disabled={answer.isPending} style={{ flex: 1 }} />
        <Button testID="climate-no" label={t('partner.climate_no')} icon="x" variant="secondary" size="md" onPress={() => void send(false)} disabled={answer.isPending} style={{ flex: 1 }} />
      </View>
    </Animated.View>
  );
}
