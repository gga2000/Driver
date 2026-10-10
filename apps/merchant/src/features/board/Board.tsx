import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BoardColumn, BoardOrder } from '@driver/contracts';
import { agoText, Button, ModalSheet, SegmentedControl, Skeleton, Text, useConnectionBanner, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { useClaimOfflineBanner } from '@/lib/banner-room';
import { MIcon, type MIconName } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';
import { testChime } from '@/lib/alert-sound';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { localDayKey } from '@/lib/calendar';
import { useDates } from '@/lib/dates';
import { requestWakeLock, useWakeState } from '@/lib/keep-awake';
import { useLayout } from '@/lib/layout';
import { LIVE_MERCHANT_KEY, useLiveMode } from '@/lib/live';
import { iqd } from '@/lib/money';
import { prefs as prefsStore, usePrefs } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import { clock12 } from '@/lib/time';
import { scheduleBanner } from '@/features/hours/logic';
import { fixPush, usePushHealth, usePushPrompt } from '@/features/notify/Push';
import { boardCalmForPrompt } from '@/features/notify/prompt';
import { printerChipState, queueAutoPrint, useAutoPrint, usePrinterSnapshot, usePrintOrder, type StorePrint } from '@/features/print/runtime';
import { DayLine, DaySummaryCard } from '@/features/day/DaySummaryCard';
import { dayCardKey, dayCardMode, orderWhoLine, showDayCard } from '@/features/day/logic';
import { useDayDismissed, useDaySummary } from '@/features/day/queries';
import { unseenPhotoDowns } from '@/features/menu/photo-down';
import { photoDownNotice, usePhotoDownSeen } from '@/features/menu/PhotoDown';
import { useMenu } from '@/features/menu/queries';
import { beforeFirstOrder } from '@/features/money/logic';
import { useCashAccount, useOrderWho } from '@/features/money/queries';
import { useBalance, useCurrentStore, useStoreStatus, useStoreSwitches } from '@/features/store/queries';
import { StoreHeader, type HeaderAlert } from '@/features/store/StoreHeader';
import { FirstOrderRibbon, SetupBoardCard, SetupBoardWaiting } from '@/features/setup/BoardSetup';
import { shouldLand } from '@/features/setup/logic';
import { setupSession, useSetupActions } from '@/features/setup/queries';
import { BusySheet, CashSheet, CloseStoreSheet } from '@/features/store/StoreSheets';
import { AcceptSheet } from './AcceptSheet';
import { alarm, useAlarmPlan, useSoundReady } from './alarm';
import { InfoStrip, missedText, NewOrderBanner } from './Banners';
import { useCourierArrivals } from './useCourierArrivals';
import { acceptAllTargets, busyExtra, byDueFirst, byTimeLeft, COLUMN_LABEL, COLUMNS, cookingTotals, isRush, newOrderSummary, oneTapPrep, phoneNow, rushRows, splitColumns, suggestBusy, type CookingTotal } from './logic';
import { DragToReady } from './DragToReady';
import { learn, lessonNow, useLessonDue } from './learn';
import { LearnCards, useStartPractice } from './LearnCards';
import { missNudge, unseenMissed } from './missed';
import { OrderCard } from './OrderCard';
import { OrderDetailSheet } from './OrderDetailSheet';
import { PassCard } from './PassCard';
import { passFirst, passState, waitingAtPass } from './pass';
import { isPractice, practice, usePractice } from './practice';
import { useServerTime } from './clock';
import { useBoard, useOnline, useOrderActions, useRemake, useRemakeRule } from './queries';
import { autoBusy, busyMinutesNow, remakeErrorKey, remakeOffer, remakeOutcome, waitingOrders, type RemakeOutcome } from './shop-load';
import { AutoBusyStrip, PauseStrip, RemakeSheet, usePauseView } from './ShopLoadParts';
import { readyQueue, useReadyQueue } from './ready-queue';
import { RejectSheet } from './RejectSheet';
import { StickyAcceptBar } from './Rush';
import { ShiftGate } from './ShiftGate';
import { shiftGateNeeded, startShift, useShift } from './shift';
import { useMissedSeen } from './useMissed';
import { useTicks } from './useTicks';

const EMPTY_ICON: Record<BoardColumn, MIconName> = { new: 'bell', preparing: 'flame', ready: 'bag' };

/** A line above a ticket: «طلب تجربة · ما يروح لأي زبون» (s2), «جاهز · ينبعث أول ما يرجع النت» (y6). */
function OrderTag({ icon, text, action, testID }: { icon: MIconName; text: string; action?: { label: string; onPress: () => void }; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 36, paddingStart: theme.space[3], paddingEnd: action ? theme.space[1] : theme.space[3], borderRadius: theme.radius.lg, backgroundColor: COUNTER.sand }}>
      <MIcon name={icon} size={16} color={COUNTER.qty} strokeWidth={2.2} />
      <Text variant="footnote" weight={700} style={{ flex: 1, color: COUNTER.qty }}>
        {text}
      </Text>
      {action ? <Button testID={`${testID}-action`} label={action.label} variant="ghost" size="sm" onPress={action.onPress} /> : null}
    </View>
  );
}

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
  // One job per colour: the new lane's count is dark saffron, the cooking lane's date brown, ready green.
  const badge = column === 'new' ? COUNTER.newBadge : column === 'preparing' ? COUNTER.date : COUNTER.ready;
  const quiet = count === 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingBottom: theme.space[3] }}>
      <Text variant="title" style={[theme.face('display'), { color: COUNTER.date }]}>
        {t(COLUMN_LABEL[column])}
      </Text>
      <View style={{ minWidth: 30, height: 28, paddingHorizontal: 8, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: quiet ? theme.colors.surfaceSunken : badge }}>
        <Text variant="label" tabular style={[theme.face('display'), { color: quiet ? theme.colors.textMuted : COUNTER.onDate }]}>
          {String(count)}
        </Text>
      </View>
    </View>
  );
}

