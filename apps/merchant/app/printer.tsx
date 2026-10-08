import { View } from 'react-native';
import { Button, StatusPill, Text, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { printer, printerChipState, usePrinterSnapshot, useReceipt } from '@/features/print/runtime';
import { ReceiptPaper } from '@/features/print/ReceiptPreview';
import { useCurrentStore, useStoreStatus } from '@/features/store/queries';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { previewQueue } from '@/print/preview-queue';
import { sampleOrder } from '@/print/sample';

/**
 * الطابعة — the kitchen printer. On the tablet: Bluetooth pairing (stubbed until the dev-client
 * build) and the connection the board's marker shows. In the browser: the 80 mm preview and the
 * computer's print dialog.
 */
export default function PrinterScreen() {
  const theme = useTheme();
  const t = useT();
  const toast = useCounterToast();
  const { wide } = useLayout();
  const { store } = useCurrentStore();
  const status = useStoreStatus(store?.orgId ?? null);
  const snap = usePrinterSnapshot();
  const chip = printerChipState(snap, status.data?.printer.state);
  const receipt = useReceipt(store?.name ?? '');
  const sample = receipt(sampleOrder({ item1: t('merchant.welcome.art_item1'), item2: t('merchant.welcome.art_item2'), item3: t('merchant.welcome.art_item3'), note: t('merchant.welcome.art_note'), person: t('merchant.welcome.art_person') }));

  const stateText =
    chip === 'connected'
      ? t('merchant.printer.state_connected', { name: status.data?.printer.name ?? snap.name ?? '' })
      : chip === 'disconnected'
        ? t('merchant.printer.state_disconnected')
        : chip === 'preview'
          ? t('merchant.printer.preview_name')
          : t('merchant.printer.state_not_set_up');

  const panel = (
    <View style={{ flex: 1, gap: theme.space[4] }}>
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[5], gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: chip === 'disconnected' ? theme.colors.dangerTint : chip === 'connected' ? theme.colors.successTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <MIcon name="printer" size={32} color={chip === 'disconnected' ? 'dangerText' : chip === 'connected' ? 'successText' : 'textMuted'} />
          </View>
          <View style={{ flex: 1, gap: theme.space[1] }}>
            <StatusPill
              tone={chip === 'connected' ? 'success' : chip === 'disconnected' ? 'danger' : 'neutral'}
              live={chip === 'disconnected'}
              label={chip === 'connected' ? t('merchant.printer.chip_connected') : chip === 'disconnected' ? t('merchant.printer.chip_disconnected') : chip === 'preview' ? t('merchant.printer.chip_preview') : t('merchant.printer.chip_not_set_up')}
            />
            <Text variant="bodyStrong">{stateText}</Text>
          </View>
        </View>
        <Text variant="body" color="textMuted">
          {snap.kind === 'preview' ? t('merchant.printer.body_web') : t('merchant.printer.native_soon')}
        </Text>
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Button testID="printer-test" label={t('merchant.printer.test')} icon="receipt" size="lg" fullWidth onPress={() => previewQueue.show(sample)} />
        {snap.kind === 'bluetooth' ? (
          <Button
            label={t('merchant.printer.connect')}
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => {
              printer.connect().catch(() => toast.show({ message: t('merchant.printer.native_soon'), tone: 'neutral' }));
            }}
          />
        ) : null}
        <Text variant="footnote" color="textMuted" align="center">
          {t('merchant.print_auto')}
        </Text>
      </View>
    </View>
  );

  return (
    <Page title={t('merchant.printer.title')} back testID="printer" maxWidth={960}>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: theme.space[6], alignItems: 'flex-start' }}>
          {panel}
          <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius['2xl'], padding: theme.space[6] }}>
            <ReceiptPaper receipt={sample} />
          </View>
        </View>
      ) : (
        panel
      )}
    </Page>
  );
}
