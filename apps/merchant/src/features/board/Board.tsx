import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BoardColumn, BoardOrder } from '@driver/contracts';
import { agoText, SegmentedControl, Skeleton, Text, useConnectionBanner, useTheme, useToast } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { ModalSheet } from '@/components/ModalSheet';
import { testChime } from '@/lib/alert-sound';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { localDayKey } from '@/lib/calendar';
import { useDates } from '@/lib/dates';
import { requestWakeLock, useWakeState } from '@/lib/keep-awake';
import { useLayout } from '@/lib/layout';
import { LIVE_MERCHANT_KEY, useLiveMode } from '@/lib/live';
import { iqd } from '@/lib/money';
import { prefs as prefsStore, usePrefs } from '@/lib/prefs';
import { clock12 } from '@/lib/time';
import { scheduleBanner } from '@/features/hours/logic';
import { usePushPrompt } from '@/features/notify/Push';
import { boardCalmForPrompt } from '@/features/notify/prompt';
import { printerChipState, usePrinterSnapshot, usePrintOrder } from '@/features/print/runtime';
import { useBalance, useCurrentStore, useStoreStatus, useStoreSwitches } from '@/features/store/queries';
import { HeaderChip, StoreHeader } from '@/features/store/StoreHeader';
import { BusySheet, CashSheet, CloseStoreSheet } from '@/features/store/StoreSheets';
import { AcceptSheet } from './AcceptSheet';
import { alarm, useAlarmPlan, useSoundReady } from './alarm';
import { InfoStrip, MissedStrip, NewOrderBanner } from './Banners';
import { stageFor } from './ladder';
import { byTimeLeft, COLUMN_LABEL, COLUMNS, isRush, newOrderSummary, oneTapPrep, splitColumns, stickyAcceptTarget, suggestBusy } from './logic';
import { missNudge, unseenMissed } from './missed';
import { OrderCard } from './OrderCard';
import { OrderDetailSheet } from './OrderDetailSheet';
import { useBoard, useOnline, useOrderActions, useServerNow } from './queries';
import { RejectSheet } from './RejectSheet';
import { RushQueue, StickyAcceptBar } from './Rush';
import { ShiftGate } from './ShiftGate';
import { shiftGateNeeded, startShift, useShift } from './shift';
import { useMissedSeen } from './useMissed';

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
 *
 * UI/UX audit Phase 1: "ابدأ الشغل" gate (sound, screen on, printer) at the start of the day; the alarm
 * ladder's banner (snooze, never silence); "الصوت طافي" whenever sound can't play; missed orders kept
 * in a strip and a "فاتك اليوم" counter; one-tap "اقبل · 15 د" and a one-off "+5 د"; the notification
 * ask only as a strip on a calm board.
 *
 * Phase 2 (kitchen rush, M-05/M-06/M-10): جديد is in answer order (least time left first). On a tablet
 * with three or more waiting, a queue strip shows every one of them and the tickets go compact except
 * the one being read; from four waiting, busy mode is suggested. On a phone the header is one row and
 * a sticky accept bar keeps the next order's Accept within reach. One "new" count everywhere.
 */
