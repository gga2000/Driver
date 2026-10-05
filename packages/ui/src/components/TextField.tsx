import { forwardRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { useTheme } from '../theme/ThemeProvider';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: IconName;
  /** Node at the end side inside the field (apply button, mic). */
  trailing?: ReactNode;
  /** Pill-shaped (search) instead of the rounded rectangle. */
  pill?: boolean;
  /** Dim the field when `editable` is false (default). Off for a field that is really a button. */
  dimWhenReadOnly?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, leadingIcon, trailing, pill, dimWhenReadOnly = true, style, onFocus, onBlur, editable = true, ...input },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  // A field you can see at rest (audit S-04: 3.3–3.9:1, not 1.1:1), ink when focused, red on error.
  const borderColor = error ? theme.colors.danger : focused ? theme.colors.focusRing : theme.colors.borderStrong;
  const borderWidth = focused || error ? 2 : 1.5;
  return (
    <View style={[{ gap: theme.space[1] }, style]}>
      {label ? (
        <Text variant="label" color="text">
          {label}
        </Text>
      ) : null}
      <View
        style={{
          minHeight: 52,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          paddingStart: leadingIcon ? theme.space[3] : theme.space[4],
          paddingEnd: trailing ? theme.space[1] : theme.space[4],
          borderRadius: pill ? theme.radius.pill : theme.radius.md,
          backgroundColor: theme.colors.surfaceSunken,
          borderWidth,
          borderColor,
          // Keep the content still when the border thickens on focus.
          margin: borderWidth === 2 ? 0 : 0.5,
          opacity: editable || !dimWhenReadOnly ? 1 : theme.state.disabledOpacity,
        }}
      >
        {leadingIcon ? <Icon name={leadingIcon} size={20} color={focused ? 'text' : 'textMuted'} /> : null}
        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel={label ?? input.placeholder}
          accessibilityHint={error ?? hint}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              // Web inputs carry an intrinsic ~20ch width; let the row shrink them.
              minWidth: 0,
              minHeight: 48,
              color: theme.colors.text,
              fontSize: theme.type.body.size,
              writingDirection: theme.direction,
              // Native RTL swaps left/right (left = start); the web needs the physical side.
              textAlign: Platform.OS === 'web' && theme.isRTL ? 'right' : 'left',
              paddingVertical: 0,
              ...theme.font(400),
            },
            // Web: drop the UA focus outline; the field draws its own ink border on focus.
            { outlineStyle: 'none' } as object,
          ]}
          {...input}
        />
        {trailing ? <View style={{ alignSelf: 'center' }}>{trailing}</View> : null}
      </View>
      {error ? (
        <Text variant="footnote" color="dangerText" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="footnote" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

export interface SearchFieldProps extends Omit<TextFieldProps, 'leadingIcon' | 'pill' | 'trailing' | 'label'> {
  onVoice?: () => void;
  onClear?: () => void;
  /**
   * Entry mode: the bar is a button that opens the full search screen (home, lists) instead of
   * taking input in place. It looks exactly like the field, reads as a button to screen readers, and
   * shows no clear or voice action.
   */
  onPress?: () => void;
}

/** The one search bar over everything (customer spec §1): dishes, restaurants, "تكسي للكوت", people. */
export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField({ onVoice, onClear, onPress, value, ...rest }, ref) {
  const theme = useTheme();
  const hasValue = !!value && value.length > 0;
  if (onPress) {
    return (
      <Pressable
        testID={rest.testID}
        accessibilityRole="button"
        accessibilityLabel={rest.accessibilityLabel ?? rest.placeholder}
        onPress={() => {
          theme.haptic('selection');
          onPress();
        }}
        style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }, rest.style]}
      >
        <View pointerEvents="none">
          <TextField ref={ref} value={value} leadingIcon="search" pill editable={false} dimWhenReadOnly={false} focusable={false} placeholder={rest.placeholder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        </View>
      </Pressable>
    );
  }
  return (
    <TextField
      ref={ref}
      value={value}
      leadingIcon="search"
      pill
      returnKeyType="search"
      accessibilityRole="search"
      trailing={
        hasValue && onClear ? (
          <IconButton icon="x" size={36} variant="plain" accessibilityLabel={t('ui.clear')} onPress={onClear} />
        ) : onVoice ? (
          <IconButton icon="mic" size={44} variant="plain" accessibilityLabel={t('ui.voice_search')} onPress={onVoice} />
        ) : null
      }
      {...rest}
    />
  );
});
