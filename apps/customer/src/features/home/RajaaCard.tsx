import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useRajaaSummary } from './queries';

/** الرجعة card, second on home: the next cars back from Baghdad (sample data until the intercity API). */
export function RajaaCard() {
  const theme = useTheme();
  const t = useT();
  const r = useRajaaSummary();
  return (
    <Card testID="home-rajaa" padding={4} onPress={() => router.push('/rajaa')} accessibilityLabel={`${t('home.rajaa_title')}: ${r.from} ← ${r.to}`}>
      <View style={{ flexDirection: 'row', gap: theme.space[4], alignItems: 'center' }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="garage" size={26} color="accentText" strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" weight={600} color="accentText">
            {t('home.rajaa_title')} · {r.garage}
          </Text>
          <Text variant="title">
            {r.from} ← {r.to}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {r.summary}
          </Text>
        </View>
        <Icon name="chevron-forward" size={20} color="textMuted" />
      </View>
    </Card>
  );
}
