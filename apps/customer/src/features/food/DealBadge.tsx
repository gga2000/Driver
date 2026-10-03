import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { DealBadge as Deal } from '@driver/contracts';
import { Icon, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';

/**
 * A restaurant's live deal as a ticket-like strip ("خصم 20% على كل المنيو", "توصيل مجاني فوق 15,000
 * دينار"): brand orange tag on the leading edge, the line in ink on the pale accent wash. The label
 * is the server's; the server also decides whether it applies at checkout.
 */
export function DealBadge({ deal, compact, style, testID }: { deal: Deal; compact?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const locale = useLocale();
  const label = locale === 'en' ? deal.label_en : deal.label_ar;
  return (
    <View
      testID={testID ?? `deal-${deal.dealId}`}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'stretch',
          alignSelf: 'flex-start',
          maxWidth: '100%',
          borderRadius: theme.radius.md,
          overflow: 'hidden',
          backgroundColor: theme.colors.accentTint,
          borderWidth: 1,
          borderColor: theme.colors.accent,
        },
        style,
      ]}
    >
      <View style={{ backgroundColor: theme.colors.accent, paddingHorizontal: compact ? 6 : 8, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="gift" size={compact ? 14 : 16} color="onAccent" strokeWidth={2.2} />
      </View>
      <View style={{ paddingHorizontal: compact ? 8 : 10, paddingVertical: compact ? 3 : 6, flexShrink: 1, justifyContent: 'center' }}>
        <Text variant={compact ? 'caption' : 'label'} weight={700} color="accentText" numberOfLines={2} tabular>
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Up to `max` badges, then "+n عروض". */
export function DealBadges({ deals, max = 2, compact, testID }: { deals: readonly Deal[]; max?: number; compact?: boolean; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  if (deals.length === 0) return null;
  const shown = deals.slice(0, max);
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      {shown.map((d) => (
        <DealBadge key={d.dealId} deal={d} compact={compact} />
      ))}
      {deals.length > max ? (
        <Text variant="caption" color="accentText" weight={600}>
          {t('deal.more', { n: deals.length - max })}
        </Text>
      ) : null}
    </View>
  );
}
