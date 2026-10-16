import { useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { StallOwnerView, StallPriceRow } from '@driver/contracts/shopping';
import { Button, EmptyState, Icon, Skeleton, Text, useTheme } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { absoluteUrl, pickPhotos } from '@/features/menu/photo';
import { usePhotoUpload } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useCounterToast } from '@/lib/toast';
import { isReady, parsePrice, postItems, readyCount, untouchedIds, type RowDraft } from './logic';
import { useMarketActions, useStallPrices } from './queries';

const PHOTO = 58;

/**
 * «أسعار اليوم» (shopping, 2026-10-11): each morning the stall owner photographs his produce and keeps
 * or changes each price. Rows not posted keep yesterday's price for customers. Owner only on the server
 * (staff can't change prices); staff see the list without the post button.
 */
export function PricesScreen() {
  const t = useT();
  const theme = useTheme();
  const { store } = useCurrentStore();
  const stall = useStallPrices(store?.orgId ?? null);
  return (
    <Page title={t('merchant.market.prices.title')} back maxWidth={640} testID="market-prices">
      <Loadable
        query={stall}
        failed={t('merchant.market.prices.load_failed')}
        testID="market-prices-load"
        skeleton={
          <View style={{ gap: theme.space[3] }}>
            <Skeleton height={56} />
            <Skeleton height={320} />
          </View>
        }
      >
        {(view) => <Prices view={view} owner={store?.role === 'owner'} />}
      </Loadable>
    </Page>
  );
}

function Prices({ view, owner }: { view: StallOwnerView; owner: boolean }) {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  const toast = useCounterToast();
  const upload = usePhotoUpload();
  const { post } = useMarketActions();
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const set = (id: string, d: Partial<RowDraft>) => setDrafts((all) => ({ ...all, [id]: { choice: { kind: 'untouched' }, ...all[id], ...d } }));

  if (view.rows.length === 0) return <EmptyState icon="bag" title={t('merchant.market.prices.empty_title')} body={t('merchant.market.prices.empty_body')} />;

  const total = view.rows.length;
  const ready = readyCount(view.rows, drafts);
  const left = untouchedIds(view.rows, drafts);
  const items = postItems(view.rows, drafts);

  const photo = async (row: StallPriceRow) => {
    const picked = await pickPhotos('camera', { square: true });
    if (picked === 'denied') return toast.show({ message: t('merchant.item.photo_denied'), tone: 'warning' });
    const p = picked?.[0];
    if (!p) return;
    set(row.itemId, { photoUri: p.uri });
    setUploading(row.itemId);
    try {
      set(row.itemId, { photoUri: p.uri, photoUploadId: await upload(p) });
    } catch {
      set(row.itemId, { photoUri: undefined, photoUploadId: undefined });
      toast.show({ message: t('merchant.market.prices.photo_failed'), tone: 'danger' });
    } finally {
      setUploading(null);
    }
  };

  const publish = () => {
    if (items.length === 0) return toast.show({ message: t('merchant.market.prices.nothing'), tone: 'warning' });
    post.mutate(
      { merchantOrgId: view.orgId, items },
      {
        onSuccess: () => {
          setDrafts({});
          toast.show({ message: t('merchant.market.prices.published'), tone: 'success' });
        },
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('merchant.market.prices.failed'), locale), tone: 'danger' }),
      },
    );
  };

  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" color="textMuted">
            {view.name}
          </Text>
          <Text variant="body" color="textMuted">
            {view.postedAt ? t('merchant.market.prices.posted_at', { time: view.postedAt }) : t('merchant.market.prices.not_posted')}
          </Text>
        </View>
        <ReadyRing ready={ready} total={total} />
      </View>

      {owner && left.length > 0 ? (
        <Button
          testID="prices-all-same"
          label={t('merchant.market.prices.all_same')}
          icon="refresh"
          variant="secondary"
          onPress={() => setDrafts((all) => Object.fromEntries([...Object.entries(all), ...left.map((id) => [id, { ...all[id], choice: { kind: 'same' } } as RowDraft])]))}
        />
      ) : null}

      <View style={{ backgroundColor: COUNTER.paper, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.space[4] }}>
        {view.rows.map((row, i) => (
          <PriceRow key={row.itemId} row={row} draft={drafts[row.itemId]} first={i === 0} owner={owner} uploading={uploading === row.itemId} onPhoto={() => void photo(row)} onDraft={(d) => set(row.itemId, d)} />
        ))}
      </View>

      <Text variant="footnote" color="textMuted">
        {owner ? t('merchant.market.prices.footnote') : t('merchant.market.prices.owner_only')}
      </Text>

      {owner && (items.length > 0 || ready < total) ? (
        <Button
          testID="prices-publish"
          label={ready === total ? t('merchant.market.prices.publish_all') : t('merchant.market.prices.publish', { n: ready, total })}
          icon="arrow-forward"
          loading={post.isPending}
          disabled={uploading !== null}
          onPress={publish}
        />
      ) : null}
    </View>
  );
}

