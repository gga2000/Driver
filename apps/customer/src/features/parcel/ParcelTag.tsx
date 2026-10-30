import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { ParcelSize } from '@driver/contracts';
import { color } from '@driver/design-tokens';
import type { MessageKey } from '@driver/i18n';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { parcelSwatch } from './palette';
import { WaxSeal } from './WaxSeal';

export const SIZE_KEY: Record<ParcelSize, MessageKey> = { small: 'parcel.c_size_small', medium: 'parcel.c_size_medium', large: 'parcel.c_size_large' };

export interface TagFacts {
  from: string;
  to: string;
  what: string;
  size: ParcelSize;
  declaredValueIqd: number;
  coveredIqd: number;
  /** The receipt code (the sender's view only). */
  pin: string | null;
}

/**
 * The parcel's kraft tag (concept B1): from → to, what it is and its size, its value and what we make good,
 * and the receipt code pressed on as a henna wax seal. It drops in once (fade and rise) and stays still.
 */
export function ParcelTag({ facts, testID = 'parcel-tag' }: { facts: TagFacts; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const sw = parcelSwatch(theme);
  return (
    <Animated.View
      testID={testID}
      entering={theme.reduceMotion ? undefined : FadeInDown.duration(260)}
      style={{
        backgroundColor: sw.kraft,
        borderRadius: theme.radius['2xl'],
        borderWidth: 1,
        borderColor: withAlpha(sw.kraftInk, 0.14),
        paddingTop: theme.space[6],
        paddingBottom: theme.space[5],
        paddingHorizontal: theme.space[5],
        gap: theme.space[4],
        shadowColor: color.neutral[1000],
        shadowOpacity: theme.scheme === 'dark' ? 0 : 0.1,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
      }}
    >
      {/* The tag's punched hole, where the twine goes through. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: theme.space[3], alignSelf: 'center', width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: withAlpha(sw.kraftInk, 0.22), backgroundColor: theme.colors.bg }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
        <View style={{ flex: 1, minWidth: 0, gap: theme.space[3] }}>
          <End label={t('ride.from')} value={facts.from} testID={`${testID}-from`} />
          <End label={t('ride.to')} value={facts.to} testID={`${testID}-to`} />
        </View>
        {facts.pin ? <WaxSeal pin={facts.pin} size={104} /> : null}
      </View>

      <View style={{ height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: withAlpha(sw.kraftInk, 0.3) }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3], flexWrap: 'wrap' }}>
        <Text variant="bodyStrong" color={sw.kraftInk} numberOfLines={2} style={{ flexShrink: 1 }} testID={`${testID}-what`}>
          {`${facts.what} · ${t(SIZE_KEY[facts.size])}`}
        </Text>
        {facts.declaredValueIqd > 0 ? (
          <Text variant="bodyStrong" color={sw.kraftInk} tabular testID={`${testID}-value`}>
            {t('parcel.c_tag_value', { amount: amountParam(facts.declaredValueIqd) })}
          </Text>
        ) : null}
      </View>
      {facts.coveredIqd > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="shield" size={16} color={sw.kraftSub} />
          <Text variant="footnote" color={sw.kraftSub} style={{ flex: 1 }} testID={`${testID}-covered`}>
            {t('parcel.c_tag_covered', { amount: amountParam(facts.coveredIqd) })}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

function End({ label, value, testID }: { label: string; value: string; testID: string }) {
  const theme = useTheme();
  const sw = parcelSwatch(theme);
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" color={sw.kraftSub}>
        {label}
      </Text>
      <Text variant="title" color={sw.kraftInk} numberOfLines={2} testID={testID}>
        {value}
      </Text>
    </View>
  );
}
