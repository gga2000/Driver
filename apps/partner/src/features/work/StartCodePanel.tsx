import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { START_CODE_RULES } from '@driver/contracts';
import { Button, Icon, Text, useTheme } from '@driver/ui';
import { DigitPad } from '@/components/DigitPad';
import { useT } from '@/lib/i18n';
import { codeComplete, typeKey } from './start-code';

/**
 * s1 «رمز المشوار» (ride step 3): before «الراكب صعد» on a night ride, the driver asks the rider for
 * the 4 digits in his app and types them on this pad. The server checks them (`start_code_wrong` comes
 * back as `wrong`); five wrong ones alert the ops desk. Big keys: a car at night, one hand.
 */
export function StartCodePanel({ busy, wrongCount, onSubmit, onClose }: { busy: boolean; wrongCount: number; onSubmit: (code: string) => void; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const [code, setCode] = useState('');
  const [seenWrong, setSeenWrong] = useState(wrongCount);
  // A new refusal clears what he typed so he asks again from the start.
  if (wrongCount !== seenWrong) {
    setSeenWrong(wrongCount);
    setCode('');
  }
  // The refusal shows until he types again: a fresh attempt isn't greeted with the old error.
  const wrong = wrongCount > 0 && code.length === 0;
  const press = (key: string) => {
    setCode((c) => typeKey(c, key));
  };
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} testID="start-code-panel" style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title">{t('partner.start_code_title')}</Text>
          <Text variant="label" color="textMuted">
            {t('partner.start_code_hint')}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('action.close')} onPress={onClose} hitSlop={12} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={22} color="textMuted" />
        </Pressable>
      </View>

      {/* The digits read left to right whatever the app's direction, like the rider's screen. */}
      <View style={{ flexDirection: 'row', direction: 'ltr', justifyContent: 'center', gap: theme.space[3] }}>
        {Array.from({ length: START_CODE_RULES.length }, (_, i) => {
          const d = code[i];
          const next = i === code.length;
          return (
            <View
              key={i}
              testID={`start-code-box-${i}`}
              accessible
              accessibilityLabel={t('partner.start_code_digit', { n: i + 1 })}
              style={{
                width: 56,
                height: 64,
                borderRadius: theme.radius.lg,
                borderWidth: next ? 2 : 1.5,
                borderColor: wrong ? theme.colors.danger : next ? theme.colors.text : theme.colors.border,
                backgroundColor: theme.colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text tabular weight={700} style={{ fontSize: 32, lineHeight: 44 }}>
                {d ?? ''}
              </Text>
            </View>
          );
        })}
      </View>

      {wrong ? (
        <View testID="start-code-wrong" accessibilityLiveRegion="assertive" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.dangerTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <Icon name="x" size={18} color="dangerText" />
          <Text variant="label" color="dangerText" style={{ flex: 1 }}>
            {t('partner.start_code_wrong')}
          </Text>
        </View>
      ) : null}

      {/* Check-up item 8: the app's one keypad. */}
      <DigitPad keyTestID={(k) => `start-code-key-${k}`} deleteLabel={t('action.delete')} disabled={busy} onKey={press} />

      <Button testID="start-code-submit" label={t('partner.start_code_cta')} size="lg" fullWidth icon="check" haptic="medium" loading={busy} disabled={!codeComplete(code)} onPress={() => onSubmit(code)} />
    </Animated.View>
  );
}