export function Board() {
  const theme = useTheme();
  const t = useT();
  const dates = useDates();
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
  const conn = useConnectionBanner({ live: useLiveMode(LIVE_MERCHANT_KEY), updatedAt: board.dataUpdatedAt || null });
  /** Offline: accept / reject / ready can't reach the server; say why instead of failing. */
  const offlineGuard = () => {
    if (online) return false;
    toast.show({ message: t('merchant.board.offline_toast'), tone: 'warning' });
    return true;
  };
  const { accept, ready, extend } = useOrderActions();
  const { setOpen } = useStoreSwitches();
  const now = useServerNow(board.offset);
  const clock = useCallback(() => Date.now() + board.offset, [board.offset]);
  const plan = useAlarmPlan();
  const soundReady = useSoundReady();
  const wake = useWakeState();
  const shift = useShift();
  const printerSnap = usePrinterSnapshot();
  const print = usePrintOrder(store?.name ?? '');
  const { seen, markSeen } = useMissedSeen();

  const [segment, setSegment] = useState<BoardColumn>('new');
  const [acceptId, setAcceptId] = useState<string | null>(null);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'close' | 'busy' | 'cash' | 'missed' | null>(null);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [extendingId, setExtendingId] = useState<string | null>(null);

  const orders = useMemo(() => board.data?.orders ?? [], [board.data]);
  const cols = useMemo(() => {
    const c = splitColumns(orders);
    return { ...c, new: byTimeLeft(c.new) };
  }, [orders]);
  // Rush (tablet): which new ticket is open; the most urgent unless the kitchen picked another.
  const rush = wide && isRush(cols.new.length);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const expandedId = pickedId && cols.new.some((o) => o.id === pickedId) ? pickedId : (cols.new[0]?.id ?? null);
  const newScroll = useRef<ScrollView>(null);
  const cardY = useRef(new Map<string, number>());
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  useEffect(() => {
    if (!scrollTo) return;
    // After the picked ticket has expanded and laid out.
    const id = setTimeout(() => {
      const y = cardY.current.get(scrollTo);
      if (y !== undefined) newScroll.current?.scrollTo({ y: Math.max(0, y - 6), animated: !theme.reduceMotion });
      setScrollTo(null);
    }, 80);
    return () => clearTimeout(id);
  }, [scrollTo, theme.reduceMotion]);
  const pick = (o: BoardOrder) => {
    setPickedId(o.id);
    setScrollTo(o.id);
  };
  const byId = (id: string | null) => (id ? (orders.find((o) => o.id === id) ?? null) : null);
  const s = status.data;
  const busyOn = s?.busy.on ?? false;
  const oneTap = oneTapPrep(s?.defaultPrepMinutes ?? 20, busyOn);
  const waiting = plan.ringing.length + plan.snoozed.length;
  const gateOpen = shiftGateNeeded(shift.startedDay, Date.now());
  const soundOff = !prefs.soundOn || !soundReady;
  const missed = board.data?.missed;
  const missedNew = missed ? unseenMissed(missed.orders, seen) : [];
  const nudge = missed ? missNudge(missed.orders, seen, now) : false;
  const sheetOpen = acceptId !== null || rejectId !== null || detailId !== null || sheet !== null;
  const push = usePushPrompt(boardCalmForPrompt({ waiting, sheetOpen, shiftStarted: !gateOpen }));

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });

  /** The time sheet (other prep times, partial accept): quiet for this order while it is open. */
  const onAccept = (o: BoardOrder) => {
    if (offlineGuard()) return;
    alarm.handle(o.id);
    setDetailId(null);
    setAcceptPartial(false);
    setAcceptId(o.id);
  };
  /** One tap: the usual time (M-12). */
  const onAcceptNow = async (o: BoardOrder) => {
    alarm.handle(o.id);
    setAcceptingId(o.id);
    try {
      await accept.mutateAsync({ orderId: o.id, prepMinutes: oneTap.prepMinutes });
      toast.show({ message: t('merchant.accept.done', { minutes: oneTap.shown }), tone: 'success', icon: 'check' });
      if (prefs.autoPrint) void print(o, { auto: true });
    } catch (err) {
      fail(err);
    } finally {
      setAcceptingId(null);
      alarm.release(o.id);
    }
  };
  const onReject = (o: BoardOrder) => {
    if (offlineGuard()) return;
    alarm.handle(o.id);
    setDetailId(null);
    setRejectId(o.id);
  };
  const closeAccept = () => {
    if (acceptId) alarm.release(acceptId);
    setAcceptId(null);
  };
  const closeReject = () => {
    if (rejectId) alarm.release(rejectId);
    setRejectId(null);
  };
  const onReady = async (o: BoardOrder) => {
    if (offlineGuard()) return;
    setReadyId(o.id);
    try {
      await ready.mutateAsync({ orderId: o.id });
      toast.show({ message: t('merchant.card.mark_ready'), tone: 'success', icon: 'check' });
      setDetailId(null);
    } catch (err) {
      fail(err);
    } finally {
      setReadyId(null);
    }
  };
  const onExtend = async (o: BoardOrder) => {
    setExtendingId(o.id);
    try {
      await extend.mutateAsync({ orderId: o.id });
      toast.show({ message: t('merchant.extend.done'), tone: 'success', icon: 'clock' });
    } catch (err) {
      fail(err);
    } finally {
      setExtendingId(null);
    }
  };
  const toggleOpen = async () => {
    if (!s) return;
    if (s.open) {
      setSheet('close');
      return;
    }
    try {
      await setOpen.mutateAsync({ merchantOrgId: s.merchantOrgId, open: true });
      toast.show({ message: t('merchant.status.opened'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };
  const soundOn = async () => {
    if (!prefs.soundOn) await prefsStore.setSound(true);
    const ok = await testChime();
    toast.show(ok ? { message: t('merchant.sound.on_toast'), tone: 'success', icon: 'check' } : { message: t('merchant.settings.test_sound_blocked'), tone: 'warning' });
  };
  const beginShift = async () => {
    if (!prefs.soundOn) await prefsStore.setSound(true);
    const r = await startShift();
    toast.show(r.sound ? { message: t('merchant.shift.started'), tone: 'success', icon: 'check' } : { message: t('merchant.shift.no_sound'), tone: 'warning' });
  };

  const card = (o: BoardOrder) => {
    const ringing = plan.ringing.includes(o.id);
    const compact = rush && o.column === 'new' && o.id !== expandedId;
    return (
      <View
        key={o.id}
        onLayout={o.column === 'new' ? (e) => cardY.current.set(o.id, e.nativeEvent.layout.y) : undefined}
      >
      <OrderCard
        order={o}
        compact={compact}
        onExpand={() => pick(o)}
        now={now}
        clock={clock}
        ringing={ringing}
        stage={ringing && o.acceptBy ? stageFor(o.acceptBy.getTime() - now) : null}
        oneTapMinutes={oneTap.shown}
        onAcceptNow={() => void onAcceptNow(o)}
        onAccept={() => onAccept(o)}
        onReject={() => onReject(o)}
        onReady={() => void onReady(o)}
        onOpen={() => setDetailId(o.id)}
        onExtend={() => void onExtend(o)}
        busyReady={readyId === o.id}
        busyAccept={acceptingId === o.id}
        busyExtend={extendingId === o.id}
      />
      </View>
    );
  };

  const loading = !board.data && board.isPending;
  const skeleton = (
    <View style={{ gap: theme.space[3] }}>
      <Skeleton height={220} radius={20} />
      <Skeleton height={160} radius={20} />
    </View>
  );

  // Outside the weekly hours or on a holiday: the switch can read "open" while customers can't order.
  const offHours =
    s && !s.closed && !s.pause
      ? scheduleBanner(t, s.schedule, localDayKey(s.now), (d) =>
          dates.dayMonth(new Date(`${d}T12:00:00+03:00`)),
        )
      : null;

  const alerts = [
    !gateOpen && soundOff ? <HeaderChip key="sound" testID="sound-off-chip" icon="volume-off" tone="danger" dot label={t('merchant.sound.off_chip')} onPress={() => void soundOn()} /> : null,
    !gateOpen && Platform.OS === 'web' && wake !== 'on' ? <HeaderChip key="wake" testID="wake-chip" icon="screen" tone="warning" label={t('merchant.wake.chip')} onPress={() => void requestWakeLock()} /> : null,
    missed && missed.today > 0 ? <HeaderChip key="missed" testID="missed-chip" icon="bell" tone="danger" label={t('merchant.missed.chip', { count: missed.today })} onPress={() => setSheet('missed')} /> : null,
  ].filter((x) => x !== null);

  const urgent = plan.mostUrgent;
  const summary = newOrderSummary(orders, plan.snoozed);
  const sticky = !wide && segment === 'new' ? stickyAcceptTarget(cols.new) : null;
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
        alerts={alerts}
      />
      {waiting > 0 ? (
        <NewOrderBanner
          count={plan.ringing.length}
          snoozedCount={plan.snoozed.length}
          stage={plan.stage}
          mostUrgent={urgent ? { number: urgent.number, seconds: urgent.msLeft === null ? null : Math.max(0, Math.ceil(urgent.msLeft / 1000)) } : null}
          snoozeSeconds={plan.snoozeEndsAt === null ? null : Math.ceil((plan.snoozeEndsAt - now) / 1000)}
          soundBlocked={prefs.soundOn && !soundReady}
          onSnooze={() => alarm.snooze(clock())}
          onUnsnooze={() => alarm.unsnooze(clock())}
          onEnableSound={() => void soundOn()}
          compact={!wide}
          summary={summary}
        />
      ) : null}
      <MissedStrip
        missed={missedNew}
        onOk={() => markSeen(missedNew.map((m) => m.orderId))}
        {...(nudge && !busyOn ? { nudge: { text: t('merchant.missed.nudge'), onBusy: () => setSheet('busy'), onClose: () => setSheet('close') } } : {})}
      />
      {!online ? (
        <InfoStrip tone="neutral" text={t('merchant.board.offline_actions')} testID="offline-strip" />
      ) : conn.kind === 'stale' ? (
        <InfoStrip tone="warning" text={t('merchant.board.stale', { ago: agoText(conn.ageSeconds ?? 0, t) })} testID="stale-strip" />
      ) : null}
      {s?.closed ? (
        <InfoStrip tone="danger" testID="closed-strip" text={t('merchant.board.closed_banner')} action={{ label: t('merchant.board.open_again'), onPress: () => void toggleOpen() }} />
      ) : s?.pause ? (
        <InfoStrip
          tone="warning"
          text={t('merchant.board.paused_banner', {
            reason: s.pause.reason ?? '',
            time: s.pause.until,
          })}
        />
      ) : offHours ? (
        <InfoStrip tone="warning" testID="offhours-strip" text={offHours} />
      ) : null}
      {board.isError && !board.data ? <InfoStrip tone="danger" text={t('merchant.board.error')} /> : null}
      {/* One busy nudge at a time: the missed-orders strip already offers it when it shows its own. */}
      {suggestBusy(cols.new.length, busyOn) && s?.open && !(missedNew.length > 0 && nudge) ? (
        <InfoStrip
          tone="warning"
          icon="flame"
          testID="rush-busy-strip"
          text={t('merchant.rush.suggest_busy', { count: cols.new.length })}
          action={{ label: t('merchant.rush.busy_on'), onPress: () => setSheet('busy'), testID: 'rush-busy-on' }}
        />
      ) : null}
      {push.visible ? (
        <InfoStrip
          tone="neutral"
          icon="bell"
          testID="push-strip"
          text={t('merchant.push.strip')}
          action={{ label: t('merchant.push.enable'), onPress: push.allow, testID: 'push-strip-allow' }}
          secondary={{ label: t('merchant.push.later'), onPress: push.later, testID: 'push-strip-later' }}
        />
      ) : null}

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
              {c === 'new' && rush ? <RushQueue orders={cols.new} clock={clock} selectedId={expandedId} onPick={pick} /> : null}
              <ScrollView
                ref={c === 'new' ? newScroll : undefined}
                style={{ flex: 1 }}
                contentContainerStyle={{ gap: c === 'new' && rush ? theme.space[3] : theme.space[4], paddingBottom: theme.space[6], paddingHorizontal: 3, paddingTop: 3 }}
                showsVerticalScrollIndicator={false}
              >
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
          {sticky ? (
            <StickyAcceptBar
              order={sticky}
              clock={clock}
              oneTapMinutes={oneTap.shown}
              busy={acceptingId === sticky.id}
              onAccept={() => void onAcceptNow(sticky)}
              onReject={() => onReject(sticky)}
              onOpen={() => setDetailId(sticky.id)}
            />
          ) : null}
        </View>
      )}

      <AcceptSheet
        order={byId(acceptId)}
        onClose={closeAccept}
        startPartial={acceptPartial}
        busyOn={busyOn}
        usualPrepMinutes={s?.defaultPrepMinutes ?? 20}
        clock={clock}
        onAccepted={(o) => {
          if (prefs.autoPrint) void print(o, { auto: true });
        }}
      />
      <RejectSheet
        order={byId(rejectId)}
        onClose={closeReject}
        onAlternative={(action, o) => {
          setRejectId(null);
          if (action === 'partial') {
            setAcceptPartial(true);
            setAcceptId(o.id);
          } else {
            alarm.release(o.id);
            setSheet(action === 'busy' ? 'busy' : 'close');
          }
        }}
      />
      <OrderDetailSheet order={byId(detailId)} now={now} clock={clock} onClose={() => setDetailId(null)} onAccept={onAccept} onReject={onReject} onReady={(o) => void onReady(o)} onPrint={(o) => void print(o)} />
      {s ? <CloseStoreSheet status={s} visible={sheet === 'close'} onClose={() => setSheet(null)} /> : null}
      {s ? <BusySheet status={s} visible={sheet === 'busy'} onClose={() => setSheet(null)} now={now} /> : null}
      {storeId ? <CashSheet merchantOrgId={storeId} balance={balance.data} visible={sheet === 'cash'} onClose={() => setSheet(null)} /> : null}
      <ModalSheet visible={sheet === 'missed'} onClose={() => setSheet(null)} title={t('merchant.missed.sheet_title')} testID="missed-sheet">
        {(missed?.orders ?? []).length === 0 ? (
          <Text variant="body" color="textMuted">
            {t('merchant.missed.sheet_empty')}
          </Text>
        ) : (
          (missed?.orders ?? []).map((m) => (
            <View key={m.orderId} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: m.reason === 'merchant_timeout' ? theme.colors.dangerTint : theme.colors.surfaceSunken }}>
              <Text weight={700} tabular style={{ fontSize: 20, lineHeight: 28 }}>{`#${m.number}`}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight={600} color={m.reason === 'merchant_timeout' ? 'dangerText' : 'text'}>
                  {m.reason === 'merchant_timeout' ? t('merchant.missed.row_timeout') : t('merchant.missed.row_partial')}
                  {m.reason === 'merchant_timeout' && !m.scored ? ` · ${t('merchant.missed.not_scored')}` : ''}
                </Text>
                <Text variant="caption" color="textMuted" tabular>
                  {`${clock12(m.missedAt)} · ${t('merchant.card.items', { count: m.itemCount })} · ${iqd(m.totalIqd, { locale })}`}
                </Text>
              </View>
            </View>
          ))
        )}
      </ModalSheet>
      {gateOpen && storeId ? <ShiftGate waiting={waiting} soundOn={prefs.soundOn} printer={printerChipState(printerSnap, s?.printer.state)} onStart={beginShift} /> : null}
    </SafeAreaView>
  );
}
