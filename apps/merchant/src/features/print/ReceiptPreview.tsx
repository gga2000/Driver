import { Platform, View } from 'react-native';
import { Fragment, useSyncExternalStore } from 'react';
import { Button, ModalSheet, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { MIcon } from '@/components/MIcon';
import { printInBrowser } from '@/print/printer';
import { previewQueue } from '@/print/preview-queue';
import type { PrintJob } from '@/print/doc';
import { PaperDoc } from './PaperDoc';

/** The papers of one job, top to bottom, with the cut between them (as they come out of the printer). */
export function JobPapers({ job, pxPerMm = 4 }: { job: PrintJob; pxPerMm?: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ alignItems: 'center', gap: theme.space[3] }}>
      {job.docs.map((d, i) => (
        <Fragment key={`${d.kind}-${i}`}>
          {i > 0 ? (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], alignSelf: 'stretch' }}>
              <View style={{ flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong }} />
              <MIcon name="receipt" size={16} color="textMuted" />
              <View style={{ flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong }} />
            </View>
          ) : null}
          <View style={{ shadowColor: theme.colors.shadow, shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3, borderRadius: 2 }}>
            <PaperDoc doc={d} pxPerMm={pxPerMm} testID={`paper-${d.kind}`} />
          </View>
        </Fragment>
      ))}
      <Text variant="footnote" color="textMuted" align="center">
        {t('merchant.printer.preview_hint')}
      </Text>
    </View>
  );
}

/** Mounted once at the root: shows whatever job the printer (or "شوف الوصل") put in the preview. */
export function ReceiptPreview() {
  const theme = useTheme();
  const t = useT();
  const current = useSyncExternalStore(previewQueue.subscribe, previewQueue.get, previewQueue.get);
  if (!current) return null;
  const mm = current.docs[0]?.paper.paperMm ?? 80;
  return (
    <ModalSheet
      visible
      onClose={() => previewQueue.close()}
      title={t('merchant.receipt.preview_title')}
      subtitle={t('merchant.receipt.paper_mm', { mm })}
      testID="receipt-preview"
      footer={
        Platform.OS === 'web' ? (
          <Button testID="receipt-print" label={t('merchant.receipt.print_now')} icon="receipt" size="lg" fullWidth onPress={() => printInBrowser(current)} />
        ) : undefined
      }
    >
      <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.xl, paddingVertical: theme.space[6], paddingHorizontal: theme.space[2] }}>
        <JobPapers job={current} />
      </View>
    </ModalSheet>
  );
}