/**
 * «على النار» added up (o11): every dish still to make across the cooking tickets, so the grill cook
 * works from one line. Hidden while nothing is cooking.
 */
function CookingTotals({ totals }: { totals: readonly CookingTotal[] }) {
  const theme = useTheme();
  const t = useT();
  if (totals.length === 0) return null;
  return (
    <View testID="cooking-totals" accessibilityLabel={t('merchant.board.totals_a11y', { list: totals.map((x) => `${x.qty} ${x.name}`).join('، ') })} style={{ backgroundColor: COUNTER.date, borderRadius: theme.radius.lg, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], gap: 6, marginBottom: theme.space[2] }}>
      <Text variant="caption" weight={700} style={{ color: COUNTER.onDateMuted }}>
        {t('merchant.board.totals_title')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space[3], rowGap: 4 }}>
        {totals.map((x) => (
          <Text key={x.name} weight={700} tabular style={{ color: COUNTER.onDate, fontSize: 16, lineHeight: 24 }}>
            <Text tabular style={[theme.face('display'), { color: COUNTER.busy, fontSize: 16, lineHeight: 24 }]}>{`${x.qty}× `}</Text>
            {x.name}
          </Text>
        ))}
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
 *
 * Counter redesign step 2: one dark status bar (missed orders and the courier at the pass are chips in
 * it; no radar panel — couriers show on their own tickets), the next order on the saffron ribbon with
 * one-tap accept (a1), every waiting order a readable ticket (o1), «على النار» due-first (o6) with a
 * draining time bar (o5), dishes ticked off one by one (o10) and added up (o11). Phone «هسة» (o2): one
 * order in full, the rest as rows.
 *
 * Step 3 (rush and busy): above six waiting, the tablet's new tickets are one line each with their own
 * button (r2); busy mode puts a gold frame round the board and a gold chip with its end time in the
 * bar, one tap away on a phone too (r1, r3); the busy chip pulses «زحمة؟» instead of a strip (r4);
 * «اقبل الكل» in busy mode (t4); a cooking ticket can be dragged to the ready lane (o9); a new order
 * ringing closes the sheets that only show things (a7).
 */
