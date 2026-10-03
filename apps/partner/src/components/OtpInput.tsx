import { forwardRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Text, useTheme } from '@driver/ui';
import { toWesternDigits } from '@/lib/phone';

export interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  error?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  autoFocus?: boolean;
}

/**
 * Six digit cells over one invisible input (so paste, SMS autofill and backspace behave like a
 * normal field). Digits run left-to-right even in RTL, as the code is written in the SMS.
 */
export const OtpInput = forwardRef<TextInput, OtpInputProps>(function OtpInput(
  { value, onChange, length = 6, error, disabled, accessibilityLabel, autoFocus },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const cells = Array.from({ length }, (_, i) => value[i] ?? '');
  const active = Math.min(value.length, length - 1);
  return (
    <Pressable accessible={false} style={{ position: 'relative' }}>
      <View style={{ flexDirection: 'row', direction: 'ltr', gap: theme.space[2], justifyContent: 'center' }}>
        {cells.map((d, i) => {
          const isActive = focused && i === active && !disabled;
          const borderColor = error ? theme.colors.danger : isActive ? theme.colors.accent : d ? theme.colors.borderStrong : theme.colors.border;
          return (
            <View
              key={i}
              style={{
                flex: 1,
                maxWidth: 52,
                height: 60,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                borderWidth: isActive || error ? 2 : 1.5,
                borderColor,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="heading" tabular color={error ? 'dangerText' : 'text'}>
                {d}
              </Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        testID="otp-input"
        value={value}
        onChangeText={(t) => onChange(toWesternDigits(t).replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={length}
        accessibilityLabel={accessibilityLabel}
        caretHidden
        style={[
          { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, opacity: 0, color: 'transparent', fontSize: 1 },
          { outlineStyle: 'none' } as object,
        ]}
      />
    </Pressable>
  );
});
