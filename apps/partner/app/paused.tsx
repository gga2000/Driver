import { View } from 'react-native';
import { Button, Icon, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';

const STEPS = ['partner.paused_step_review', 'partner.paused_step_call', 'partner.paused_step_back'] as const;

/**
 * «حسابك موقّف مؤقتاً»: staff paused him after a safety report (online gate `staff_paused`, lane E).
 * Calm on purpose: a report is not a verdict. It says why in one line, what happens next, and how to
 * reach us. The pause itself is lifted from the Console; the home banner leaves with it.
 */
export default function Paused() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  return (
    <Screen
      testID="paused"
      contentStyle={{ gap: theme.space[6], paddingTop: theme.space[4] }}
      footer={
        <Button
          testID="paused-contact"
          label={t('partner.gate_contact')}
          icon="chat"
          size="lg"
          fullWidth
          // The real support line is a before-launch item (docs/before-launch.md); same stand-in as not-partner.
          onPress={() => toast.show({ message: t('partner.stub_toast'), tone: 'info' })}
        />
      }
    >
      <View style={{ alignItems: 'center', gap: theme.space[4] }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="shield" size={40} color="accentText" strokeWidth={1.8} />
        </View>
        <View style={{ gap: theme.space[2], alignItems: 'center' }}>
          <Text variant="heading" align="center" accessibilityRole="header">
            {t('partner.paused_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 340 }}>
            {t('partner.paused_body')}
          </Text>
        </View>
      </View>
      <View style={{ gap: theme.space[3] }}>
        <Text variant="label" weight={700}>
          {t('partner.paused_next')}
        </Text>
        {STEPS.map((key, i) => (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="label" weight={700} tabular>
                {String(i + 1)}
              </Text>
            </View>
            <Text variant="body" style={{ flex: 1, paddingTop: 2 }}>
              {t(key)}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}
