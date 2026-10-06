import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { ZoneCheckAnswer, ZoneCheckPrompt } from '@driver/contracts';
import { Button, Icon, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';

/**
 * «انت بمنطقة X؟» on the done screen (maps program SP3, drivers confirm zones). The server asks at
 * most once a day, only where his arrival fix was precise; two big answers and a quiet "ما أعرف".
 * The card goes as soon as he taps: sending the answer is the screen's job (`onAnswer`).
 */
export function ZoneCheckCard({ check, onAnswer }: { check: ZoneCheckPrompt; onAnswer: (answer: ZoneCheckAnswer) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  // The server sends the Arabic name with Western digits already («شارع 30»).
  const zone = locale === 'en' ? check.name_en : check.name_ar;
  return (
    <Animated.View
      testID="zone-check"
      entering={theme.reduceMotion ? undefined : FadeIn.delay(600).duration(300)}
      style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Icon name="map-pin" size={20} color="accentText" />
        <View style={{ flex: 1, gap: theme.space[1] }}>
          <Text variant="title" accessibilityRole="header" testID="zone-check-title">
            {t('partner.zone_check_title', { zone })}
          </Text>
          <Text variant="footnote" color="textMuted">
            {t('partner.zone_check_hint')}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <Button testID="zone-check-yes" label={t('partner.zone_check_yes')} variant="secondary" size="lg" style={{ flex: 1 }} onPress={() => onAnswer('yes')} />
        <Button testID="zone-check-no" label={t('partner.zone_check_no')} variant="secondary" size="lg" style={{ flex: 1 }} onPress={() => onAnswer('no')} />
      </View>
      <Button testID="zone-check-unsure" label={t('partner.zone_check_unsure')} variant="ghost" size="sm" onPress={() => onAnswer('unsure')} />
    </Animated.View>
  );
}
