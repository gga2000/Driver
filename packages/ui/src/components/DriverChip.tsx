import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { color as palette } from '@driver/design-tokens';
import { ltr } from '../format';
import { Icon } from '../icons/Icon';
import { splitPlate } from '../logic/plate';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Text } from './Text';

export interface PlateChipProps {
  plate: string;
  /** "رقم السيارة" — read before the plate by screen readers. */
  accessibilityLabel: string;
  /** `sm`: a list row where the plate is a detail, not the thing to find. `xl`: the driver-here card, where the plate is the thing to find at the kerb (L-02). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const PLATE_SIZE = {
  sm: { height: 24, pad: 6, regionPad: 4, number: 13, numberLine: 18, region: 10, regionLine: 13 },
  md: { height: 32, pad: 9, regionPad: 6, number: 16, numberLine: 22, region: 12, regionLine: 16 },
  lg: { height: 40, pad: 12, regionPad: 8, number: 20, numberLine: 26, region: 13, regionLine: 18 },
  xl: { height: 52, pad: 14, regionPad: 10, number: 28, numberLine: 34, region: 15, regionLine: 20 },
} as const;

/**
 * A number plate as it looks on the car (audit C-20): white plate, black border, the number big
 * and tabular, the governorate small beside it. Same white-and-black in dark mode, because that is
 * what the car carries. Never truncated: it sizes to its content and never shrinks.
 */
export function PlateChip({ plate, accessibilityLabel, size = 'md', style, testID }: PlateChipProps) {
  const theme = useTheme();
  const { number, region } = splitPlate(plate);
  const m = PLATE_SIZE[size];
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${accessibilityLabel} ${plate}`}
      style={[
        {
          flexShrink: 0,
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'stretch',
          height: m.height,
          borderRadius: theme.radius.sm,
          borderWidth: 1.5,
          borderColor: palette.neutral[900],
          backgroundColor: palette.neutral[0],
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {region ? (
        <View style={{ justifyContent: 'center', paddingHorizontal: m.regionPad, backgroundColor: palette.neutral[100], borderEndWidth: 1, borderColor: palette.neutral[900] }}>
          <Text variant="caption" weight={700} style={{ color: palette.neutral[900], fontSize: m.region, lineHeight: m.regionLine }}>
            {region}
          </Text>
        </View>
      ) : null}
      <View style={{ justifyContent: 'center', paddingHorizontal: m.pad }}>
        <Text weight={700} tabular style={{ color: palette.neutral[900], fontSize: m.number, lineHeight: m.numberLine, letterSpacing: 1 }}>
          {ltr(number)}
        </Text>
      </View>
    </View>
  );
}

export interface DriverChipProps {
  /** First name; the fallback ("السايق", "الدليفري") when the API has none. */
  name: string;
  /** The name is the fallback, not his: the photo slot shows a person glyph, not the fallback's initial. */
  unnamed?: boolean;
  photoUrl?: string | null;
  /** "تويوتا كورولا · أبيض" or "صالون · سوناتا بيضاء"; omitted when unknown. */
  vehicle?: string | null;
  plate?: string | null;
  plateLabel: string;
  /** Shown as a green "متحقق اليوم" badge and an accent ring on the photo. */
  verifiedLabel?: string | null;
  /** A caption above the name ("سايقك"). */
  eyebrow?: string;
  size?: 'md' | 'lg';
  /** Buttons at the end (chat, call, share). */
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Who is coming (audit C-19 / C-20): photo (or his initial), first name, "متحقق اليوم", the car's
 * model and colour, and the plate in its own chip on its own line, so a long model never pushes the
 * plate out of view. Used on the ride sheet, الرجعة board, seat sheet and boarding pass.
 */
export function DriverChip({ name, unnamed, photoUrl, vehicle, plate, plateLabel, verifiedLabel, eyebrow, size = 'md', trailing, style, testID }: DriverChipProps) {
  const theme = useTheme();
  const big = size === 'lg';
  return (
    <View testID={testID} style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }, style]}>
      <Avatar name={name} uri={photoUrl ?? undefined} {...(unnamed && !photoUrl ? { icon: 'user' as const, tone: 'accent' as const } : {})} size={big ? 56 : 48} ring={Boolean(verifiedLabel)} />
      <View style={{ flex: 1, gap: theme.space[1], minWidth: 0 }}>
        {eyebrow ? (
          <Text variant="caption" weight={600} color="textMuted">
            {eyebrow}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Text variant={big ? 'title' : 'bodyStrong'} numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          {verifiedLabel ? (
            <View
              testID={testID ? `${testID}-verified` : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: theme.space[2], height: 22, borderRadius: 11, backgroundColor: theme.colors.successTint }}
            >
              <Icon name="shield" size={13} color="successText" strokeWidth={2.2} />
              <Text variant="caption" weight={600} color="successText">
                {verifiedLabel}
              </Text>
            </View>
          ) : null}
        </View>
        {vehicle ? (
          <Text variant="footnote" color="textMuted" numberOfLines={2}>
            {vehicle}
          </Text>
        ) : null}
        {plate ? <PlateChip plate={plate} accessibilityLabel={plateLabel} size={big ? 'lg' : 'md'} testID={testID ? `${testID}-plate` : undefined} style={{ marginTop: 2 }} /> : null}
      </View>
      {trailing ? <View style={{ flexDirection: 'row', gap: theme.space[2], alignSelf: 'center' }}>{trailing}</View> : null}
    </View>
  );
}
