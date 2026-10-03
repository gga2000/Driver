import { View } from 'react-native';
import { Button, Icon, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { Wordmark } from '@/components/Wordmark';
import { useMe } from '@/features/work/queries';
import { useT } from '@/lib/i18n';
import { session } from '@/lib/session';

/**
 * Signed in, but the number holds no driving, fleet or ops role ("حسابك مو مفعّل كشريك بعد").
 * Honest about why and what happens next; the only ways out are support or another number.
 */
export default function NotPartner() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const phone = me.data?.phoneMasked ?? null;
  return (
    <Screen
      testID="not-partner"
      contentStyle={{ flexGrow: 1, justifyContent: 'center', gap: theme.space[8] }}
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button
            label={t('partner.gate_contact')}
            icon="chat"
            size="lg"
            fullWidth
            onPress={() => toast.show({ message: t('partner.stub_toast'), tone: 'info' })}
          />
          <Button testID="gate-other-number" label={t('partner.gate_other_number')} variant="ghost" fullWidth onPress={() => void session.signOut()} />
        </View>
      }
    >
      <Wordmark size="md" />
      <View style={{ alignItems: 'center', gap: theme.space[5] }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.warningTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="shield" size={44} color="warningText" strokeWidth={1.8} />
        </View>
        <View style={{ gap: theme.space[2], alignItems: 'center' }}>
          <Text variant="heading" align="center" accessibilityRole="header">
            {t('partner.gate_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 320 }}>
            {t('partner.gate_body')}
          </Text>
          {phone ? (
            <Text variant="label" color="textMuted" tabular style={{ marginTop: theme.space[2] }}>
              {`⁦${phone}⁩`}
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
