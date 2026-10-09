import { Pressable, View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';

/** Keys in phone order (left to right, also in RTL): the bottom row is a gap, 0 and delete — like the amount pad. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;
export type DigitKey = Exclude<(typeof KEYS)[number], ''>;

/**
 * The one keypad for codes and PINs (check-up item 8, Ali 2026-10-09): the same keys as `AmountPad`
 * (64 px, sunken, Western digits in phone order, delete bottom-right pointing left like a keyboard's),
 * so the hand-over code, the ride code and the seat PIN all type the same way as an amount.
 */
export function DigitPad({
  onKey,
  deleteLabel,
  disabled = false,
  keyTestID,
  testID,
}: {
  onKey: (key: DigitKey) => void;
  deleteLabel: string;
  disabled?: boolean;
  keyTestID?: (key: DigitKey) => string;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ direction: 'ltr', flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], width: '100%', maxWidth: 360, alignSelf: 'center' }}>
      {KEYS.map((k, i) =>
        k === '' ? (
          <View key={`gap-${i}`} style={{ flexBasis: '31%', flexGrow: 1, height: 64 }} />
        ) : (
          <Pressable
            key={k}
            testID={keyTestID?.(k)}
            accessibilityRole="button"
            accessibilityLabel={k === 'back' ? deleteLabel : k}
            disabled={disabled}
            onPress={() => {
              theme.haptic('selection');
              onKey(k);
            }}
            style={({ pressed }) => ({
              flexBasis: '31%',
              flexGrow: 1,
              height: 64,
              borderRadius: theme.radius.lg,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? theme.colors.border : theme.colors.surfaceSunken,
              opacity: disabled ? 0.5 : 1,
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
        ),
      )}
    </View>
  );
}
