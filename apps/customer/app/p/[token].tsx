import { Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LatLng, ParcelDoorPage } from '@driver/contracts';
import { color } from '@driver/design-tokens';
import { Button, EmptyState, Icon, RetryState, retryKindFor, Skeleton, Text, TextField, useLoadTimeout, useNetwork, useTheme, useToast, withAlpha } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { currentFix, locationDeniedToast, locationWeakToast } from '@/features/account/device';
import { westernDigits } from '@/features/parcel/logic';
import { parcelSwatch } from '@/features/parcel/palette';
import { ApiPhoto, Note } from '@/features/parcel/Parts';
import { useDoorPage, useSetDoor } from '@/features/parcel/queries';
import { PinPicker } from '@/features/places/PinPicker';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { publicPageFailure } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { zoneName } from '@/lib/profile';

const NOTE_MAX = 200;

/**
 * The receiver's page (`/p/<token>`, no sign-in; concept A2, Ali 2026-10-12): opened from the text message,
 * it is the first thing a non-user sees of us. Who sent it (first name only), what it is and its photo,
 * whether the fare is paid or what to pay at the door, and the day map on their area to mark the door: a
 * saffron pin in a cream ring, the map moving under it. A short note for the courier is optional. Once set:
 * «الدليفري جاي». Never a phone number, never anyone's exact pin; a link that ended says so calmly.
 */
export default function ReceiverDoorPage() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const q = useDoorPage(token);
  const net = useNetwork();
  const [slow, restartSlow] = useLoadTimeout(q.isPending);
  const page = q.data;
  const failure = q.isError ? publicPageFailure(q.error) : null;
  const closedByServer = q.isError && (apiErrorCode(q.error) === 'parcel_door_closed' || failure === 'invalid');

  const shell = (children: ReactNode, testID: string) => (
    <View testID={testID} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false, title: t('parcel.c_door_title_anon') }} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center', padding: theme.space[5], paddingTop: theme.space[10], gap: theme.space[6] }}>
        <Wordmark size="md" />
        {children}
      </ScrollView>
    </View>
  );

  if (closedByServer || (page && !page.open && !page.doorSet)) {
    return shell(
      <View testID="door-closed">
        <EmptyState icon="parcel" title={t('parcel.c_door_closed_title')} body={t('parcel.c_door_closed_body')} />
      </View>,
      'door-closed-page',
    );
  }
  if (!page) {
    return shell(
      failure || slow ? (
        failure === 'final' ? (
          <EmptyState icon="x" title={apiErrorMessage(q.error, t('error.network'), locale)} />
        ) : (
          <RetryState
            kind={retryKindFor({ net, error: q.isError ? q.error : undefined, slow: !q.isError })}
            locale={locale}
            testID="door-retry"
            onRetry={() => {
              restartSlow();
              void q.refetch();
            }}
          />
        )
      ) : (
        <View style={{ gap: theme.space[3] }} testID="door-loading">
          <Skeleton height={88} radius={20} />
          <Skeleton height={280} radius={28} />
          <Skeleton width="60%" height={24} />
        </View>
      ),
      'door-pending',
    );
  }
  if (page.doorSet) return shell(<DoorDone page={page} />, 'door-done-page');
  return <SetDoor token={token} page={page} />;
}