/** «4 من 6 جاهزة» in a ring that fills green as rows get their price. */
function ReadyRing({ ready, total }: { ready: number; total: number }) {
  const t = useT();
  const size = 84;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View testID="prices-ring" accessibilityRole="progressbar" accessibilityLabel={t('merchant.market.prices.ready_a11y', { n: ready, total })} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={COUNTER.sand} strokeWidth={stroke} fill="none" />
        {ready > 0 ? <Circle cx={size / 2} cy={size / 2} r={r} stroke={COUNTER.ready} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${(c * ready) / total} ${c}`} /> : null}
      </Svg>
      <Text variant="label" weight={700} tabular style={{ lineHeight: 20 }}>
        {t('merchant.market.prices.of', { n: ready, total })}
      </Text>
      <Text variant="caption" color="textMuted" style={{ lineHeight: 16 }}>
        {t('merchant.market.prices.ready')}
      </Text>
    </View>
  );
}

/** What the seller typed, with thousands commas as he types («1,250»). */
function grouped(text: string): string {
  const n = parsePrice(text);
  return n === null ? text.replace(/[^0-9٠-٩۰-۹]/g, '') : amountParam(n);
}

function PriceRow({ row, draft, first, owner, uploading, onPhoto, onDraft }: { row: StallPriceRow; draft: RowDraft | undefined; first: boolean; owner: boolean; uploading: boolean; onPhoto: () => void; onDraft: (d: Partial<RowDraft>) => void }) {
  const t = useT();
  const theme = useTheme();
  const choice = draft?.choice ?? { kind: 'untouched' };
  const photoToday = Boolean(draft?.photoUploadId) || row.photoToday;
  const src = draft?.photoUri ?? (row.photo ? absoluteUrl(row.photo) : null);
  const unit = row.soldBy === 'piece' ? t('merchant.market.prices.per_piece') : t('merchant.market.prices.per_kg');
  const yesterday = row.yesterdayIqd !== null ? t('merchant.market.prices.yesterday', { price: amountParam(row.yesterdayIqd) }) : t('merchant.market.prices.no_yesterday');
  const showSame = choice.kind === 'same' || (choice.kind === 'untouched' && row.postedToday);
  const samePrice = choice.kind === 'same' ? (row.yesterdayIqd ?? row.priceIqd) : row.priceIqd;

  const chip = (label: string, onPress: () => void, solid: boolean, testID: string) => (
    <Button testID={testID} label={label} size="sm" variant={solid ? 'ink' : 'secondary'} disabled={!owner} onPress={onPress} />
  );

  return (
    <View testID={`price-row-${row.itemId}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], paddingVertical: theme.space[3], borderTopWidth: first ? 0 : 1, borderTopColor: theme.colors.border }}>
      <Pressable testID={`price-photo-${row.itemId}`} accessibilityRole="button" accessibilityLabel={t('merchant.market.prices.take_a11y', { name: row.name })} disabled={!owner || uploading} onPress={onPhoto}>
        {photoToday && src ? (
          <View>
            <Image source={{ uri: src }} style={{ width: PHOTO, height: PHOTO, borderRadius: 14 }} contentFit="cover" />
            <View style={{ position: 'absolute', bottom: -4, start: -4, width: 24, height: 24, borderRadius: 12, backgroundColor: COUNTER.ready, borderWidth: 2, borderColor: COUNTER.paper, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={13} color="surface" />
            </View>
          </View>
        ) : (
          <View style={{ width: PHOTO, height: PHOTO, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: COUNTER.dateEdge, alignItems: 'center', justifyContent: 'center', gap: 2, overflow: 'hidden' }}>
            {src ? <Image source={{ uri: src }} style={{ position: 'absolute', width: PHOTO, height: PHOTO, opacity: 0.35 }} contentFit="cover" /> : null}
            {uploading ? <ActivityIndicator color={COUNTER.qty} /> : <MIcon name="camera" size={20} color="text" />}
            <Text variant="caption" weight={700}>
              {t('merchant.market.prices.take')}
            </Text>
          </View>
        )}
      </Pressable>

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={700} numberOfLines={1}>
          {row.name} <Text variant="caption" color="textMuted">{unit}</Text>
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={2}>
          {uploading ? t('merchant.market.prices.uploading') : photoToday ? t('merchant.market.prices.photo_today') : t('merchant.market.prices.photo_old')}
        </Text>
        {choice.kind === 'untouched' && !row.postedToday && owner ? (
          // Undecided: the two answers sit under the name, so a narrow phone keeps the name readable.
          <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: theme.space[2] }}>
            {chip(t('merchant.market.prices.same'), () => onDraft({ choice: { kind: 'same' } }), false, `price-same-${row.itemId}`)}
            {chip(t('merchant.market.prices.new'), () => onDraft({ choice: { kind: 'new', text: '' } }), true, `price-new-${row.itemId}`)}
          </View>
        ) : null}
      </View>

      <View style={{ alignItems: 'flex-end', gap: 4, minWidth: 96 }}>
        {choice.kind === 'new' ? (
          <>
            <TextInput
              testID={`price-input-${row.itemId}`}
              accessibilityLabel={t('merchant.market.prices.price_a11y', { name: row.name })}
              value={grouped(choice.text)}
              onChangeText={(text) => onDraft({ choice: { kind: 'new', text } })}
              keyboardType="number-pad"
              autoFocus
              maxLength={9}
              style={[theme.face('display'), { width: 116, height: 52, borderRadius: 14, borderWidth: 2, borderColor: isReady(row, draft) ? COUNTER.date : theme.colors.danger, textAlign: 'center', fontSize: 22, color: COUNTER.date, backgroundColor: theme.colors.surface }]}
            />
            <Text variant="caption" color="textMuted" tabular>
              {yesterday}
            </Text>
          </>
        ) : showSame ? (
          <Pressable accessibilityRole="button" disabled={!owner} onPress={() => onDraft({ choice: { kind: 'new', text: '' } })} style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text variant="title" weight={700} tabular>
              {amountParam(samePrice)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.successTint }}>
              <Icon name="check" size={13} color="successText" />
              <Text variant="caption" weight={700} color="successText">
                {choice.kind === 'same' ? t('merchant.market.prices.same') : t('merchant.market.prices.posted')}
              </Text>
            </View>
          </Pressable>
        ) : (
          <Text variant="caption" color="textMuted" tabular>
            {yesterday}
          </Text>
        )}
      </View>
    </View>
  );
}
