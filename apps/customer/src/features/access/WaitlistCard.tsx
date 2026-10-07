import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useAccess } from './queries';

/**
 * Customer waves (W5): the one line home shows while the person waits for their area's turn. Taps
 * through to «نبلّغك من يصير دورك». Nothing shows once they're in (or for a guest).
 */
export function WaitlistCard() {
  const theme = useTheme();
  const t = useT();
  const q = useAccess();
  const v = q.data;
  if (!v || v.state === 'open') return null;
  const title =
    v.state === 'needs_place' ? t('waitlist.needs_place_title') : t('waitlist.card_title');
  return (
    <Card
      testID="waitlist-card"
      padding={4}
      tone="tint"
      onPress={() => router.push('/waitlist')}
      accessibilityLabel={title}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Icon name="bell" size={24} color="accentText" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="footnote" color="textMuted">
            {v.state === 'needs_place' ? t('waitlist.card_needs_place') : t('waitlist.card_body')}
          </Text>
        </View>
        <Icon name="chevron-forward" size={18} color="textMuted" />
      </View>
    </Card>
  );
}