/** Who sent what, the photo and the fare: the card at the top of the page. */
function SenderCard({ page, floating }: { page: ParcelDoorPage; floating?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const sw = parcelSwatch(theme);
  const fare = page.payAtDoorIqd ? t('parcel.c_door_pay', { amount: amountParam(page.payAtDoorIqd) }) : t('parcel.c_door_paid');
  return (
    <View
      testID="door-sender"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        paddingStart: theme.space[4],
        borderRadius: theme.radius['2xl'],
        backgroundColor: theme.colors.surface,
        borderWidth: floating ? 0 : 1,
        borderColor: theme.colors.border,
        shadowColor: color.neutral[1000],
        shadowOpacity: floating ? 0.14 : 0,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: floating ? 6 : 0,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="title" numberOfLines={2}>
          {page.senderName ? t('parcel.c_door_title', { name: page.senderName }) : t('parcel.c_door_title_anon')}
        </Text>
        <Text variant="label" color="textMuted" numberOfLines={2}>
          {`${page.what} · `}
          <Text variant="label" weight={700} color={page.payAtDoorIqd ? sw.text : 'successText'} testID="door-fare">
            {fare}
          </Text>
        </Text>
      </View>
      {page.photoUrl ? (
        <View style={{ width: 72, height: 72, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
          <ApiPhoto url={page.photoUrl} label={t('parcel.c_photo_item')} style={{ width: '100%', height: '100%' }} testID="door-photo" />
        </View>
      ) : (
        <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: sw.wash }}>
          <Icon name="parcel" size={26} color={sw.text} />
        </View>
      )}
    </View>
  );
}

function SetDoor({ token, page }: { token: string; page: ParcelDoorPage }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const setDoor = useSetDoor(token);
  const net = useNetwork();
  const [pin, setPin] = useState<LatLng>(page.zone.centre);
  const [moving, setMoving] = useState(false);
  const [recentre, setRecentre] = useState<{ pin: LatLng; seq: number; accuracyM?: number } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const known = zoneName(page.zone.key, locale);
  const areaName = known === page.zone.key ? westernDigits(page.zone.name) : known;

  const locate = async () => {
    setLocating(true);
    const fix = await currentFix();
    setLocating(false);
    if (fix === 'denied') toast.show({ ...locationDeniedToast(t), placement: 'top' });
    else if (!fix) toast.show({ ...locationWeakToast(t), placement: 'top' });
    else setRecentre((r) => ({ pin: fix.pin, seq: (r?.seq ?? 0) + 1, ...(fix.accuracyM !== null ? { accuracyM: fix.accuracyM } : {}) }));
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await setDoor({ pin, ...(note.trim() ? { doorNote: note.trim().slice(0, NOTE_MAX) } : {}) });
      theme.haptic('success');
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger', placement: 'top' }, 7000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="door-page" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false, title: t('parcel.c_door_title_anon') }} />
      <View style={{ flex: 1, minHeight: 300 }}>
        <PinPicker initial={page.zone.centre} onCentre={setPin} onMoving={setMoving} recentre={recentre} testID="door-map" />
        <View style={{ position: 'absolute', top: insets.top + theme.space[3], start: theme.space[4], end: theme.space[4], alignItems: 'center', gap: theme.space[3] }} pointerEvents="box-none">
          <View style={{ width: '100%', maxWidth: 520 }}>
            <SenderCard page={page} floating />
          </View>
          <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.delay(300).duration(240)} pointerEvents="none" style={{ paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: withAlpha(theme.colors.inverse, 0.86) }}>
            <Text variant="caption" weight={600} color="onInverse" align="center">
              {t('parcel.c_door_map_hint')}
            </Text>
          </Animated.View>
        </View>
      </View>
      <View
        style={{
          marginTop: -24,
          backgroundColor: theme.colors.surfaceRaised,
          borderTopLeftRadius: theme.radius['2xl'],
          borderTopRightRadius: theme.radius['2xl'],
          paddingTop: theme.space[5],
          paddingHorizontal: theme.space[5],
          paddingBottom: Math.max(insets.bottom, theme.space[5]),
        }}
      >
        <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', gap: theme.space[3] }}>
          <View style={{ gap: theme.space[1] }}>
            <Text variant="heading" accessibilityRole="header">
              {t('parcel.c_door_question')}
            </Text>
            <Text variant="footnote" color="textMuted">
              {`${t('parcel.c_door_area', { area: areaName })} · ${t('parcel.c_door_question_body')}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <Button label={t('parcel.c_door_locate')} icon="location-arrow" variant="secondary" size="sm" loading={locating} onPress={() => void locate()} testID="door-locate" style={{ minHeight: 44 }} />
          </View>
          <TextField testID="door-note" value={note} onChangeText={setNote} placeholder={t('parcel.c_door_note')} leadingIcon="chat" maxLength={NOTE_MAX} />
          <Button
            label={busy ? t('parcel.c_door_setting') : t('parcel.c_door_set')}
            icon="check"
            size="lg"
            fullWidth
            loading={busy}
            disabled={moving || !net.online}
            onPress={() => void confirm()}
            testID="door-set"
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2] }}>
            <Icon name="shield" size={14} color="textMuted" />
            <Text variant="caption" color="textMuted" style={{ flexShrink: 1 }}>
              {t('parcel.c_door_no_app')}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/** After the door is set: «الدليفري جاي», then «بالطريق إلك» once he has it. */
function DoorDone({ page }: { page: ParcelDoorPage }) {
  const theme = useTheme();
  const t = useT();
  const sw = parcelSwatch(theme);
  const onTheWay = page.state === 'on_the_way';
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.duration(320)} style={{ gap: theme.space[5] }} testID="door-done">
      <View style={{ alignItems: 'center', gap: theme.space[4], paddingVertical: theme.space[4] }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: sw.fill }}>
          <Icon name={onTheWay ? 'bike' : 'check'} size={40} color={sw.on} strokeWidth={2.4} />
        </View>
        <Text variant="display" align="center" accessibilityRole="header" style={{ fontSize: 28, lineHeight: 42 }}>
          {onTheWay ? t('parcel.c_door_on_the_way') : t('parcel.c_door_done_title')}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {t('parcel.c_door_done_body')}
        </Text>
      </View>
      <SenderCard page={page} />
      <Note icon="shield">{t('parcel.c_door_privacy')}</Note>
      <Text variant="caption" color="textMuted" align="center">
        {t('share.footer')}
      </Text>
    </Animated.View>
  );
}
