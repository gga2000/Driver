import { Fragment } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { ltr } from '../format';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface StatStripItem {
  /** Already formatted ("4.9", "120", "95%"); shown left-to-right isolated so "95%" never reads "%95". */
  value: string;
  /** Under the value ("32 تقييم", "رحلة", "على الوقت"). */
  label: string;
  icon?: IconName;
  /** Fill the icon (a star for a rating). */
  iconFilled?: boolean;
  /** What a screen reader says for the cell; defaults to value then label. */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Two to four facts side by side, each a big tabular value over a small label, with hairlines between
 * them (a driver's rating · trips · on-time share). Cells share the width equally and wrap their label
 * on two lines rather than clipping it.
 */
export function StatStrip({ items, style, testID }: { items: readonly StatStripItem[]; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'stretch',
          paddingVertical: theme.space[3],
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceSunken,
        },
        style,
      ]}
    >
      {items.map((item, i) => (
        <Fragment key={item.testID ?? i}>
          {i > 0 ? <View style={{ width: 1, marginVertical: theme.space[1], backgroundColor: theme.colors.border }} /> : null}
          <View
            testID={item.testID}
            accessible
            accessibilityLabel={item.accessibilityLabel ?? `${item.value} ${item.label}`}
            style={{ flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: theme.space[2] }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {item.icon ? (
                <Icon name={item.icon} size={16} color="accent" {...(item.iconFilled ? { filled: true, fillColor: 'accent' as const } : {})} />
              ) : null}
              <Text variant="title" weight={700} tabular compact>
                {ltr(item.value)}
              </Text>
            </View>
            <Text variant="caption" color="textMuted" align="center" numberOfLines={2}>
              {item.label}
            </Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

export interface MeterBarProps {
  label: string;
  /** 0–1. */
  share: number;
  /** Right of the label ("90%"); formatted by the caller. */
  valueLabel: string;
  icon?: IconName;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * One quality as a labelled bar (a driver's «على الوقت» 90 %): the label and value on one line, a
 * rounded track under them filled in the accent. Read as one item by screen readers.
 */
export function MeterBar({ label, share, valueLabel, icon, testID, style }: MeterBarProps) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <View testID={testID} accessible accessibilityRole="progressbar" accessibilityLabel={`${label}، ${valueLabel}`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} style={[{ gap: 6 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        {icon ? <Icon name={icon} size={16} color="textMuted" /> : null}
        <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
          {label}
        </Text>
        <Text variant="label" weight={700} tabular>
          {ltr(valueLabel)}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 4, backgroundColor: theme.colors.accent }} />
      </View>
    </View>
  );
}
