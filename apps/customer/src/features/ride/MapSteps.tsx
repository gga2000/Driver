import { Platform, Pressable, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { RIDE_STEPS } from './map-steps';

const STEP_KEYS = ['ride.step_pickup', 'ride.step_dropoff', 'ride.step_vehicle'] as const;

/**
 * Where he is in the booking (map-led, Ali 2026-10-17): three short bars, the done ones ink, the
 * current one saffron, with its name beside them.
 */
export function StepDots({ step, testID }: { step: 1 | 2 | 3; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const name = t(STEP_KEYS[step - 1] ?? 'ride.step_pickup');
  return (
    <View testID={testID} accessible accessibilityLabel={t('ride.steps_a11y', { n: step, step: name })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {Array.from({ length: RIDE_STEPS }, (_, i) => (
        <View
          key={i}
          style={{ width: 22, height: 6, borderRadius: 3, backgroundColor: i < step - 1 ? theme.colors.text : i === step - 1 ? theme.colors.accent : theme.colors.border }}
        />
      ))}
      <Text variant="caption" weight={600} color="textMuted" style={{ marginStart: 4 }}>
        {name}
      </Text>
    </View>
  );
}

/**
 * The ink tag over the centre pin, «اركب من هنا» / «نزّلني هنا». It sits over the pin's head; the
 * map's pin (`PinPicker`) puts its tip on the screen's centre with the head 52 px above it.
 */
export function PinBubble({ label, hidden }: { label: string; hidden: boolean }) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: '50%', alignItems: 'center', marginTop: -(52 + 36 + 46), opacity: hidden ? 0 : 1 }}>
      <View testID="ride-map-bubble" style={{ paddingHorizontal: theme.space[3], height: 38, borderRadius: 13, justifyContent: 'center', backgroundColor: theme.colors.text, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}>
        <Text variant="label" weight={700} color="surface" numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/**
 * The big search box (Ali: "a beautiful box to type in the place"). On the map it is a button that
 * opens the search; in the search it is the field itself.
 */
export function SearchBox({
  placeholder,
  value,
  onChangeText,
  onPress,
  onClear,
  focused = false,
  inputRef,
  testID,
  style,
}: {
  placeholder: string;
  value?: string;
  onChangeText?: (q: string) => void;
  onPress?: () => void;
  onClear?: () => void;
  focused?: boolean;
  inputRef?: React.Ref<TextInput>;
  testID: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const t = useT();
  const box: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    minHeight: 60,
    paddingStart: theme.space[2],
    paddingEnd: theme.space[3],
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: focused ? theme.colors.accent : theme.colors.border,
    ...(focused ? { shadowColor: theme.colors.accent, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } } : null),
  };
  const lens = (
    <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
      <Icon name="search" size={21} color="accentText" strokeWidth={2.4} />
    </View>
  );
  if (onChangeText) {
    return (
      <View style={[box, style]}>
        {lens}
        <TextInput
          ref={inputRef}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel={placeholder}
          style={[
            {
              flex: 1,
              minWidth: 0,
              height: 56,
              color: theme.colors.text,
              fontSize: 17,
              textAlign: Platform.OS === 'web' && theme.isRTL ? 'right' : 'left',
              writingDirection: theme.direction,
              ...theme.font(600),
            },
            { outlineStyle: 'none' } as object,
          ]}
        />
        {onClear ? (
          <Pressable testID={`${testID}-close`} accessibilityRole="button" accessibilityLabel={t('ride.map_search_close')} onPress={onClear} hitSlop={6} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
            <Icon name="x" size={18} color="text" strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="search" accessibilityLabel={placeholder} onPress={onPress} style={({ pressed }) => [box, pressed ? { backgroundColor: withAlpha(theme.colors.accentTint, 0.5) } : null, style]}>
      {lens}
      <Text variant="body" color="textMuted" numberOfLines={1} style={{ flex: 1, fontSize: 16 }}>
        {placeholder}
      </Text>
    </Pressable>
  );
}

/** A quick place under the search box: «البيت», «كراج البوابة 1», «موقعي هسة». */
export function PlaceChip({ label, icon, onPress, busy = false, testID }: { label: string; icon?: IconName; onPress: () => void; busy?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        maxWidth: 200,
        paddingHorizontal: theme.space[3],
        borderRadius: 22,
        backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surfaceSunken,
        opacity: busy ? 0.6 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={17} color="text" strokeWidth={2.2} /> : null}
      <Text variant="label" weight={600} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
