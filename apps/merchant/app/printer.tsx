import { Fragment, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { Button, ChipGroup, SegmentedControl, StatusPill, Text, useTheme } from '@driver/ui';
import { Switch as Toggle } from '@/components/Switch';
import { useCounterToast } from '@/lib/toast';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { printer, printerChipState, usePrintCtx, usePrinterSnapshot } from '@/features/print/runtime';
import { JobPapers } from '@/features/print/ReceiptPreview';
import { useMenu } from '@/features/menu/queries';
import { useCurrentStore, useStoreStatus } from '@/features/store/queries';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { previewQueue } from '@/print/preview-queue';
import { planOrderJob } from '@/print/plan';
import { PRINTER_DOTS, paperSpec, type PrinterDots } from '@/print/paper';
import { sampleCafeOrder, sampleOrder } from '@/print/sample';
import { cupsOn, ITEMS_PER_BAG_CHOICES, printSettings, usePrintSettings } from '@/print/settings';
import { buildCalibration } from '@/print/slip';

/** One switch row inside a settings card: title, a short hint, the switch at the end. */
function Row({ title, hint, children, testID }: { title: string; hint?: string; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56, paddingVertical: theme.space[3] }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        {hint ? (
          <Text variant="footnote" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A titled group of rows on one card, a hairline between rows. */
function Section({ title, children, testID }: { title: string; children: ReactNode[]; testID?: string }) {
  const theme = useTheme();
  const rows = children.filter(Boolean);
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      <Text variant="label" color="textMuted">
        {title}
      </Text>
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.space[4], paddingVertical: theme.space[1] }}>
        {rows.map((c, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={{ height: 1, backgroundColor: theme.colors.border }} /> : null}
            {c}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/**
 * الطابعة — the kitchen printer and what it prints (print redesign «الريل», Ali 2026-10-08). The paper
 * width from the ruler ticket (i27), the customer slip (k1), the bag stub, copies, beep (i28), cut
 * (i29), stations (i19) and cup labels (i20). Tablet: the settings beside a true-size preview of the
 * test order; phone: «اطبع وصل تجربة» opens it.
 */
export default function PrinterScreen() {
  const theme = useTheme();
  const t = useT();
  const toast = useCounterToast();
  const { wide } = useLayout();
  const { store } = useCurrentStore();
  const status = useStoreStatus(store?.orgId ?? null);
  const snap = usePrinterSnapshot();
  const settings = usePrintSettings();
  const chip = printerChipState(snap, status.data?.printer.state);
  const prepKind = status.data?.prepKind;
  const ctx = usePrintCtx(store?.name ?? '');
  const menu = useMenu(store?.orgId ?? null);
  const sections = useMemo(() => [...new Set((menu.data?.categories ?? []).map((c) => c.nameAr).filter((n): n is string => !!n))], [menu.data]);
  const sectionOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of menu.data?.categories ?? []) for (const i of c.items) if (c.nameAr) map.set(i.nameAr, c.nameAr);
    return (name: string) => map.get(name) ?? null;
  }, [menu.data]);
  const cups = cupsOn(settings, prepKind);
  const sample = useMemo(() => {
    const c = ctx();
    const order = prepKind === 'drinks' ? sampleCafeOrder(c.t, c.now) : sampleOrder(c.t, c.now);
    return planOrderJob({ order, ctx: c, settings, ...(prepKind ? { prepKind } : {}), sectionOf, previous: null });
  }, [ctx, settings, prepKind, sectionOf]);

  const stateText =
    chip === 'connected'
      ? t('merchant.printer.state_connected', { name: status.data?.printer.name ?? snap.name ?? '' })
      : chip === 'disconnected'
        ? t('merchant.printer.state_disconnected')
        : chip === 'preview'
          ? t('merchant.printer.preview_name')
          : t('merchant.printer.state_not_set_up');

  const set = (patch: Parameters<typeof printSettings.set>[0]) => void printSettings.set(patch);
  const calibrate = () => {
    const doc = buildCalibration({ ...ctx(), paper: paperSpec(576) });
    const job = { orderId: 'calibration', number: '', docs: [doc], beep: false, cut: settings.cut };
    if (printer.kind === 'preview') previewQueue.show(job);
    else printer.print(job).catch(() => toast.show({ message: t('merchant.printer.failed'), tone: 'danger' }));
  };
  const widths = PRINTER_DOTS.map((d, i) => ({ value: String(d) as `${PrinterDots}`, label: t(`merchant.printer.width_${d}`), detail: t('merchant.printer.width_n', { n: i + 1 }) }));

  const panel = (
    <View style={{ flex: 1, gap: theme.space[5], minWidth: 0 }}>
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
          {snap.kind === 'preview' ? t('merchant.printer.body_web_sizes') : t('merchant.printer.native_soon')}
        </Text>
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
        </View>
      </View>

      <View testID="printer-width" style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted">
          {t('merchant.printer.section_paper')}
        </Text>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4], gap: theme.space[3] }}>
          <Text variant="bodyStrong">{t('merchant.printer.width')}</Text>
          <SegmentedControl<`${PrinterDots}`> testIDPrefix="printer-width" options={widths} value={String(settings.dots) as `${PrinterDots}`} onChange={(v) => set({ dots: Number(v) as PrinterDots })} accessibilityLabel={t('merchant.printer.width')} />
          <Text variant="footnote" color="textMuted">
            {t('merchant.printer.width_hint')}
          </Text>
          <Button testID="printer-calibrate" label={t('merchant.printer.calibrate')} icon="receipt" variant="secondary" size="md" onPress={calibrate} />
        </View>
      </View>

      <Section title={t('merchant.printer.section_each')} testID="printer-each">
        <Row title={t('merchant.printer.slip')} hint={t('merchant.printer.slip_hint')}>
          <Toggle testID="printer-slip" value={settings.slip} onValueChange={(v) => set({ slip: v })} accessibilityLabel={t('merchant.printer.slip')} />
        </Row>
        <Row title={t('merchant.printer.stub')} hint={t('merchant.printer.stub_hint')}>
          <Toggle testID="printer-stub" value={settings.stub} onValueChange={(v) => set({ stub: v })} accessibilityLabel={t('merchant.printer.stub')} />
        </Row>
        <View style={{ paddingVertical: theme.space[3], gap: theme.space[2] }}>
          <Text variant="bodyStrong">{t('merchant.printer.copies')}</Text>
          <SegmentedControl<'1' | '2'>
            testIDPrefix="printer-copies"
            options={[
              { value: '1', label: t('merchant.printer.copies_1') },
              { value: '2', label: t('merchant.printer.copies_2') },
            ]}
            value={String(settings.copies) as '1' | '2'}
            onChange={(v) => set({ copies: v === '2' ? 2 : 1 })}
            accessibilityLabel={t('merchant.printer.copies')}
          />
        </View>
        <View style={{ paddingVertical: theme.space[3], gap: theme.space[2] }}>
          <Text variant="bodyStrong">{t('merchant.printer.per_bag')}</Text>
          <SegmentedControl<string>
            testIDPrefix="printer-bag"
            options={ITEMS_PER_BAG_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(settings.itemsPerBag)}
            onChange={(v) => set({ itemsPerBag: Number(v) })}
            accessibilityLabel={t('merchant.printer.per_bag')}
          />
          <Text variant="footnote" color="textMuted">
            {t('merchant.printer.per_bag_hint')}
          </Text>
        </View>
        <Row title={t('merchant.printer.beep')} hint={t('merchant.printer.beep_hint')}>
          <Toggle testID="printer-beep" value={settings.beep} onValueChange={(v) => set({ beep: v })} accessibilityLabel={t('merchant.printer.beep')} />
        </Row>
        <Row title={t('merchant.printer.cut')} hint={t('merchant.printer.cut_hint')}>
          <Toggle testID="printer-cut" value={settings.cut} onValueChange={(v) => set({ cut: v })} accessibilityLabel={t('merchant.printer.cut')} />
        </Row>
      </Section>

      <Section title={t('merchant.printer.section_stations')} testID="printer-stations">
        <Row title={t('merchant.printer.stations')} hint={t('merchant.printer.stations_hint')}>
          <Toggle testID="printer-stations-toggle" value={settings.stations} onValueChange={(v) => set({ stations: v })} accessibilityLabel={t('merchant.printer.stations')} />
        </Row>
        <Row title={t('merchant.printer.cups')} hint={t('merchant.printer.cups_hint')}>
          <Toggle testID="printer-cups" value={cups} onValueChange={(v) => set({ cups: v })} accessibilityLabel={t('merchant.printer.cups')} />
        </Row>
        {settings.stations || cups ? (
          <View style={{ paddingVertical: theme.space[3], gap: theme.space[2] }}>
            <Text variant="bodyStrong">{t('merchant.printer.drink_sections')}</Text>
            {sections.length ? (
              <ChipGroup
                mode="multi"
                items={sections.map((s) => ({ id: s, label: s }))}
                value={settings.drinkSections.filter((s) => sections.includes(s))}
                onChange={(next) => set({ drinkSections: next })}
                accessibilityLabel={t('merchant.printer.drink_sections')}
              />
            ) : (
              <Text variant="footnote" color="textMuted">
                {t('merchant.printer.drink_sections_empty')}
              </Text>
            )}
          </View>
        ) : null}
      </Section>

      <Text variant="footnote" color="textMuted" align="center">
        {t('merchant.print_auto')}
      </Text>
    </View>
  );

  return (
    <Page title={t('merchant.printer.title')} back testID="printer" maxWidth={1040}>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: theme.space[6], alignItems: 'flex-start' }}>
          {panel}
          <View testID="printer-preview" style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius['2xl'], paddingVertical: theme.space[6], paddingHorizontal: theme.space[4] }}>
            <JobPapers job={sample} />
          </View>
        </View>
      ) : (
        panel
      )}
    </Page>
  );
}
