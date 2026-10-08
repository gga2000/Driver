import type { ReactNode, Ref } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text, useTheme, type StatusTone } from '@driver/ui';
import { MIcon, type MIconName } from './MIcon';

/**
 * The card every wave-2 dashboard section sits in (money, insights, staff): white on cream, a title
 * row with an optional icon, caption and end node, then the content. `flush` drops the inner padding
 * for edge-to-edge rows.
 */
export function Panel({
  title,
  caption,
  icon,
  aside,
  children,
  flush,
  tone = 'surface',
  style,
  testID,
}: {
  title?: string;
  caption?: string;
  icon?: MIconName;
  aside?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  tone?: 'surface' | 'tint';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  const pad = theme.space[5];
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: tone === 'tint' ? theme.colors.accentTint : theme.colors.surface,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: tone === 'tint' ? theme.colors.accentTint : theme.colors.border,
          shadowColor: theme.colors.shadow,
          shadowOpacity: 0.05,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 3 },
          paddingVertical: pad,
          gap: theme.space[4],
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: pad }}>
          {icon ? (
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
              <MIcon name={icon} size={20} color="accentText" strokeWidth={2} />
            </View>
          ) : null}
          <View style={{ flex: 1, gap: 0 }}>
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
            {caption ? (
              <Text variant="footnote" color="textMuted">
                {caption}
              </Text>
            ) : null}
          </View>
          {aside}
        </View>
      ) : null}
      <View style={{ paddingHorizontal: flush ? 0 : pad, gap: theme.space[3] }}>{children}</View>
    </View>
  );
}

const PILL: Record<StatusTone, { bg: 'surfaceSunken' | 'accentTint' | 'successTint' | 'warningTint' | 'dangerTint' | 'infoTint'; fg: 'text' | 'accentText' | 'successText' | 'warningText' | 'dangerText' | 'infoText' }> = {
  neutral: { bg: 'surfaceSunken', fg: 'text' },
  accent: { bg: 'accentTint', fg: 'accentText' },
  success: { bg: 'successTint', fg: 'successText' },
  warning: { bg: 'warningTint', fg: 'warningText' },
  danger: { bg: 'dangerTint', fg: 'dangerText' },
  info: { bg: 'surfaceSunken', fg: 'text' }, // no blue on the counter
};

/** Small status tag (icon optional) — "بالرمز", "بانتظار ردك", "مالك". */
export function Tag({ label, tone = 'neutral', icon, testID }: { label: string; tone?: StatusTone; icon?: MIconName; testID?: string }) {
  const theme = useTheme();
  const c = PILL[tone];
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', height: 26, paddingHorizontal: theme.space[2] + 2, borderRadius: theme.radius.pill, backgroundColor: theme.colors[c.bg] }}
    >
      {icon ? <MIcon name={icon} size={14} color={c.fg} strokeWidth={2.2} /> : null}
      <Text variant="caption" weight={600} color={c.fg} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A thin horizontal bar (0–1) on a sunken track; RTL grows from the start side. */
export function Meter({ value, color, height = 8, track = 'surfaceSunken' }: { value: number; color: string; height?: number; track?: 'surfaceSunken' | 'border' }) {
  const theme = useTheme();
  const v = Math.min(1, Math.max(0, value));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: theme.colors[track], overflow: 'hidden', flexDirection: 'row' }}>
      <View style={{ width: `${v * 100}%`, minWidth: v > 0 ? height : 0, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

/** Width of the accent bar at the start of a picked row, px. */
const PICKED_BAR_W = 4;

/**
 * A pressable row inside a flush Panel: hairline between rows, 64 px tall. Rows of a list that picks
 * one item (a zone in «منطقة التوصيل» and «منين زبائنك») pass `selected`: every row then keeps a slot
 * at its start for the accent bar the picked row shows (so nothing shifts when the pick moves), and
 * the row's own title goes bold.
 */
export function PanelRow({
  children,
  onPress,
  first,
  selected,
  ref,
  testID,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  first?: boolean;
  selected?: boolean;
  ref?: Ref<View>;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityLabel={accessibilityLabel}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 64,
        paddingHorizontal: theme.space[5],
        paddingVertical: theme.space[3],
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
      })}
    >
      {selected === undefined ? null : (
        <View
          testID={testID && selected ? `${testID}-picked` : undefined}
          style={{ width: PICKED_BAR_W, alignSelf: 'stretch', borderRadius: PICKED_BAR_W / 2, backgroundColor: selected ? theme.colors.accent : 'transparent' }}
        />
      )}
      {children}
    </Pressable>
  );
}
