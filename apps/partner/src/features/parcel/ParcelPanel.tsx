import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PARCEL_RULES, type CourierParcelView, type PartnerJobStop } from '@driver/contracts';
import { Button, Icon, LocalPhoto, PhotoImage, RetryState, retryKindFor, Skeleton, Text, useNetwork, useTheme, useToast, type IconName } from '@driver/ui';
import { absoluteUrl, pickPhoto, uploadPhoto, type PickedPhoto } from '@/features/account/photo';
import { PinPad } from '@/features/intercity/DepartureParts';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { parcelStage, pinComplete, typePin, type PickupPhotoState } from './logic';
import { useCourierParcel, useParcelActions, useRefusalPreview } from './queries';

/**
 * طرود on the courier's job (loaded only on a parcel job, through `JobKindPanel`): what it is and who
 * pays, the pickup photo at the sender's, and at the receiver's door the receipt code (the server checks
 * it; the drop-off completes only once it is right) with «رفضت تستلم» under it. The drop-off photo and
 * the cash are the normal hand-over's (the main button at the bottom), which follows a verified code.
 */
export default function ParcelPanel({ orderId, stop }: { orderId: string | null; stop: PartnerJobStop | null }) {
  const theme = useTheme();
  const t = useT();
  const net = useNetwork();
  const q = useCourierParcel(orderId);

  if (!q.data) {
    if (q.isError) {
      return <RetryState size="inline" kind={retryKindFor({ net, error: q.error })} title={t('parcel.k_load_error')} onRetry={() => void q.refetch()} testID="parcel-retry" />;
    }
    return (
      <View testID="parcel-loading">
        <Skeleton lines={3} />
      </View>
    );
  }
  const view = q.data;
  const stage = parcelStage(view, stop);
  const atDoor = stage === 'to_door' || stage === 'pin' || stage === 'verified' || stage === 'locked';
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} testID="parcel-panel" style={{ gap: theme.space[3] }}>
      <ParcelCard view={view} />
      {atDoor ? <PayLine view={view} /> : null}
      {stage === 'pickup' && orderId ? <PickupPhoto orderId={orderId} onParcel={view.pickupPhoto === true} /> : null}
      {stage === 'to_door' ? <Note testID="parcel-pin-at-door" icon="lock" title={t('parcel.k_pin_at_door')} bg={theme.colors.accentTint} ink={theme.colors.accentText} /> : null}
      {stage === 'pin' && orderId ? <PinStep orderId={orderId} view={view} /> : null}
      {stage === 'verified' ? <Note testID="parcel-pin-verified" icon="check" title={t('parcel.pin_verified')} body={t('parcel.k_verified_sub')} bg={theme.colors.successTint} ink={theme.colors.successText} /> : null}
      {stage === 'locked' ? (
        <Note testID="parcel-pin-locked" icon="lock" title={t('parcel.k_locked_title')} body={t('parcel.k_locked_body', { n: PARCEL_RULES.pinTries })} bg={theme.colors.dangerTint} ink={theme.colors.dangerText} />
      ) : null}
      {(stage === 'pin' || stage === 'locked') && orderId ? <RefuseStep orderId={orderId} /> : null}
      {stage === 'refused' ? <Returning /> : null}
    </Animated.View>
  );
}

