import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { formatIqd, Icon, Text, TextField, useTheme, useToast, type IconName } from '@driver/ui';
import type { MessageKey } from '@driver/i18n';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { errandDraft, itemReady, stopsOf, useErrandDraft, type ErrandItem } from '@/features/shopping/errand';
import { GreenBar } from '@/features/shopping/GreenBar';
import { useShopping } from '@/features/shopping/palette';
import { ProducePhoto } from '@/features/shopping/ProducePhoto';
import { ShopHeader } from '@/features/shopping/ShopHeader';

/**
 * «دوّرلي» (round 2, Ali 2026-10-11): the list for a shopper, anything from any shop in Aziziyah. Each
 * item shows what, how much, from where and what to do if it isn't there; new ones start by writing,
 * recording or photographing. Under the list: how many shops the shopper will visit, the top amount
 * before he calls, and the fees, priced by the server when the list is sent.
 */
export default function Dawwerli() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const draft = useErrandDraft();
  const items = draft.items;
  const ready = items.length > 0 && items.every(itemReady);
  const stops = stopsOf(items);
  const add = (start?: 'voice' | 'photo') => router.push({ pathname: '/shopping/item', params: start ? { start } : {} });

  return (
    <Screen
      testID="shopping-dawwerli"
      edges={['bottom']}
      footer={
        items.length ? (
          <GreenBar label={t('shopping.dawwerli_send', { n: items.length })} onPress={() => toast.show({ message: t(ready ? 'shopping.checkout_soon' : 'shopping.dawwerli_not_ready') })} />
        ) : undefined
      }
    >
      <ShopHeader title={t('shopping.dawwerli')} />
      <Text variant="body" color="textMuted">
        {t('shopping.dawwerli_intro')}
      </Text>

      {items.length ? (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.space[4] }}>
          {items.map((item, i) => (
            <ItemRow key={item.id} item={item} first={i === 0} />
          ))}
        </View>
      ) : (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4], gap: theme.space[2] }}>
          <Text variant="title" weight={700}>
            {t('shopping.dawwerli_empty')}
          </Text>
          <Text variant="footnote" color="textMuted">
            {t('shopping.dawwerli_examples')}
          </Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <AddButton icon="chat" label={t('shopping.add_write')} onPress={() => add()} />
        <AddButton icon="mic" label={t('shopping.add_voice')} onPress={() => add('voice')} />
        <AddButton icon="camera" label={t('shopping.add_photo')} onPress={() => add('photo')} />
      </View>

      {items.length ? (
        <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.xl, padding: theme.space[4], gap: theme.space[2] }}>
          <Row label={t('shopping.stops')} value={t('shopping.stops_n', { n: stops })} />
          <Row label={t('shopping.items_cost')} value={t('shopping.by_receipt')} />
          <Row label={t('shopping.fees')} value={t('shopping.fees_from', { amount: formatIqd(500) })} />
          <TextField
            label={t('errand.ceiling')}
            hint={t('errand.ceiling_hint')}
            keyboardType="number-pad"
            value={draft.ceilingIqd != null ? String(draft.ceilingIqd) : ''}
            onChangeText={(v) => {
              const n = Number(v.replace(/[^0-9]/g, ''));
              errandDraft.setCeiling(v.trim() && n > 0 ? n : null);
            }}
            placeholder={t('shopping.ceiling_placeholder')}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function AddButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  const shop = useShopping();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: theme.radius.lg,
        borderWidth: 1.5,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Icon name={icon} size={18} color={shop.fill} />
      <Text variant="label" weight={700}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      <Text variant="label" color="textMuted">
        {label}
      </Text>
      <Text variant="label" weight={600}>
        {value}
      </Text>
    </View>
  );
}

function ItemRow({ item, first }: { item: ErrandItem; first: boolean }) {
  const theme = useTheme();
  const shop = useShopping();
  const t = useT();
  const where =
    item.where.kind === 'near' ? t('shopping.where_near') : item.where.kind === 'app' ? item.where.name : item.where.name || t('shopping.where_known');
  const badge = item.where.kind === 'app' ? t('shopping.badge_in_app') : item.where.kind === 'known' && item.where.pin ? t('shopping.badge_pinned') : null;
  const qty = t(`shopping.qty_${item.unit}` as MessageKey, { n: item.qty });
  const title = item.what.trim() || (item.voice ? t('shopping.voice_item') : t('shopping.photo_item'));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}، ${qty}، ${where}، ${t(`shopping.missing_${item.ifMissing}` as MessageKey)}`}
      onPress={() => router.push({ pathname: '/shopping/item', params: { id: item.id } })}
      style={{ flexDirection: 'row', gap: theme.space[3], paddingVertical: theme.space[3], borderTopWidth: first ? 0 : 1, borderTopColor: theme.colors.border }}
    >
      {item.photoUri ? <ProducePhoto uri={item.photoUri} label="" style={{ width: 52, height: 52, borderRadius: theme.radius.md }} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.space[2] }}>
          <Text variant="bodyStrong" weight={700} numberOfLines={2} style={{ flexShrink: 1 }}>
            {title}
          </Text>
          <Text variant="label" weight={700}>
            {qty}
          </Text>
        </View>
        {item.voice ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="mic" size={14} color={theme.colors.textMuted} />
            <Text variant="caption" color="textMuted" tabular>
              {t('shopping.voice_len', { s: Math.max(1, Math.round(item.voice.durationMs / 1000)) })}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Icon name="map-pin" size={14} color={shop.fill} />
          <Text variant="footnote" weight={600} style={{ color: shop.fill }}>
            {where}
          </Text>
          {badge ? (
            <View style={{ paddingHorizontal: theme.space[2], borderRadius: theme.radius.pill, backgroundColor: item.where.kind === 'app' ? shop.tint : theme.colors.surfaceSunken }}>
              <Text variant="caption" weight={700} style={{ color: item.where.kind === 'app' ? shop.onTint : theme.colors.textMuted }}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="caption" color="textMuted">
          {t('shopping.if_missing_line', { what: t(`shopping.missing_${item.ifMissing}` as MessageKey) })}
          {item.maxIqd ? ` · ${t('shopping.max_line', { amount: formatIqd(item.maxIqd) })}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}
