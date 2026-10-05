import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import type { MessageKey } from '@driver/i18n';
import { Card, Icon, ListRow, Text, useTheme, useToast } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { SUPPORT_WHATSAPP } from '@/lib/env';
import { displayPhone, whatsappUrl } from './whatsapp';

/** Opens the support line on WhatsApp with `text` typed in; says the number when it can't. */
export function useSupportWhatsApp() {
  const t = useT();
  const toast = useToast();
  return async (text: string) => {
    try {
      await Linking.openURL(whatsappUrl(SUPPORT_WHATSAPP, text));
    } catch {
      toast.show({ message: t('help.whatsapp_failed', { phone: displayPhone(SUPPORT_WHATSAPP) }), tone: 'warning', icon: 'phone' });
    }
  };
}

/** "احجي ويانا على واتساب" with the desk's hours. */
export function WhatsAppCard({ message, testID = 'help-whatsapp' }: { message: string; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const open = useSupportWhatsApp();
  return (
    <Card elevation={0} padding={0}>
      <ListRow
        testID={testID}
        leading={
          <View style={{ width: 44, height: 44, borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chat" size={22} color="successText" strokeWidth={2} />
          </View>
        }
        title={t('help.whatsapp_title')}
        subtitle={t('help.whatsapp_sub')}
        onPress={() => void open(message)}
      />
    </Card>
  );
}

const FAQ: ReadonlyArray<{ id: string; q: MessageKey; a: MessageKey }> = [
  { id: 'cash', q: 'help.faq_cash_q', a: 'help.faq_cash_a' },
  { id: 'change', q: 'help.faq_change_q', a: 'help.faq_change_a' },
  { id: 'cancel', q: 'help.faq_cancel_q', a: 'help.faq_cancel_a' },
  { id: 'late', q: 'help.faq_late_q', a: 'help.faq_late_a' },
  { id: 'rajaa', q: 'help.faq_rajaa_q', a: 'help.faq_rajaa_a' },
];

/** Five short answers in Iraqi Arabic; one open at a time. */
export function Faq() {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card elevation={0} padding={0} testID="help-faq">
      {FAQ.map((f, i) => {
        const expanded = open === f.id;
        return (
          <View key={f.id} style={{ borderBottomWidth: i < FAQ.length - 1 ? 1 : 0, borderColor: theme.colors.border }}>
            <Pressable
              testID={`faq-${f.id}`}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen(expanded ? null : f.id)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56, paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent' })}
            >
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {t(f.q)}
              </Text>
              <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
                <Icon name="chevron-down" size={18} color="textMuted" />
              </View>
            </Pressable>
            {expanded ? (
              <Text variant="body" color="textMuted" style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4], lineHeight: 26 }} testID={`faq-${f.id}-answer`}>
                {t(f.a)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}
