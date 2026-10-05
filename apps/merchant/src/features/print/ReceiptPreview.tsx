import { Platform, View } from 'react-native';
import { useSyncExternalStore } from 'react';
import { Button, ModalSheet, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { printInBrowser } from '@/print/printer';
import { previewQueue } from '@/print/preview-queue';
import type { Receipt, ReceiptLine } from '@/print/receipt';
import { color } from '@driver/design-tokens';

const INK = color.neutral[1000];
const PAPER = color.neutral[0];

/** One line of the ticket drawn like thermal print: black on white, bold notes, dashed rules. */
function PaperLine({ line }: { line: ReceiptLine }) {
  const theme = useTheme();
  const ink = { color: INK };
  switch (line.kind) {
    case 'title':
      return (
        <Text weight={700} align="center" style={[ink, { fontSize: 17, lineHeight: 28 }]}>
          {line.text}
        </Text>
      );
    case 'number':
      return (
        <Text weight={700} align="center" tabular style={[ink, { fontSize: 34, lineHeight: 48 }]}>
          {line.text}
        </Text>
      );
    case 'meta':
    case 'footer':
      return (
        <Text variant="caption" align="center" tabular style={ink}>
          {line.text}
        </Text>
      );
    case 'payment':
      return (
        <View style={{ borderWidth: line.cash ? 1.5 : 0, borderColor: INK, borderRadius: 4, paddingVertical: 2, marginTop: theme.space[1] }}>
          <Text variant="label" weight={line.cash ? 700 : 500} align="center" tabular style={ink}>
            {line.text}
          </Text>
        </View>
      );
    case 'person':
      return (
        <View style={{ marginTop: theme.space[2], gap: 2 }}>
          <View style={{ backgroundColor: INK, paddingHorizontal: 6, borderRadius: 2 }}>
            <Text variant="label" weight={700} style={{ color: PAPER }}>
              {line.text}
            </Text>
          </View>
          {line.note ? (
            <Text variant="label" weight={700} style={ink}>
              {line.note}
            </Text>
          ) : null}
        </View>
      );
    case 'item':
      return (
        <View style={{ marginTop: 4, opacity: line.removed ? 0.45 : 1 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Text weight={700} tabular style={[ink, { fontSize: 16, lineHeight: 26, minWidth: 30 }]}>
              {`${line.qty}×`}
            </Text>
            <Text weight={600} style={[ink, { flex: 1, fontSize: 16, lineHeight: 26, textDecorationLine: line.removed ? 'line-through' : 'none' }]}>
              {line.name}
            </Text>
          </View>
          {line.modifiers.length ? (
            <Text variant="footnote" style={[ink, { paddingStart: 38 }]}>
              {line.modifiers.join(' · ')}
            </Text>
          ) : null}
          {line.note ? (
            <Text variant="footnote" weight={700} style={[ink, { paddingStart: 38 }]}>
              {line.note}
            </Text>
          ) : null}
        </View>
      );
    case 'note':
      return (
        <Text variant="label" weight={700} style={ink}>
          {line.text}
        </Text>
      );
    case 'total':
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="label" weight={700} style={ink}>
            {line.label}
          </Text>
          <Text variant="label" weight={700} tabular style={ink}>
            {line.value}
          </Text>
        </View>
      );
    case 'divider':
      return <View style={{ borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: INK, marginVertical: 6 }} />;
  }
}

/** The 80 mm ticket on screen (72 mm printable ≈ 300 px), on a paper strip with a torn edge feel. */
export function ReceiptPaper({ receipt }: { receipt: Receipt }) {
  const theme = useTheme();
  return (
    <View testID="receipt-paper" style={{ alignSelf: 'center', width: 320, backgroundColor: PAPER, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 20, borderRadius: 4, shadowColor: theme.colors.shadow, shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4, borderWidth: 1, borderColor: theme.colors.border }}>
      {receipt.lines.map((l, i) => (
        <PaperLine key={i} line={l} />
      ))}
    </View>
  );
}

/** Mounted once at the root: shows whatever ticket the printer (or "شوف الوصل") put in the preview. */
export function ReceiptPreview() {
  const theme = useTheme();
  const t = useT();
  const current = useSyncExternalStore(previewQueue.subscribe, previewQueue.get, previewQueue.get);
  if (!current) return null;
  return (
    <ModalSheet
      visible
      onClose={() => previewQueue.close()}
      title={t('merchant.receipt.preview_title')}
      subtitle={t('merchant.receipt.paper')}
      testID="receipt-preview"
      footer={
        Platform.OS === 'web' ? (
          <Button testID="receipt-print" label={t('merchant.receipt.print_now')} icon="receipt" size="lg" fullWidth onPress={() => printInBrowser(current)} />
        ) : undefined
      }
    >
      <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.xl, paddingVertical: theme.space[6] }}>
        <ReceiptPaper receipt={current} />
      </View>
    </ModalSheet>
  );
}
