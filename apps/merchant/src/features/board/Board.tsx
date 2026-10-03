import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BoardColumn, BoardOrder } from '@driver/contracts';
import { SegmentedControl, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { usePrefs } from '@/lib/prefs';
import { usePrintOrder } from '@/features/print/runtime';
import { useBalance, useCurrentStore, useStoreStatus, useStoreSwitches } from '@/features/store/queries';
import { StoreHeader } from '@/features/store/StoreHeader';
import { BusySheet, CashSheet, CloseStoreSheet } from '@/features/store/StoreSheets';
import { AcceptSheet } from './AcceptSheet';
import { alarm, useAcknowledged, useSoundReady } from './alarm';
import { InfoStrip, NewOrderBanner } from './Banners';
import { COLUMN_LABEL, COLUMNS, splitColumns, unacknowledged } from './logic';
import { OrderCard } from './OrderCard';
import { OrderDetailSheet } from './OrderDetailSheet';
import { useBoard, useOnline, useOrderActions, useServerNow } from './queries';
import { RejectSheet } from './RejectSheet';

const EMPTY_ICON: Record<BoardColumn, MIconName> = { new: 'bell', preparing: 'flame', ready: 'bag' };

function EmptyColumn({ column }: { column: BoardColumn }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[10], paddingHorizontal: theme.space[4], borderRadius: theme.radius.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.border }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <MIcon name={EMPTY_ICON[column]} size={26} color="textMuted" />
      </View>
      <Text variant="bodyStrong" color="textMuted" align="center">
        {column === 'new' ? t('merchant.board.empty_new_title') : column === 'preparing' ? t('merchant.board.empty_preparing') : t('merchant.board.empty_ready')}
      </Text>
      {column === 'new' ? (
        <Text variant="footnote" color="textMuted" align="center">
          {t('merchant.board.empty_new_body')}
        </Text>
      ) : null}
    </View>
  );
}

function ColumnHeader({ column, count }: { column: BoardColumn; count: number }) {
  const theme = useTheme();
  const t = useT();
  const hot = column === 'new' && count > 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingBottom: theme.space[3] }}>
      <Text variant="title" weight={700}>
        {t(COLUMN_LABEL[column])}
      </Text>
      <View style={{ minWidth: 30, height: 26, paddingHorizontal: 8, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: hot ? theme.colors.accent : theme.colors.surfaceSunken }}>
        <Text variant="label" weight={700} tabular color={hot ? 'onAccent' : 'textMuted'}>
          {String(count)}
        </Text>
      </View>
    </View>
  );
}

/**
 * الطلبات — the orders board (Driver Merchant spec). Tablet: جديد / يتحضّر / جاهز side by side under
 * the store status bar. Phone: one column at a time behind a segmented control with counts.
 */