/** The parcel itself: the sender's photo, the words on the tag, its size and value, and whom it is for. */
function ParcelCard({ view }: { view: CourierParcelView }) {
  const theme = useTheme();
  const t = useT();
  const [broken, setBroken] = useState(false);
  const size = view.size === 'large' ? t('parcel.size_large') : view.size === 'medium' ? t('parcel.size_medium') : t('parcel.size_small');
  return (
    <View testID="parcel-card" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
      {view.photoUrl && !broken ? (
        <PhotoImage uri={absoluteUrl(view.photoUrl)} onError={() => setBroken(true)} accessibilityLabel={view.what} style={{ width: 64, height: 64, borderRadius: theme.radius.lg }} testID="parcel-photo" />
      ) : (
        <View style={{ width: 64, height: 64, borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="parcel" size={28} color="accentText" strokeWidth={2} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" color="textMuted">
          {t('parcel.k_title')}
        </Text>
        <Text variant="label" weight={700} testID="parcel-what">
          {view.what}
        </Text>
        <Text variant="caption" color="textMuted" tabular>
          {`${size} · ${t('parcel.k_value', { amount: amountParam(view.declaredValueIqd) })}`}
        </Text>
        {view.receiverName ? (
          <Text variant="caption" weight={600} color="text">
            {t('parcel.k_for', { name: view.receiverName })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Who pays, at the door: the cash to take from the receiver, or «الأجرة مدفوعة». */
function PayLine({ view }: { view: CourierParcelView }) {
  const theme = useTheme();
  const t = useT();
  return view.collectAtDoorIqd > 0 ? (
    <Note testID="parcel-collect" icon="cash" title={t('parcel.k_collect', { amount: amountParam(view.collectAtDoorIqd) })} body={t('parcel.k_collect_sub')} bg={theme.colors.warningTint} ink={theme.colors.warningText} />
  ) : (
    <Note testID="parcel-paid" icon="check" title={t('parcel.k_paid')} body={t('parcel.k_paid_sub')} bg={theme.colors.surfaceSunken} ink={theme.colors.text} />
  );
}

/** Pickup photos taken on this phone, by order: the panel remounts between stops and keeps them. */
const PICKUP_PHOTOS = new Map<string, PickupPhotoState>();

/**
 * «صوّر الطرد عند الاستلام»: the camera (the photo library where there is none), then the upload. A failed
 * upload or a failed save on the parcel (`parcels.courier.pickupPhoto`) says so and offers a retry; it never
 * holds up the job.
 */
function PickupPhoto({ orderId, onParcel }: { orderId: string; onParcel: boolean }) {
  const theme = useTheme();
  const client = useApiClient();
  const t = useT();
  const actions = useParcelActions(orderId);
  // Seeded from the server: a photo already on the parcel shows as saved (even from another phone).
  const [state, setStateRaw] = useState<PickupPhotoState>(PICKUP_PHOTOS.get(orderId) ?? (onParcel ? { kind: 'saved', photo: null } : { kind: 'none' }));
  const [denied, setDenied] = useState(false);
  const setState = (s: PickupPhotoState) => {
    PICKUP_PHOTOS.set(orderId, s);
    setStateRaw(s);
  };
  /** Upload (unless already uploaded), then save it on the parcel; either failing offers the same retry. */
  const upload = async (photo: PickedPhoto, uploaded?: string) => {
    setState({ kind: 'uploading', photo });
    let uploadId = uploaded;
    try {
      uploadId ??= await uploadPhoto(photo, (input) => client.places.photoUpload.mutate(input));
      await actions.pickupPhoto.mutateAsync({ orderId, uploadId });
      setState({ kind: 'saved', photo });
      theme.haptic('success');
    } catch {
      setState({ kind: 'failed', photo, ...(uploadId ? { uploadId } : {}) });
      theme.haptic('warning');
    }
  };
  // The camera; where there is none (a desktop browser), the photo library — as the hand-over photo.
  const take = async () => {
    setDenied(false);
    const shot = await pickPhoto('camera').catch(() => null);
    const got = shot && shot !== 'denied' ? shot : await pickPhoto('library').catch(() => null);
    if (!got || got === 'denied') {
      if (shot === 'denied' || got === 'denied') setDenied(true);
      return;
    }
    await upload(got);
  };

  return (
    <View testID="parcel-pickup-photo" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surfaceSunken }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        {state.kind === 'none' || !state.photo ? (
          <View style={{ width: 56, height: 56, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={24} color="text" strokeWidth={2} />
          </View>
        ) : (
          <LocalPhoto source={{ uri: state.photo.uri }} eager style={{ width: 56, height: 56, borderRadius: theme.radius.lg }} testID="parcel-pickup-thumb" />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700}>
            {t('parcel.pickup_photo')}
          </Text>
          {state.kind === 'none' ? (
            <Text variant="caption" color="textMuted">
              {t('parcel.k_photo_hint')}
            </Text>
          ) : state.kind === 'uploading' ? (
            <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite" testID="parcel-photo-uploading">
              {t('parcel.k_photo_uploading')}
            </Text>
          ) : state.kind === 'saved' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityLiveRegion="polite" testID="parcel-photo-saved">
              <Icon name="check" size={16} color="successText" strokeWidth={2.6} />
              <Text variant="caption" weight={600} color="successText">
                {t('parcel.k_photo_saved')}
              </Text>
            </View>
          ) : (
            <Text variant="caption" weight={600} color="dangerText" accessibilityLiveRegion="assertive" testID="parcel-photo-failed">
              {t('parcel.k_photo_failed')}
            </Text>
          )}
        </View>
      </View>
      {state.kind === 'failed' ? (
        <View style={{ gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.dangerTint }}>
          <Text variant="caption" color="dangerText">
            {t('parcel.k_photo_failed_sub')}
          </Text>
          <Button testID="parcel-photo-retry" label={t('action.retry')} icon="refresh" variant="secondary" size="md" fullWidth onPress={() => void upload(state.photo, state.uploadId)} />
        </View>
      ) : null}
      {denied ? (
        <Text variant="caption" color="dangerText" testID="parcel-photo-denied">
          {t('parcel.k_photo_denied')}
        </Text>
      ) : null}
      {state.kind === 'none' ? (
        <Button testID="parcel-photo-take" label={t('parcel.pickup_photo')} icon="camera" variant="ink" size="md" fullWidth onPress={() => void take()} />
      ) : state.kind !== 'uploading' ? (
        <Button testID="parcel-photo-retake" label={t('parcel.k_photo_retake')} icon="camera" variant="ghost" size="md" fullWidth onPress={() => void take()} />
      ) : null}
    </View>
  );
}

/**
 * «رمز الاستلام» at the door, on the الرجعة seat-PIN pad (four boxes left to right, the 4th digit sends).
 * Wrong: «الرمز غلط» with the tries left; out of tries the panel shows the locked note instead.
 */
function PinStep({ orderId, view }: { orderId: string; view: CourierParcelView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const actions = useParcelActions(orderId);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const busy = actions.checkPin.isPending;
  const offline = !net.online;

  const submit = (code: string) => {
    actions.checkPin.mutate(
      { orderId, pin: code },
      {
        onSuccess: (next) => {
          setPin('');
          if (next.pinVerified) theme.haptic('success');
          else {
            theme.haptic('error');
            setWrong(true);
          }
        },
        onError: (err) => {
          setPin('');
          if (apiErrorCode(err) === 'parcel_pin_locked') void actions.refetch();
          else toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
        },
      },
    );
  };
  const press = (key: string) => {
    if (busy || offline) return;
    const next = typePin(pin, key);
    setPin(next);
    if (next.length > 0) setWrong(false);
    if (pinComplete(next) && next !== pin) submit(next);
  };

  return (
    <View testID="parcel-pin" style={{ gap: theme.space[3], paddingTop: theme.space[2] }}>
      <View style={{ gap: 2 }}>
        <Text variant="title" accessibilityRole="header">
          {t('parcel.pin_title')}
        </Text>
        <Text variant="label" color="textMuted">
          {t('parcel.k_pin_hint')}
        </Text>
      </View>
      {offline ? <Note testID="parcel-pin-offline" icon="wifi-off" title={t('parcel.k_pin_offline')} bg={theme.colors.warningTint} ink={theme.colors.warningText} /> : null}
      {wrong && !offline ? (
        <View testID="parcel-pin-wrong" accessibilityLiveRegion="assertive" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.dangerTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <Icon name="x" size={18} color="dangerText" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={700} color="dangerText">
              {t('parcel.pin_wrong')}
            </Text>
            <Text variant="caption" color="dangerText" tabular>
              {t('parcel.k_tries_left', { n: view.pinTriesLeft })}
            </Text>
          </View>
        </View>
      ) : null}
      <PinPad pin={pin} onKey={press} busy={busy || offline} error={wrong} />
      {busy ? (
        <Text variant="caption" color="textMuted" align="center" accessibilityLiveRegion="polite" testID="parcel-pin-checking">
          {t('parcel.k_checking')}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * «رفضت تستلم», under the code: a second confirmation that says plainly who pays for the trip back and
 * how much (the server's figures). The server records it only at the door (150 m).
 */
function RefuseStep({ orderId }: { orderId: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const [asking, setAsking] = useState(false);
  const preview = useRefusalPreview(orderId, asking);
  const actions = useParcelActions(orderId);
  const [problem, setProblem] = useState<string | null>(null);

  const refuse = () => {
    setProblem(null);
    actions.refuse.mutate(
      { orderId },
      {
        onSuccess: () => theme.haptic('warning'),
        onError: (err) => {
          theme.haptic('error');
          setProblem(apiErrorMessage(err, t('error.network'), locale));
        },
      },
    );
  };

  if (!asking) {
    return (
      <Pressable
        testID="parcel-refuse"
        accessibilityRole="button"
        onPress={() => setAsking(true)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56, paddingHorizontal: theme.space[3], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface })}
      >
        <Icon name="swap" size={20} color="dangerText" strokeWidth={2.2} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700} color="dangerText">
            {t('parcel.k_refuse')}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('parcel.k_refuse_sub')}
          </Text>
        </View>
        <Icon name="chevron-forward" size={18} color="textMuted" strokeWidth={2.2} />
      </Pressable>
    );
  }

  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(160)} testID="parcel-refuse-confirm" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, borderWidth: 1.5, borderColor: theme.colors.danger, backgroundColor: theme.colors.surface }}>
      <Text variant="title" accessibilityRole="header">
        {t('parcel.k_refuse_title')}
      </Text>
      {preview.data ? (
        <Text variant="body" weight={600} tabular testID="parcel-refuse-amounts">
          {t('parcel.k_refuse_body', { amount: amountParam(preview.data.returnFareIqd), total: amountParam(preview.data.totalForSenderIqd) })}
        </Text>
      ) : preview.isError ? (
        <RetryState size="inline" kind={retryKindFor({ net, error: preview.error })} onRetry={() => void preview.refetch()} testID="parcel-refuse-retry" />
      ) : (
        <Skeleton lines={2} />
      )}
      {!net.online ? <Note testID="parcel-refuse-offline" icon="wifi-off" title={t('net.needs_internet')} bg={theme.colors.warningTint} ink={theme.colors.warningText} /> : null}
      {problem ? <Note testID="parcel-refuse-problem" icon="map-pin" title={problem} bg={theme.colors.dangerTint} ink={theme.colors.dangerText} /> : null}
      <View style={{ gap: theme.space[2] }}>
        <Button testID="parcel-refuse-yes" label={t('parcel.k_refuse_yes')} variant="destructive" size="lg" fullWidth loading={actions.refuse.isPending} disabled={!preview.data || !net.online} haptic="medium" onPress={refuse} />
        <Button
          testID="parcel-refuse-no"
          label={t('parcel.k_refuse_no')}
          variant="secondary"
          size="lg"
          fullWidth
          disabled={actions.refuse.isPending}
          onPress={() => {
            setAsking(false);
            setProblem(null);
          }}
        />
      </View>
    </Animated.View>
  );
}

/** After «رفضت تستلم»: it goes back to the sender (the trip back itself is the orders module's, still to come). */
function Returning() {
  const theme = useTheme();
  const t = useT();
  // By day a dark ink card; at night a raised card instead of a cream block that glares (as the door money card).
  const night = theme.scheme === 'dark';
  const ink = night ? theme.colors.text : theme.colors.bg;
  return (
    <View
      testID="parcel-returning"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: night ? theme.colors.surface : theme.colors.text, ...(night ? { borderWidth: 1.5, borderColor: theme.colors.border } : {}) }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="swap" size={22} color={theme.colors.onAccent} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title" color={ink}>
          {t('parcel.k_returning_title')}
        </Text>
        <Text variant="caption" color={ink}>
          {t('parcel.k_returning_body')}
        </Text>
      </View>
    </View>
  );
}

/** A one-line note in the job's style (icon, bold line, optional second line). */
function Note({ testID, icon, title, body, bg, ink }: { testID: string; icon: IconName; title: string; body?: string; bg: string; ink: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 48, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: bg }}>
      <Icon name={icon} size={20} color={ink} strokeWidth={2.3} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={700} style={{ color: ink }} tabular>
          {title}
        </Text>
        {body ? (
          <Text variant="caption" color="textMuted" tabular>
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
