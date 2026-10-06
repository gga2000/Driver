import { useMemo, useRef, useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import { Button, ModalSheet, Text, useTheme, useToast } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';
import { shareCard } from './render';
import { cardFileName, cardHint, shareCardModel, type ShareMoment } from './share-card';
import { ShareCardView } from './ShareCardView';
import { CARD } from './layout';

/** The preview's width inside the sheet (fits a 360-wide phone with the sheet's padding). */
const PREVIEW_W = 200;

/**
 * «شارك الفرحة» (joy l5): the card previewed in a sheet, «حط اسمي» (off by default: the first name
 * only), and «شارك» — the phone's share sheet with the picture (WhatsApp status, Instagram story) or,
 * on the web, the browser's share sheet or a download. No price or address is ever on it.
 */
export function ShareCardPanel({ moment, id, visible, onClose }: { moment: ShareMoment; id: string; visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const { name } = useProfile();
  const [withName, setWithName] = useState(false);
  const [busy, setBusy] = useState(false);
  // The model is fixed for the panel's life: the meal word must not flip while it is open.
  const [at] = useState(() => new Date());
  const model = useMemo(() => shareCardModel(moment, { at, name: name ?? null, includeName: withName }), [moment, at, name, withName]);
  const previewRef = useRef<View>(null);
  const fullRef = useRef<View>(null);

  const share = async () => {
    setBusy(true);
    const result = await shareCard({
      text: {
        head: t(model.head.key, model.head.params),
        sub: model.sub ? t(model.sub.key, model.sub.params) : null,
        brand: t(model.brand.key),
        accent: theme.colors.accent,
        art: 'dish' in model.art ? 'dish' : 'scene',
      },
      fileName: cardFileName(moment.kind, id),
      title: t('sharecard.title'),
      view: Platform.OS === 'web' ? previewRef : fullRef,
    });
    setBusy(false);
    if (result === 'saved') toast.show({ message: t('sharecard.saved'), tone: 'success', icon: 'check' });
    else if (result === 'failed') toast.show({ message: t('sharecard.failed'), tone: 'danger' });
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={t('sharecard.title')}
      subtitle={t(cardHint(moment.kind))}
      footer={<Button size="lg" fullWidth icon="share" label={t('sharecard.share')} loading={busy} onPress={() => void share()} testID="sharecard-share" />}
    >
      <View style={{ alignItems: 'center', gap: theme.space[4] }} testID="sharecard-panel">
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
          <ShareCardView model={model} scale={PREVIEW_W / CARD.w} viewRef={previewRef} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44, alignSelf: 'stretch' }}>
          <Text variant="label" weight={600} style={{ flex: 1 }}>
            {t('sharecard.with_name')}
          </Text>
          <Switch
            testID="sharecard-name"
            accessibilityLabel={t('sharecard.with_name')}
            value={withName}
            disabled={!name}
            onValueChange={setWithName}
            trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
            {...(Platform.OS === 'web' ? { activeThumbColor: theme.colors.surface } : {})}
          />
        </View>
      </View>
      {Platform.OS !== 'web' ? (
        // The full-size card the phone captures (off screen): a sharp 1080×1920, not the small preview scaled up.
        <View pointerEvents="none" style={{ position: 'absolute', left: -10_000, top: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ShareCardView model={model} viewRef={fullRef} />
        </View>
      ) : null}
    </ModalSheet>
  );
}