export function Board() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const prefs = usePrefs();
  const { wide } = useLayout();
  const { store, canSeeMoney } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const board = useBoard(storeId);
  const status = useStoreStatus(storeId);
  const balance = useBalance(storeId, canSeeMoney);
  const online = useOnline();
  const { ready } = useOrderActions();
  const { setOpen } = useStoreSwitches();
  const now = useServerNow(board.offset);
  const clock = useCallback(() => Date.now() + board.offset, [board.offset]);
  const acked = useAcknowledged();
  const soundReady = useSoundReady();
  const print = usePrintOrder(store?.name ?? '');

  const [segment, setSegment] = useState<BoardColumn>('new');
  const [acceptId, setAcceptId] = useState<string | null>(null);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'close' | 'busy' | 'cash' | null>(null);
  const [readyId, setReadyId] = useState<string | null>(null);

  const orders = useMemo(() => board.data?.orders ?? [], [board.data]);
  const cols = useMemo(() => splitColumns(orders), [orders]);
  const byId = (id: string | null) => (id ? (orders.find((o) => o.id === id) ?? null) : null);
  const pending = unacknowledged(orders, acked);

  const onAccept = (o: BoardOrder) => {
    alarm.acknowledge([o.id]);
    setDetailId(null);
    setAcceptPartial(false);
    setAcceptId(o.id);
  };
  const onReject = (o: BoardOrder) => {
    alarm.acknowledge([o.id]);
    setDetailId(null);
    setRejectId(o.id);
  };
  const onReady = async (o: BoardOrder) => {
    setReadyId(o.id);
    try {
      await ready.mutateAsync({ orderId: o.id });
      toast.show({ message: t('merchant.card.mark_ready'), tone: 'success', icon: 'check' });
      setDetailId(null);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    } finally {
      setReadyId(null);
    }
  };
  const toggleOpen = async () => {
    const s = status.data;
    if (!s) return;
    if (s.open) {
      setSheet('close');
      return;
    }
    try {
      await setOpen.mutateAsync({ merchantOrgId: s.merchantOrgId, open: true });
      toast.show({ message: t('merchant.status.opened'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  const card = (o: BoardOrder) => (
    <OrderCard
      key={o.id}
      order={o}
      now={now}
      clock={clock}
      ringing={pending.includes(o.id)}
      onAccept={() => onAccept(o)}
      onReject={() => onReject(o)}
      onReady={() => void onReady(o)}
      onOpen={() => setDetailId(o.id)}
      busyReady={readyId === o.id}
    />
  );

  const loading = !board.data && board.isPending;
  const skeleton = (
    <View style={{ gap: theme.space[3] }}>
      <Skeleton height={220} radius={20} />
      <Skeleton height={160} radius={20} />
    </View>
  );

  const s = status.data;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="board">
      <StoreHeader
        storeName={store?.name ?? ''}
        status={s}
        balance={balance.data}
        canSeeMoney={canSeeMoney}
        now={now}
        wide={wide}
        onToggleOpen={() => void toggleOpen()}
        onBusy={() => setSheet('busy')}
        onCash={() => setSheet('cash')}
      />
      {pending.length > 0 ? <NewOrderBanner count={pending.length} soundBlocked={prefs.soundOn && !soundReady} onSilence={() => alarm.acknowledge(pending)} /> : null}
      {!online ? <InfoStrip tone="neutral" text={t('merchant.board.offline')} testID="offline-strip" /> : null}
      {s?.closed ? (
        <InfoStrip tone="danger" testID="closed-strip" text={t('merchant.board.closed_banner')} action={{ label: t('merchant.board.open_again'), onPress: () => void toggleOpen() }} />
      ) : s?.pause ? (
        <InfoStrip tone="warning" text={t('merchant.board.paused_banner', { reason: s.pause.reason ?? '', time: s.pause.until })} />
      ) : null}
      {board.isError && !board.data ? <InfoStrip tone="danger" text={t('merchant.board.error')} /> : null}

      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: theme.space[4], paddingHorizontal: theme.space[5], paddingTop: theme.space[4] }}>
          {COLUMNS.map((c) => (
            <View
              key={c}
              testID={`column-${c}`}
              style={{
                flex: 1,
                borderRadius: theme.radius['2xl'],
                paddingHorizontal: theme.space[3],
                paddingTop: theme.space[3],
                backgroundColor: c === 'new' && cols.new.length > 0 ? theme.colors.accentTint : theme.colors.surfaceSunken,
              }}
            >
              <View style={{ paddingHorizontal: theme.space[1] }}>
                <ColumnHeader column={c} count={cols[c].length} />
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: theme.space[4], paddingBottom: theme.space[6], paddingHorizontal: 3, paddingTop: 3 }} showsVerticalScrollIndicator={false}>
                {loading ? skeleton : cols[c].length === 0 ? <EmptyColumn column={c} /> : cols[c].map(card)}
              </ScrollView>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3] }}>
            <SegmentedControl
              value={segment}
              onChange={setSegment}
              accessibilityLabel={t('merchant.nav.orders')}
              options={COLUMNS.map((c) => ({ value: c, label: `${t(COLUMN_LABEL[c])} · ${cols[c].length}` }))}
            />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: theme.space[4], padding: theme.space[4], paddingBottom: theme.space[10] }}>
            {loading ? skeleton : cols[segment].length === 0 ? <EmptyColumn column={segment} /> : cols[segment].map(card)}
          </ScrollView>
        </View>
      )}

      <AcceptSheet
        order={byId(acceptId)}
        onClose={() => setAcceptId(null)}
        startPartial={acceptPartial}
        busyOn={s?.busy.on ?? false}
        usualPrepMinutes={s?.defaultPrepMinutes ?? 20}
        clock={clock}
        onAccepted={(o) => {
          if (prefs.autoPrint) void print(o, { auto: true });
        }}
      />
      <RejectSheet
        order={byId(rejectId)}
        onClose={() => setRejectId(null)}
        onAlternative={(action, o) => {
          setRejectId(null);
          if (action === 'partial') {
            setAcceptPartial(true);
            setAcceptId(o.id);
          }
          else setSheet(action === 'busy' ? 'busy' : 'close');
        }}
      />
      <OrderDetailSheet order={byId(detailId)} now={now} onClose={() => setDetailId(null)} onAccept={onAccept} onReject={onReject} onReady={(o) => void onReady(o)} onPrint={(o) => void print(o)} />
      {s ? <CloseStoreSheet status={s} visible={sheet === 'close'} onClose={() => setSheet(null)} /> : null}
      {s ? <BusySheet status={s} visible={sheet === 'busy'} onClose={() => setSheet(null)} now={now} /> : null}
      {storeId ? <CashSheet merchantOrgId={storeId} balance={balance.data} visible={sheet === 'cash'} onClose={() => setSheet(null)} /> : null}
    </SafeAreaView>
  );
}
