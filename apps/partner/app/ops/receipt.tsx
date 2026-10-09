import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button, Icon, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { maskedPhone } from '@/features/fleet/logic';
import { baghdadClock, baghdadDate } from '@/features/ops/logic';
import { useMe } from '@/features/work/queries';
import { useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { color } from '@driver/design-tokens';

/**
 * وصل استلام — the cash hand-over receipt, laid out like the WhatsApp receipt the courier gets
 * (money §4: both confirmations, timestamps, reference). Reached only from a recorded receipt.
 */
export default function OpsReceipt() {
  const theme = useTheme();
  const t = useT();
  const me = useMe().data;
  const p = useLocalSearchParams<{ amount: string; ref: string; at: string; owed: string; capLeft: string; name: string; phone: string }>();
  const at = p.at ? new Date(p.at) : new Date();
  const amount = Number(p.amount ?? 0);

  const rows: Array<[string, string]> = [
    [t('partner.ops_rcpt_from'), p.name || maskedPhone(p.phone ?? null)],
    [t('partner.ops_rcpt_ref'), `⁦${p.ref ?? ''}⁩`],
    [t('partner.ops_rcpt_time'), `${baghdadDate(at)} · ${baghdadClock(at)}`],
    [t('partner.ops_rcpt_channel'), `${t('partner.ops_rcpt_channel_ops')}${me?.name ? ` · ${me.name}` : ''}`],
  ];
  const after: Array<[string, string]> = [
    [t('partner.ops_rcpt_owed_after'), iqd(Number(p.owed ?? 0))],
    [t('partner.ops_rcpt_cap_left'), iqd(Number(p.capLeft ?? 0))],
  ];

  return (
    <Screen
      edges={['bottom']}
      testID="ops-receipt"
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button testID="ops-receipt-another" label={t('partner.ops_rcpt_another')} fullWidth size="lg" onPress={() => router.replace('/ops/cash')} />
          <Button label={t('partner.ops_back_home')} variant="ghost" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/ops'))} />
        </View>
      }
    >
      <Stack.Screen options={{ title: t('partner.ops_rcpt_title'), headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />

      <View style={{ alignItems: 'center', gap: theme.space[2], paddingTop: theme.space[2] }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={34} color="successText" strokeWidth={2.6} />
        </View>
        <Text variant="heading" align="center" tabular testID="ops-receipt-done">
          {t('partner.ops_rcpt_done', { amount: amountParam(amount) })}
        </Text>
      </View>

      <View>
        <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, padding: theme.space[5], gap: theme.space[4], shadowColor: color.primary[900], shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="label" weight={700} color="accentText">
              {t('partner.ops_rcpt_brand')}
            </Text>
            <Icon name="receipt" size={20} color="textMuted" />
          </View>
          <View style={{ alignItems: 'center', gap: 0, paddingVertical: theme.space[2] }}>
            <Text variant="display" tabular>
              {amountParam(amount)}
            </Text>
            <Text variant="label" color="textMuted">
              {t('quote.currency')}
            </Text>
          </View>
          <Dashed />
          {rows.map(([k, v]) => (
            <Row key={k} label={k} value={v} />
          ))}
          <Dashed />
          {after.map(([k, v]) => (
            <Row key={k} label={k} value={v} strong />
          ))}
        </View>
        <Zigzag color={theme.colors.surface} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.successTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
        <Icon name="chat" size={20} color="successText" />
        <Text variant="footnote" color="successText" style={{ flex: 1 }}>
          {t('partner.ops_rcpt_whatsapp')}
        </Text>
      </View>
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <Text variant="label" color="textMuted">
        {label}
      </Text>
      <Text variant="label" weight={strong ? 700 : 600} tabular numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}

function Dashed() {
  const theme = useTheme();
  return <View style={{ borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.border }} />;
}

/** The torn-paper bottom edge of the receipt. */
function Zigzag({ color }: { color: string }) {
  const teeth = 22;
  const w = 100 / teeth;
  let d = 'M0 0 ';
  for (let i = 0; i < teeth; i++) d += `L${i * w + w / 2} 6 L${(i + 1) * w} 0 `;
  d += 'Z';
  return (
    <Svg width="100%" height={8} viewBox="0 0 100 6" preserveAspectRatio="none">
      <Path d={d} fill={color} />
    </Svg>
  );
}