export function Board() {
  const theme = useTheme();
  const t = useT();
  const dates = useDates();
  const locale = useLocale();
  const toast = useCounterToast();
  const prefs = usePrefs();
  const { wide } = useLayout();
  const { store, canSeeMoney } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const board = useBoard(storeId);
  const status = useStoreStatus(storeId);
  const balance = useBalance(storeId, canSeeMoney);
  // S-M5: the pill in one line comes from the server (owed and how it reaches him, owe, requested).
  const cash = useCashAccount(storeId, canSeeMoney);
  const online = useOnline();
  /** Offline: accept / reject can't reach the server; say why instead of failing. The practice order never needs the net. */
  const offlineGuard = (o?: BoardOrder) => {
    if (online || (o && isPractice(o.id))) return false;
    toast.show({ message: t('merchant.board.offline_toast'), tone: 'warning' });
    return true;
  };
  const { accept, ready, extend, handOver } = useOrderActions();
  const { setOpen } = useStoreSwitches();
  // h3: the board itself re-draws once a minute (pass order, «من 4 د» sorting); tickets, rings and the
  // new-order strip follow the shared clock on their own.
  const now = useServerTime(60_000);
  const clock = useCallback(() => Date.now() + board.offset, [board.offset]);
  const plan = useAlarmPlan();
  const soundReady = useSoundReady();
  const wake = useWakeState();
  const shift = useShift();
  const personId = useSession().session?.personId ?? null;
  const lessonDue = useLessonDue(personId);
  const startPractice = useStartPractice();
  const trial = usePractice();
  const queued = useReadyQueue();
  const printerSnap = usePrinterSnapshot();
  const printStore: StorePrint = useMemo(() => ({ orgId: storeId, name: store?.name ?? '', prepKind: status.data?.prepKind }), [storeId, store?.name, status.data?.prepKind]);
  const print = usePrintOrder(printStore);
  const { seen, markSeen } = useMissedSeen();
  const ticks = useTicks();

  const [segment, setSegment] = useState<BoardColumn>('new');
  const [acceptId, setAcceptId] = useState<string | null>(null);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'close' | 'busy' | 'cash' | 'missed' | null>(null);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [handingId, setHandingId] = useState<string | null>(null);
  // c6 «سوّيناه من جديد»: shown only while the server's money rule pays (`remakeRule`; it can be switched off).
  const [remakeId, setRemakeId] = useState<string | null>(null);
  const [remade, setRemade] = useState<Record<string, RemakeOutcome>>({});
  const remakeRule = useRemakeRule(!!storeId);
  const remake = useRemake();

  const orders = useMemo(() => board.data?.orders ?? [], [board.data]);
  // Print redesign: accepted orders print when they are ready to cook (after a partial answer, at a
  // scheduled start), and a printed order that changed prints a short «تعديل» ticket.
  useAutoPrint(orders, printStore, prefs.autoPrint, now);
  // «منو سوّى شنو» on the order sheet: the owner's only, read when a sheet opens (never on the board payload).
  const whoDetailId = canSeeMoney && detailId && !isPractice(detailId) ? detailId : null;
  const orderWho = useOrderWho(storeId, whoDetailId, whoDetailId !== null);
  const whoLine = whoDetailId && orderWho.data?.orderId === whoDetailId ? orderWhoLine(orderWho.data.entries, canSeeMoney, t) : null;
  // Maps program SP7a: a chime when a courier is about to walk in.
  useCourierArrivals(board.data?.orders, prefs.soundOn);
  // The ready column reads in counter order (S-M4): couriers waiting at the pass first.
  const nowMinute = Math.floor(now / 60_000);
  const cols = useMemo(() => {
    const c = splitColumns(orders);
    return { ...c, new: byTimeLeft(c.new), preparing: byDueFirst(c.preparing), ready: passFirst(c.ready, nowMinute * 60_000) };
  }, [orders, nowMinute]);
  const atPass = waitingAtPass(cols.ready, now);
  const firstPass = atPass[0] ? passState(atPass[0], now) : null;
  const totals = useMemo(() => cookingTotals(cols.preparing, ticks.ticked), [cols.preparing, ticks.ticked]);
  // Rush (tablet): which new ticket is open; the most urgent unless the kitchen picked another.
  const rush = wide && isRush(cols.new.length);
  // r2: above six waiting, the tablet's new tickets are one line each with a button (the ribbon carries
  // the next one in full); a row tapped opens in full in the lane.
  const rows = wide && rushRows(cols.new.length);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const expandedId = pickedId && cols.new.some((o) => o.id === pickedId) ? pickedId : rows ? null : (cols.new[0]?.id ?? null);
  // Phone «هسة» (o2): the picked (or most urgent) order in full, the rest as rows.
  const now1 = phoneNow(cols.new, pickedId);
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
  const remakeOrder = byId(remakeId);
  const onRemake = async () => {
    if (!remakeOrder || offlineGuard()) return;
    try {
      const r = await remake.mutateAsync({ orderId: remakeOrder.id });
      setRemade((m) => ({ ...m, [r.orderId]: remakeOutcome(r) }));
    } catch (err) {
      const code = apiErrorCode(err);
      // Switched off meanwhile: re-read the rule so the button goes.
      if (code === 'money_rule_off') void remakeRule.refetch();
      const key = remakeErrorKey(code);
      setRemakeId(null);
      toast.show({ message: key ? t(key) : apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'warning' });
    }
  };
  const s = status.data;
  // «جهّز محلك» (s1, s5, l3): until the shutter goes up the board keeps a setup card instead of the
  // closed strip, the first visit of a session opens setup for the owner (once; «بعدين» is always
  // allowed), and the first real order wears the gold ribbon until it has left the board.
  const setupLine = s?.setup ?? null;
  const inSetup = !!setupLine && !setupLine.live;
  const firstId = setupLine?.firstOrderId ?? null;
  const setupActions = useSetupActions();
  useEffect(() => {
    if (!shouldLand({ owner: canSeeMoney, setup: setupLine, landed: setupSession.landed })) return;
    setupSession.landed = true;
    router.push('/setup');
  }, [canSeeMoney, setupLine]);
  const seenSent = useRef<string | null>(null);
  useEffect(() => {
    if (!firstId || !canSeeMoney || !storeId || !board.data || seenSent.current === firstId) return;
    // Only a board read after the status that named the order can say it has gone.
    if (board.dataUpdatedAt < status.dataUpdatedAt) return;
    if (orders.some((o) => o.id === firstId && !o.handedOverAt)) return;
    seenSent.current = firstId;
    setupActions.firstOrderSeen.mutate({ merchantOrgId: storeId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the board or the first order changes
  }, [firstId, canSeeMoney, storeId, board.data, board.dataUpdatedAt, status.dataUpdatedAt, orders]);
  // S-M6: the day's card at close (or from 00:30 for the day before), until "تمام" on this device.
  const daySummary = useDaySummary(storeId, `${s?.open ?? ''}:${s?.closed?.at?.toString() ?? ''}:${s?.schedule?.inHours ?? ''}`);
  const { dismissed: dayDismissed, dismiss: dismissDay } = useDayDismissed();
  const showDay = showDayCard(daySummary.data, dayDismissed);
  // d01: while orders wait the day's card is one line (the full card a tap away, in a sheet).
  const dayMode = dayCardMode({ show: showDay && !!daySummary.data, waiting: cols.new.length, closed: Boolean(s?.closed) || s?.schedule?.inHours === false });
  const [dayOpen, setDayOpen] = useState(false);
  // p4: a dish photo Driver's team took down — the board says it once, in a quiet moment; the menu keeps saying why.
  const menu = useMenu(inSetup ? null : storeId, { refetchMs: 5 * 60_000 });
  const { seen: photoSeen, markSeen: markPhotoSeen } = usePhotoDownSeen();
  const photoDowns = useMemo(() => unseenPhotoDowns(menu.data?.categories, photoSeen), [menu.data, photoSeen]);
  // d07: offline long enough that customers see the shop closed — the board says it once, nothing else shouts.
  const pause = usePauseView(online);
  const pausedNow = pause.kind === 'paused';
  useClaimOfflineBanner(pausedNow);
  const busyOn = s?.busy.on ?? false;
  // l4: from 15 waiting orders the server adds the busy +10 itself (never on top of busy mode), so the
  // one-tap and the accept sheet show what the customer will be promised.
  const auto = useMemo(() => autoBusy(waitingOrders(orders, now), busyOn), [orders, now, busyOn]);
  const busyMinutes = busyMinutesNow(busyExtra(s), auto);
  const oneTap = oneTapPrep(s?.defaultPrepMinutes ?? 20, busyMinutes, s?.prepKind);
  // m6a: orders still waiting while the store is closed count (and show) too, but never ring.
  const waiting = plan.ringing.length + plan.snoozed.length + plan.closed.length;
  const gateOpen = shiftGateNeeded(shift.startedDay, Date.now());
  const soundOff = !prefs.soundOn || !soundReady;
  const missed = board.data?.missed;
  const missedNew = missed ? unseenMissed(missed.orders, seen) : [];
  const nudge = missed ? missNudge(missed.orders, seen, now) : false;
  const sheetOpen = acceptId !== null || rejectId !== null || detailId !== null || sheet !== null;
  /** Closing «طلبات فاتتك» counts as «تمام» for the ones it showed (the strip it replaced did the same). */
  const closeMissed = () => {
    if (missedNew.length > 0) markSeen(missedNew.map((m) => m.orderId));
    setSheet(null);
  };
  const push = usePushPrompt(boardCalmForPrompt({ waiting, sheetOpen, shiftStarted: !gateOpen }));
  const pushHealth = usePushHealth();
  // a7: a new order starts ringing → the sheets that only show things step aside (missed orders, the
  // cash, the phone's "…", the details of an order that isn't new), so nothing hides the ribbon. The
  // accept / reject sheets, and busy / close (decisions about the rush itself), stay.
  const [newRings, setNewRings] = useState(0);
  const rang = useRef<readonly string[]>([]);
  const ringKey = plan.ringing.join(',');
  useEffect(() => {
    const fresh = plan.ringing.some((id) => !rang.current.includes(id));
    rang.current = plan.ringing;
    if (!fresh) return;
    setNewRings((n) => n + 1);
    setSheet((x) => (x === 'missed' || x === 'cash' ? null : x));
    setDayOpen(false);
    setDetailId((d) => (d && !plan.ringing.includes(d) && !plan.snoozed.includes(d) ? null : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the set of ringing orders changes
  }, [ringKey]);

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });

  /** The time sheet (other prep times, partial accept): quiet for this order while it is open. */
  const onAccept = (o: BoardOrder) => {
    if (offlineGuard(o)) return;
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
      if (prefs.autoPrint) queueAutoPrint(o.id);
    } catch (err) {
      fail(err);
    } finally {
      setAcceptingId(null);
      alarm.release(o.id);
    }
  };
  const onReject = (o: BoardOrder) => {
    if (offlineGuard(o)) return;
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
  /** «صار جاهز» (a tap, or o9: a cooking ticket dragged toward the ready lane). True when it went through. */
  const onReady = async (o: BoardOrder): Promise<boolean> => {
    // y6: with no net the tap is kept and sent when the net is back; the card moves to «جاهز» now.
    if (!online && !isPractice(o.id)) {
      readyQueue.add(o.id);
      toast.show({ message: t('merchant.offline.ready_kept'), tone: 'warning', icon: 'clock' });
      setDetailId(null);
      return true;
    }
    setReadyId(o.id);
    try {
      await ready.mutateAsync({ orderId: o.id });
      toast.show({ message: t('merchant.card.mark_ready'), tone: 'success', icon: 'check' });
      setDetailId(null);
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setReadyId(null);
    }
  };
  /**
   * «اقبل الكل» (t4, busy mode): every waiting order with no allergy and no note, at the usual time,
   * one after the other. The ones with something to read stay ringing, to be opened one by one.
   */
  const [acceptingAll, setAcceptingAll] = useState(false);
  const onAcceptAll = async (targets: readonly BoardOrder[], skipped: number) => {
    if (offlineGuard() || acceptingAll) return;
    setAcceptingAll(true);
    for (const o of targets) alarm.handle(o.id);
    let done = 0;
    let failed: unknown = null;
    for (const o of targets) {
      try {
        await accept.mutateAsync({ orderId: o.id, prepMinutes: oneTap.prepMinutes });
        done += 1;
        if (prefs.autoPrint) queueAutoPrint(o.id);
      } catch (err) {
        failed = err;
      }
    }
    for (const o of targets) alarm.release(o.id);
    setAcceptingAll(false);
    if (failed) fail(failed);
    if (done === 0) return;
    const head = done === 2 ? t('merchant.rush.accepted_all_two', { minutes: oneTap.shown }) : t('merchant.rush.accepted_all', { count: done, minutes: oneTap.shown });
    // With orders left to read, say so now (a warning shows even while they ring, at the bottom).
    toast.show(skipped > 0 ? { message: `${head} · ${skipped === 1 ? t('merchant.rush.accept_all_left_one') : t('merchant.rush.accept_all_left', { count: skipped })}`, tone: 'warning', icon: 'check' } : { message: head, tone: 'success', icon: 'check' });
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
  /** "سلّمته" (S-M4): the hand-over at the pass, recorded on the order's history. */
  const onHandOver = async (o: BoardOrder) => {
    if (offlineGuard(o)) return;
    setHandingId(o.id);
    try {
      await handOver.mutateAsync({ orderId: o.id });
      toast.show({ message: t('merchant.pass.handed_toast', { number: o.number }), tone: 'success', icon: 'check' });
    } catch (err) {
      fail(err);
    } finally {
      setHandingId(null);
    }
  };
  const toggleOpen = async () => {
    if (!s) return;
    // A shop still in setup opens by raising its shutter at the end of setup.
    if (setupLine && !setupLine.live) {
      router.push(canSeeMoney && setupLine.left === 0 ? '/setup/open' : '/setup');
      return;
    }
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
  /** s1: either answer to the lesson starts the shift too (the tap unlocks the sound). */
  const finishLesson = async (withPractice: boolean) => {
    learn.done(personId);
    if (gateOpen) await beginShift();
    if (withPractice) startPractice();
  };
  // The practice order started from setup's counter list: handed over → the step is done, back to the list.
  useEffect(() => {
    if (trial.ended !== 'done' || !setupSession.practiceFromSetup || !storeId) return;
    setupSession.practiceFromSetup = false;
    setupActions.check.mutate({ merchantOrgId: storeId, check: 'practice' }, { onSuccess: () => router.push('/setup/counter') });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per ending
  }, [trial.ended, storeId]);
  // s2: how the practice order ended, said once.
  useEffect(() => {
    if (!trial.ended) return;
    const key = trial.ended === 'done' ? 'merchant.practice.done' : trial.ended === 'rejected' ? 'merchant.practice.rejected' : trial.ended === 'timeout' ? 'merchant.practice.timeout' : null;
    if (key) toast.show({ message: t(key), tone: trial.ended === 'done' ? 'success' : 'neutral', icon: trial.ended === 'done' ? 'check' : 'bulb' });
    practice.clearEnded();
  }, [trial.ended, toast, t]);
  const beginShift = async () => {
    if (!prefs.soundOn) await prefsStore.setSound(true);
    const r = await startShift();
    // At closing the board leads with the day's card ("خلص الدوام"): no "بالتوفيق" toast on top of it.
    // A blocked chime still shows as the red sound chip in the header.
    if (showDay) return;
    toast.show(r.sound ? { message: t('merchant.shift.started'), tone: 'success', icon: 'check' } : { message: t('merchant.shift.no_sound'), tone: 'warning' });
  };

  const remadeText = (r: RemakeOutcome) => (r.kind === 'paid' ? t('merchant.remake.paid_tag', { amount: iqd(r.amountIqd, { locale }) }) : t('merchant.remake.already'));
  const card = (o: BoardOrder) => {
    const body = ticket(o);
    // s2 / y6: a practice ticket and a «جاهز» waiting for the net say so above the ticket.
    const tag = o.id === firstId ? (
      <FirstOrderRibbon />
    ) : isPractice(o.id) ? (
      <OrderTag testID={`practice-tag-${o.number}`} icon="bulb" text={t('merchant.practice.tag')} action={{ label: t('merchant.practice.stop'), onPress: () => practice.end('stopped') }} />
    ) : queued.some((q) => q.orderId === o.id) ? (
      <OrderTag testID={`queued-${o.number}`} icon="clock" text={t('merchant.offline.ready_waiting')} />
    ) : remade[o.id] ? (
      <OrderTag testID={`remade-${o.number}`} icon="check" text={remadeText(remade[o.id]!)} />
    ) : remakeOffer(o, remakeRule.data, now) !== null ? (
      <OrderTag testID={`remake-${o.number}`} icon="refresh" text={t('merchant.remake.tag', { minutes: remakeOffer(o, remakeRule.data, now)! })} action={{ label: t('merchant.remake.action'), onPress: () => setRemakeId(o.id) }} />
    ) : null;
    if (!tag) return body;
    return (
      <View key={o.id} style={{ gap: theme.space[1] }}>
        {tag}
        {body}
      </View>
    );
  };
  const ticket = (o: BoardOrder) => {
    const pass = passState(o, now);
    if (pass) {
      return (
        <View key={o.id}>
          <PassCard order={o} pass={pass} busy={handingId === o.id} onHandOver={() => void onHandOver(o)} onOpen={() => setDetailId(o.id)} />
        </View>
      );
    }
    const ringing = plan.ringing.includes(o.id);
    const compact = rush && !rows && o.column === 'new' && o.id !== expandedId;
    const row = wide ? rows && o.column === 'new' && o.id !== expandedId : o.column === 'new' && o.id !== now1.first?.id;
    return (
      <View
        key={o.id}
        onLayout={o.column === 'new' ? (e) => cardY.current.set(o.id, e.nativeEvent.layout.y) : undefined}
      >
      <DragToReady testID={`drag-${o.number}`} enabled={wide && o.column === 'preparing'} onReady={() => onReady(o)}>
      <OrderCard
        order={o}
        compact={compact}
        row={row}
        rowAction={wide}
        ticks={ticks}
        onExpand={() => (wide ? pick(o) : setPickedId(o.id))}
        clock={clock}
        ringing={ringing && !pausedNow}
        noRing={pausedNow}
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
      </DragToReady>
      </View>
    );
  };

  const loading = !board.data && board.isPending;
  // The first read failed: say so with a retry, and never show "no new orders" for a board we can't see.
  const failed = !board.data && board.isError;
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

  // d04: the header's one alarm slot takes the first of these (most urgent first); the rest, the missed
  // orders and the printer wait in «…» with a dot.
  const alertList: (HeaderAlert | null)[] = [
    // MER-12: a device that can't ring with the app closed says so until it's fixed.
    !gateOpen && (pushHealth === 'off' || pushHealth === 'failed')
      ? { key: 'push', testID: 'push-off-chip', icon: 'bell', tone: 'danger', dot: true, label: t(pushHealth === 'off' ? 'merchant.push.off_chip' : 'merchant.push.failed_chip'), onPress: fixPush }
      : null,
    !gateOpen && soundOff ? { key: 'sound', testID: 'sound-off-chip', icon: 'volume-off', tone: 'danger', dot: true, label: t('merchant.sound.off_chip'), onPress: () => void soundOn() } : null,
    inSetup && setupLine ? { key: 'setup', testID: 'setup-chip', icon: 'store', tone: 'warning', label: t('merchant.setup.header_chip', { percent: setupLine.percent }), onPress: () => router.push(canSeeMoney ? '/setup' : '/more') } : null,
    // S-M4 on a phone: a courier at the pass is seen from any tab of the board, in the bar (o3).
    !wide && segment !== 'ready' && atPass[0]
      ? {
          key: 'pass',
          testID: 'pass-chip',
          icon: 'bike',
          tone: firstPass?.kind === 'at_pass' && firstPass.tone === 'warning' ? 'warning' : 'success',
          label: t('merchant.pass.headline', { who: atPass[0].courier.firstName?.trim() || t('merchant.pass.courier'), number: atPass[0].number }),
          onPress: () => setSegment('ready'),
        }
      : null,
    !gateOpen && Platform.OS === 'web' && wake !== 'on' ? { key: 'wake', testID: 'wake-chip', icon: 'screen', tone: 'warning', label: t('merchant.wake.chip'), onPress: () => void requestWakeLock() } : null,
  ];
  const alerts = alertList.filter((x): x is HeaderAlert => x !== null);
  const menuItems: HeaderAlert[] = missed && missed.today > 0 ? [{ key: 'missed', testID: 'missed-chip', icon: 'bell', tone: missedNew.length > 0 ? 'danger' : 'neutral', dot: missedNew.length > 0, label: t('merchant.missed.chip', { count: missed.today }), onPress: () => setSheet('missed') }] : [];

  const todayKey = localDayKey(now);
  const dismissToday = () => {
    setDayOpen(false);
    if (daySummary.data) dismissDay(dayCardKey(daySummary.data.merchantOrgId, daySummary.data.localDate));
  };
  const dayCard = dayMode === 'full' && daySummary.data ? <DaySummaryCard summary={daySummary.data} todayKey={todayKey} wide={wide} onDismiss={dismissToday} /> : null;
  const dayLine = dayMode === 'line' && daySummary.data ? <DayLine summary={daySummary.data} todayKey={todayKey} wide={wide} onOpen={() => setDayOpen(true)} /> : null;
  const urgent = plan.mostUrgent;
  const summary = newOrderSummary(orders, plan.snoozed);
  const sticky = !wide && segment === 'new' ? now1.sticky : null;
  const all = acceptAllTargets(cols.new, [...plan.ringing, ...plan.snoozed], busyOn);
  // a1: the ribbon carries the next order to answer (tablet), never one waiting on the customer.
  const next = wide ? (cols.new.find((o) => o.partial === null && plan.ringing.includes(o.id)) ?? null) : null;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="board">
      <StoreHeader
        storeName={store?.name ?? ''}
        status={s}
        balance={balance.data}
        headline={cash.data?.headline}
        firstOrder={beforeFirstOrder(cash.data)}
        canSeeMoney={canSeeMoney}
        now={now}
        wide={wide}
        onToggleOpen={() => void toggleOpen()}
        onBusy={() => setSheet('busy')}
        onCash={() => setSheet('cash')}
        alerts={alerts}
        menuItems={menuItems}
        suggestBusy={suggestBusy(cols.new.length, busyOn) && Boolean(s?.open)}
        closeMenu={newRings}
      />
      {/* r1: busy mode you can't forget — a gold frame round the whole board while it is on. */}
      <View testID={busyOn ? 'busy-frame' : undefined} style={{ flex: 1, borderWidth: busyOn ? 5 : 0, borderTopWidth: 0, borderColor: COUNTER.busy }}>
      {waiting > 0 && !pausedNow ? (
        <NewOrderBanner
          count={plan.ringing.length}
          snoozedCount={plan.snoozed.length}
          stage={plan.stage}
          mostUrgent={urgent ? { number: urgent.number } : null}
          snoozeEndsAt={plan.snoozeEndsAt}
          soundBlocked={prefs.soundOn && !soundReady}
          onSnooze={() => alarm.snooze(clock())}
          onUnsnooze={() => alarm.unsnooze(clock())}
          onEnableSound={() => void soundOn()}
          compact={!wide}
          summary={summary}
          storeClosed={plan.closed.length > 0}
          featured={next ? { order: next, oneTapMinutes: oneTap.shown, busy: acceptingId === next.id, onAccept: () => void onAcceptNow(next), onOpen: () => setDetailId(next.id) } : null}
          acceptAll={all.targets.length > 0 ? { count: all.targets.length, minutes: oneTap.shown, busy: acceptingAll, onPress: () => void onAcceptAll(all.targets, all.skipped) } : null}
        />
      ) : null}
      {/* h5: offline it counts down to «متوقف للزباين»; back after a pause it says how long customers saw it closed. */}
      <PauseStrip online={online} view={pause} />
      {online ? <StaleStrip updatedAt={board.dataUpdatedAt || null} /> : null}
      {auto.on && !inSetup ? <AutoBusyStrip auto={auto} manualOn={busyOn} onMore={() => setSheet('busy')} /> : null}
      {inSetup ? null : s?.closed ? (
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
      {failed ? <InfoStrip tone="danger" testID="board-error" text={t('merchant.board.error')} action={{ label: t('merchant.menu.retry'), onPress: () => void board.refetch(), testID: 'board-error-retry' }} /> : null}
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

      {photoDowns[0] && cols.new.length === 0 && !pausedNow ? (
        <InfoStrip
          tone="warning"
          icon="camera"
          testID="photo-down-strip"
          text={photoDowns.length === 1 ? photoDownNotice(t, photoDowns[0].dishName, photoDowns[0].reason) : t('merchant.photo_down.notice_many', { count: photoDowns.length })}
          action={{
            label: photoDowns.length === 1 ? t('merchant.photo_down.take') : t('merchant.photo_down.see'),
            testID: 'photo-down-take',
            onPress: () => {
              const [first] = photoDowns;
              markPhotoSeen(photoDowns.map((n) => n.key));
              if (photoDowns.length === 1 && first) router.push({ pathname: '/menu/item', params: { id: first.itemId, photo: '1' } });
              else router.push('/menu');
            },
          }}
          secondary={{ label: t('merchant.photo_down.ok'), testID: 'photo-down-ok', onPress: () => markPhotoSeen(photoDowns.map((n) => n.key)) }}
        />
      ) : null}

      {wide ? (dayCard ?? dayLine) : null}

      {wide && inSetup && setupLine && storeId && orders.length === 0 && !failed ? (
        <View testID="board-setup-tablet" style={{ flex: 1, flexDirection: 'row', gap: theme.space[4], padding: theme.space[5] }}>
          <ScrollView style={{ width: 400, flexGrow: 0 }} contentContainerStyle={{ paddingBottom: theme.space[6] }} showsVerticalScrollIndicator={false}>
            <SetupBoardCard storeId={storeId} owner={canSeeMoney} line={setupLine} />
          </ScrollView>
          <SetupBoardWaiting line={setupLine} />
        </View>
      ) : wide ? (
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
                backgroundColor: c === 'new' ? COUNTER.laneNew : c === 'preparing' ? COUNTER.laneCooking : COUNTER.laneReady,
              }}
            >
              <View style={{ paddingHorizontal: theme.space[1] }}>
                <ColumnHeader column={c} count={cols[c].length} />
              </View>
              {c === 'preparing' ? <CookingTotals totals={totals} /> : null}
              <ScrollView
                ref={c === 'new' ? newScroll : undefined}
                style={{ flex: 1 }}
                contentContainerStyle={{ gap: c === 'new' && rush ? theme.space[3] : theme.space[5], paddingBottom: theme.space[6], paddingHorizontal: 3, paddingTop: 9 }}
                showsVerticalScrollIndicator={false}
              >
                {failed ? null : loading ? skeleton : cols[c].length === 0 ? <EmptyColumn column={c} /> : cols[c].map(card)}
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
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: theme.space[5], padding: theme.space[4], paddingBottom: theme.space[10] }}>
            {dayCard ? <View style={{ marginHorizontal: -theme.space[4], marginTop: -theme.space[4] }}>{dayCard}</View> : dayLine}
            {segment === 'preparing' && !loading && !failed ? <CookingTotals totals={totals} /> : null}
            {failed
              ? null
              : loading
              ? skeleton
              : cols[segment].length === 0
                ? segment === 'new' && inSetup && setupLine && storeId
                  ? <SetupBoardCard storeId={storeId} owner={canSeeMoney} line={setupLine} />
                  : <EmptyColumn column={segment} />
                : segment === 'new' && now1.first
                  ? [now1.first, ...now1.rest].map(card)
                  : cols[segment].map(card)}
          </ScrollView>
          {sticky ? (
            <StickyAcceptBar
              order={sticky}
              clock={clock}
              oneTapMinutes={oneTap.shown}
              busy={acceptingId === sticky.id}
              noRing={pausedNow}
              onAccept={() => void onAcceptNow(sticky)}
              onReject={() => onReject(sticky)}
              onOpen={() => setDetailId(sticky.id)}
            />
          ) : null}
        </View>
      )}
      </View>

      <AcceptSheet
        order={byId(acceptId)}
        storeId={storeId}
        onClose={closeAccept}
        startPartial={acceptPartial}
        busyMinutes={busyMinutes}
        prepKind={s?.prepKind ?? 'food'}
        usualPrepMinutes={s?.defaultPrepMinutes ?? 20}
        clock={clock}
        onAccepted={(o) => {
          if (prefs.autoPrint) queueAutoPrint(o.id);
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
      <OrderDetailSheet order={byId(detailId)} now={now} clock={clock} onClose={() => setDetailId(null)} onAccept={onAccept} onReject={onReject} onReady={(o) => void onReady(o)} onPrint={(o) => void print(o)} {...(canSeeMoney ? { who: whoLine } : {})} />
      {s ? <CloseStoreSheet status={s} visible={sheet === 'close'} lengths onClose={() => setSheet(null)} /> : null}
      {s ? <BusySheet status={s} visible={sheet === 'busy'} onClose={() => setSheet(null)} now={now} auto={auto} /> : null}
      <RemakeSheet
        order={remakeId ? byId(remakeId) : null}
        minutes={remakeOrder ? (remakeOffer(remakeOrder, remakeRule.data, now) ?? remakeRule.data?.afterReadyMin ?? 10) : 0}
        outcome={remakeId ? (remade[remakeId] ?? null) : null}
        busy={remake.isPending}
        onConfirm={() => void onRemake()}
        onClose={() => setRemakeId(null)}
      />
      {storeId ? <CashSheet merchantOrgId={storeId} balance={balance.data} visible={sheet === 'cash'} onClose={() => setSheet(null)} /> : null}
      <ModalSheet visible={sheet === 'missed'} onClose={closeMissed} title={t('merchant.missed.sheet_title')} testID="missed-sheet">
        {missedNew.length > 0 ? (
          <View testID="missed-new" style={{ gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.dangerTint }}>
            <Text variant="label" weight={700} color="dangerText">
              {missedText(t, missedNew)}
            </Text>
            {nudge && !busyOn ? (
              <>
                <Text variant="label" color="dangerText">
                  {t('merchant.missed.nudge')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                  <Button testID="missed-nudge-busy" label={t('merchant.missed.busy')} variant="secondary" size="md" onPress={() => { markSeen(missedNew.map((m) => m.orderId)); setSheet('busy'); }} />
                  <Button testID="missed-nudge-close" label={t('merchant.missed.close')} variant="secondary" size="md" onPress={() => { markSeen(missedNew.map((m) => m.orderId)); setSheet('close'); }} />
                </View>
              </>
            ) : null}
          </View>
        ) : null}
        {(missed?.orders ?? []).length === 0 ? (
          <Text variant="body" color="textMuted">
            {t('merchant.missed.sheet_empty')}
          </Text>
        ) : (
          (missed?.orders ?? []).map((m) => (
            <View key={m.orderId} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: m.reason === 'merchant_timeout' ? theme.colors.dangerTint : theme.colors.surfaceSunken }}>
              <Text weight={700} tabular style={{ fontSize: 20, lineHeight: 28 }}>{t('merchant.card.number', { number: m.number })}</Text>
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
      {daySummary.data ? (
        <ModalSheet visible={dayOpen && dayMode !== 'none'} onClose={() => setDayOpen(false)} title={t('merchant.day.sheet_title')} testID="day-sheet">
          <DaySummaryCard summary={daySummary.data} todayKey={todayKey} wide={false} bare onDismiss={dismissToday} />
        </ModalSheet>
      ) : null}
      {/* While the shop is being set up, setup's own counter list does the lesson and the sound. d09: the
          lesson waits for the first quiet moment; meanwhile the shift gate (one tap, the sound) shows. */}
      {inSetup ? null : storeId && lessonNow({ due: lessonDue, waiting: cols.new.length, boardLoaded: board.data !== undefined }) ? (
        <LearnCards onPractice={() => void finishLesson(true)} onDone={() => void finishLesson(false)} />
      ) : gateOpen && storeId ? (
        <ShiftGate waiting={waiting} soundOn={prefs.soundOn} printer={printerChipState(printerSnap, s?.printer.state)} onStart={beginShift} back={shift.back} online={online} />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * «آخر تحديث قبل 40 ث» when the live channel is down and the board is getting old. Its own part, so
 * the per-second "ago" count re-draws this strip only, never the board (h3).
 */
function StaleStrip({ updatedAt }: { updatedAt: number | null }) {
  const t = useT();
  const conn = useConnectionBanner({ live: useLiveMode(LIVE_MERCHANT_KEY), updatedAt });
  if (conn.kind !== 'stale') return null;
  return <InfoStrip tone="warning" text={t('merchant.board.stale', { ago: agoText(conn.ageSeconds ?? 0, t) })} testID="stale-strip" />;
}
