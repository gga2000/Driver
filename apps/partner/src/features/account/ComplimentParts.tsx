import { View } from 'react-native';
import type { ComplimentCount, ComplimentKey } from '@driver/contracts';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * The kind words customers picked for him (joy l4), as warm pills: «مؤدب · 12». Most said first (the
 * server's order). Used on the shift summary and on «كلام الزبائن».
 */
export function ComplimentPills({ counts, testID }: { counts: readonly ComplimentCount[]; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
      {counts.map((c) => (
        <View
          key={c.key}
          testID={`compliment-${c.key}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1], minHeight: 36, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.successTint }}
        >
          <Icon name="heart" size={14} color="successText" filled fillColor="successText" />
          <Text variant="label" weight={600} color="successText" tabular>
            {t('partner.compliments_word_count', { word: t(`compliment.${c.key}`), n: c.count })}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** One customer's words on one order, joined: «سريع، مؤدب». */
export function complimentWords(keys: readonly ComplimentKey[], t: ReturnType<typeof useT>): string {
  return keys.map((k) => t(`compliment.${k}`)).join('، ');
}
