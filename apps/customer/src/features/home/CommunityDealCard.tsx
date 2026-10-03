import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Icon, Text, useTheme } from '@driver/ui';
import { FIXTURE_COMMUNITY_DEAL } from '@/fixtures/restaurants';
import { useT } from '@/lib/i18n';

/** Neighbourhood deal (sample until promotions have a customer read). */
export function CommunityDealCard() {
  const theme = useTheme();
  const t = useT();
  const deal = FIXTURE_COMMUNITY_DEAL;
  return (
    <Card
      testID="home-community-deal"
      elevation={0}
      tone="tint"
      padding={4}
      onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: deal.restaurantId } })}
      accessibilityLabel={`${t('home.community_deal')}: ${deal.body}`}
    >
      <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: theme.colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: '-6deg' }],
          }}
        >
          <Icon name="gift" size={24} color="onAccent" strokeWidth={1.9} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{t('home.community_deal')}</Text>
          <Text variant="footnote" color="textMuted">
            {deal.body}
          </Text>
        </View>
      </View>
    </Card>
  );
}
