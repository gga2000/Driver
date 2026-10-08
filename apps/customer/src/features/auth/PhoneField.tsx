import { useState } from 'react';
import { Platform, TextInput, View, type TextInputProps } from 'react-native';
import { Text, useTheme } from '@driver/ui';

export interface PhoneFieldProps extends Pick<TextInputProps, 'value' | 'onChangeText' | 'onBlur' | 'onSubmitEditing' | 'placeholder' | 'autoFocus' | 'testID'> {
  label: string;
  error?: string;
}

/**
 * The number, written big (Golden sheet): `0770 123 4567` in large tabular digits, left to right
 * even in RTL as people write it, on the cream sheet. Ink ring on focus, red with the reason under it
 * on an error.
 */
export function PhoneField({ label, error, onBlur, ...input }: PhoneFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? theme.colors.danger : focused ? theme.colors.focusRing : theme.colors.borderStrong;
  const borderWidth = focused || error ? 2 : 1.5;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" color="textMuted">
        {label}
      </Text>
      <View
        style={{
          minHeight: 64,
          justifyContent: 'center',
          paddingHorizontal: theme.space[4],
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surface,
          borderWidth,
          borderColor,
          margin: borderWidth === 2 ? 0 : 0.5,
        }}
      >
        <TextInput
          {...input}
          accessibilityLabel={label}
          accessibilityHint={error}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          inputMode="tel"
          placeholderTextColor={theme.colors.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            {
              minHeight: 60,
              minWidth: 0,
              color: theme.colors.text,
              fontSize: 26,
              letterSpacing: 1,
              writingDirection: 'ltr',
              textAlign: 'center',
              paddingVertical: 0,
              fontVariant: ['tabular-nums'],
              ...theme.font(600),
            },
            Platform.OS === 'web' ? ({ outlineStyle: 'none', direction: 'ltr' } as object) : null,
          ]}
        />
      </View>
      {error ? (
        <Text variant="footnote" color="dangerText" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
