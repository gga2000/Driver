import { StyleSheet, Text, View } from 'react-native';
import type { Quote } from '@driver/contracts';
import { color, radius, space, type } from '@driver/design-tokens';
import { t } from '@driver/i18n';

const iqd = (n: number) => n.toLocaleString('en-US');

export function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <View style={styles.card}>
      {quote.components.map((c, i) => (
        <View key={`${c.key}-${i}`} style={styles.row}>
          <Text style={styles.label}>{c.label_ar}</Text>
          <Text style={styles.amount}>{iqd(c.amount)}</Text>
        </View>
      ))}
      <View style={[styles.row, styles.total]}>
        <Text style={styles.totalLabel}>{t('quote.total')}</Text>
        <Text style={styles.totalAmount}>
          {iqd(quote.total)} <Text style={styles.currency}>{t('quote.currency')}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.neutral[0],
    borderRadius: radius.xl,
    padding: space[4],
    gap: space[2],
    borderWidth: 1,
    borderColor: color.neutral[200],
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontSize: type.body.size, color: color.neutral[700], textAlign: 'left' },
  amount: { fontSize: type.body.size, color: color.neutral[900], fontVariant: ['tabular-nums'] },
  total: { borderTopWidth: 1, borderTopColor: color.neutral[200], paddingTop: space[3], marginTop: space[1] },
  totalLabel: { fontSize: type.title.size, fontWeight: '600', color: color.neutral[900] },
  totalAmount: { fontSize: type.amount.size, fontWeight: '700', color: color.primary[700] },
  currency: { fontSize: type.body.size, fontWeight: '400', color: color.neutral[500] },
});
