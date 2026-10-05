import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Keys of the pad, phone order (left to right, also in RTL). `000` types three zeros: Iraqi amounts end in them. */
export const AMOUNT_PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'] as const;
export type AmountPadKey = (typeof AMOUNT_PAD_KEYS)[number];

/**
 * The next digits after a key (pure, tested): no leading zeros, at most `maxDigits`, `back` drops one.
 * Values are whole dinars as a digit string ("25000").
 */
export function amountPadNext(value: string, key: AmountPadKey, maxDigits = 7): string {
  if (key === 'back') return value.slice(0, -1);
  const next = (value + key).replace(/^0+/, '');
  return next.length > maxDigits ? value : next;
}

export interface AmountPadProps {
  /** Digits typed so far ("25000"; "" = nothing yet). */
  value: string;
  onChange: (next: string) => void;
  /** Read by screen readers on the delete key ("امسح"). */
  deleteLabel: string;
  maxDigits?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A big-key pad for typing an amount (Partner "غير" at the door, cash desks): 3 × 4 keys of 64 px,
 * Western digits in phone order whatever the layout direction, `000` and delete. It only edits the
 * digits; the caller shows the amount and decides what is valid.
 */
export function AmountPad({ value, onChange, deleteLabel, maxDigits = 7, style, testID }: AmountPadProps) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[{ direction: 'ltr', flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }, style]}>
      {AMOUNT_PAD_KEYS.map((k) => (
        <Pressable
          key={k}
          testID={testID ? `${testID}-${k}` : undefined}
          accessibilityRole="button"
          accessibilityLabel={k === 'back' ? deleteLabel : k}
          onPress={() => {
            theme.haptic('selection');
            onChange(amountPadNext(value, k, maxDigits));
          }}
          style={({ pressed }) => ({
            flexBasis: '31%',
            flexGrow: 1,
            height: 64,
            borderRadius: theme.radius.lg,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? theme.colors.border : theme.colors.surfaceSunken,
          })}
        >
          {k === 'back' ? (
            // Delete points left like a keyboard's, in both directions (the icon set mirrors arrows in RTL).
            <Icon name={theme.isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color="text" strokeWidth={2} />
          ) : (
            <Text variant="heading" tabular>
              {k}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}
