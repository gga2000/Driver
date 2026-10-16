import { useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { MENU_PHOTO_RULES, type MenuPhotoDish, type MenuPhotoRequestView } from '@driver/contracts';
import { Button, EmptyState, Skeleton, Text, TextField, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { Page } from '@/components/Page';
import { Glyph } from '@/features/menu/Glyph';
import { ChoiceTile, Panel, PanelTitle, Pill, Thumb } from '@/features/menu/parts';
import { absoluteUrl } from '@/features/menu/photo';
import { useMenu } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useDates } from '@/lib/dates';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { canCancel, canSubmit, EMPTY_DRAFT, menuDishes, shotDishes, splitRequests, STATUS_STEPS, stepIndex, toggleDish, toRequestInput, waitingDishes, withNote, type RequestDraft } from './logic';
import { useMenuPhotoActions, useMenuPhotoRequests } from './queries';

/** Note box height: about three lines. */
const NOTE_HEIGHT = 88;
/** The new photo next to today's: big enough to judge the light and the plate on a phone. */
const SHOT_SIZE = 132;
const STEP_KEY: Record<(typeof STATUS_STEPS)[number], TKey> = {
  requested: 'merchant.menu_photos.step_requested',
  scheduled: 'merchant.menu_photos.step_scheduled',
  shot: 'merchant.menu_photos.step_shot',
  done: 'merchant.menu_photos.step_done',
};
const STATE_KEY: Record<MenuPhotoRequestView['state'], TKey> = { ...STEP_KEY, cancelled: 'merchant.menu_photos.state_cancelled' };

/**
 * «تصوير المنيو» (maps program k3): the owner asks Driver's field team to photograph some dishes or
 * the whole menu, follows the request (طلبنا · موعد التصوير · تصوّرت · خلص), then accepts or rejects
 * each photo. An accepted photo becomes the dish's photo at once; a rejected one is deleted and the
 * dish keeps what it had. Staff see everything read only.
 */
export function MenuPhotosScreen() {
  const theme = useTheme();
  const t = useT();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const list = useMenuPhotoRequests(storeId);

  if (!list.data) {
    return (
      <Page title={t('merchant.menu_photos.title')} back testID="menu-photos" maxWidth={760}>
        {list.isError ? (
          <EmptyState icon="x" title={t('merchant.menu_photos.load_failed')} action={{ label: t('merchant.menu.retry'), onPress: () => void list.refetch() }} />
        ) : (
          <View style={{ gap: theme.space[4] }}>
            <Skeleton height={160} radius={theme.radius.xl} />
            <Skeleton height={240} radius={theme.radius.xl} />
          </View>
        )}
      </Page>
    );
  }

  const { current, past } = splitRequests(list.data);
  const owner = store?.role === 'owner';

  return (
    <Page title={t('merchant.menu_photos.title')} back testID="menu-photos" maxWidth={760}>
      <Text variant="body" color="textMuted">
        {t('merchant.menu_photos.intro')}
      </Text>
      {!owner ? (
        <View testID="menu-photos-read-only" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.infoTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <Glyph name="info" size={20} color="textMuted" strokeWidth={2} />
          <Text variant="label" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.menu_photos.read_only')}
          </Text>
        </View>
      ) : null}
      {current ? <CurrentRequest view={current} /> : owner && storeId ? <RequestForm storeId={storeId} /> : <EmptyState icon="clock" title={t('merchant.menu_photos.none_staff')} />}
      {past.length > 0 ? <PastRequests list={past} /> : null}
    </Page>
  );
}

function StatusSteps({ view }: { view: MenuPhotoRequestView }) {
  const theme = useTheme();
  const t = useT();
  const at = stepIndex(view.state);
  return (
    <View testID="menu-photos-steps" style={{ flexDirection: 'row', gap: theme.space[2] }}>
      {STATUS_STEPS.map((s, i) => {
        const reached = at !== null && i <= at;
        return (
          <View key={s} style={{ flex: 1, gap: theme.space[1] }} accessibilityState={{ selected: i === at }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: reached ? theme.colors.accent : theme.colors.surfaceSunken }} />
            <Text variant="caption" weight={i === at ? 700 : 400} color={reached ? 'text' : 'textMuted'} numberOfLines={1}>
              {t(STEP_KEY[s])}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function CurrentRequest({ view }: { view: MenuPhotoRequestView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const dates = useDates();
  const { cancel } = useMenuPhotoActions();
  const now = Date.now();
  const waiting = waitingDishes(view);
  const reviewed = shotDishes(view);

  const callOff = async () => {
    try {
      await cancel.mutateAsync({ merchantOrgId: view.merchantOrgId, requestId: view.requestId });
      toast.show({ message: t('merchant.menu_photos.cancelled'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  const visit = view.scheduledFor
    ? view.photographerName
      ? t('merchant.menu_photos.visit_named', { name: view.photographerName, when: dates.when(view.scheduledFor, now) })
      : t('merchant.menu_photos.visit', { when: dates.when(view.scheduledFor, now) })
    : t('merchant.menu_photos.visit_pending');

  return (
    <>
      <Panel testID="menu-photos-current">
        <PanelTitle glyph="camera" title={t('merchant.menu_photos.current')} hint={t('merchant.menu_photos.requested_on', { when: dates.when(view.requestedAt, now) })} />
        <StatusSteps view={view} />
        <View style={{ gap: theme.space[2] }}>
          <InfoLine glyph="utensils" text={view.wholeMenu ? t('merchant.menu_photos.dishes_all', { count: view.counts.dishes }) : t('merchant.menu_photos.dishes', { count: view.counts.dishes })} />
          {view.state === 'shot' ? null : <InfoLine glyph="clock" text={visit} />}
          {view.state === 'shot' ? <InfoLine glyph="camera" text={t('merchant.menu_photos.waiting', { count: waiting.length })} /> : null}
          {view.note ? <InfoLine glyph="note" text={view.note} /> : null}
        </View>
        {canCancel(view) ? (
          <Button testID="menu-photos-cancel" variant="ghost" label={t('merchant.menu_photos.cancel')} loading={cancel.isPending} onPress={() => void callOff()} />
        ) : null}
      </Panel>
      {reviewed.length > 0 && view.state === 'shot' ? <Review view={view} dishes={reviewed} /> : null}
    </>
  );
}

function InfoLine({ glyph, text }: { glyph: 'utensils' | 'clock' | 'camera' | 'note'; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <Glyph name={glyph} size={18} color="textMuted" strokeWidth={2} />
      <Text variant="body" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function Review({ view, dishes }: { view: MenuPhotoRequestView; dishes: MenuPhotoDish[] }) {
  const t = useT();
  return (
    <Panel testID="menu-photos-review">
      <PanelTitle glyph="photo" title={t('merchant.menu_photos.review')} hint={view.canAct ? t('merchant.menu_photos.review_hint') : t('merchant.menu_photos.review_staff')} />
      {dishes.map((d) => (
        <ShotRow key={d.itemId} view={view} dish={d} />
      ))}
    </Panel>
  );
}

function ShotRow({ view, dish }: { view: MenuPhotoRequestView; dish: MenuPhotoDish }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { decide } = useMenuPhotoActions();
  const shot = dish.shot;
  if (!shot) return null;

  const answer = async (accept: boolean) => {
    try {
      await decide.mutateAsync({ merchantOrgId: view.merchantOrgId, requestId: view.requestId, shotId: shot.shotId, accept });
      toast.show({ message: accept ? t('merchant.menu_photos.accepted_toast', { name: dish.nameAr }) : t('merchant.menu_photos.rejected_toast'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  return (
    <View testID={`menu-photos-shot-${dish.itemId}`} style={{ gap: theme.space[3], paddingTop: theme.space[3], borderTopWidth: 1, borderTopColor: theme.colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2] }}>
        <Text variant="bodyStrong" numberOfLines={2} style={{ flex: 1 }}>
          {dish.nameAr}
        </Text>
        {shot.state === 'accepted' ? <Pill tone="success" glyph="check" label={t('merchant.menu_photos.shot_accepted')} size="sm" /> : null}
        {shot.state === 'rejected' ? <Pill tone="neutral" glyph="x" label={t('merchant.menu_photos.shot_rejected')} size="sm" /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space[3] }}>
        <View style={{ gap: theme.space[1], alignItems: 'center' }}>
          <Thumb url={dish.currentPhotoUrl} name={dish.nameAr} size={72} dim />
          <Text variant="caption" color="textMuted">
            {t('merchant.menu_photos.today')}
          </Text>
        </View>
        {/* Today's photo → the new one; `arrow-forward` is mirrored in RTL, so it points at the new photo. */}
        <Glyph name="arrow-forward" size={20} color="textMuted" strokeWidth={2} />
        <View style={{ gap: theme.space[1], alignItems: 'center' }}>
          <Image
            source={{ uri: absoluteUrl(shot.photoUrl) }}
            style={{ width: SHOT_SIZE, height: SHOT_SIZE, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}
            contentFit="cover"
            accessibilityLabel={t('merchant.menu_photos.new_photo_alt', { name: dish.nameAr })}
            accessibilityIgnoresInvertColors
          />
          <Text variant="caption" color="textMuted">
            {t('merchant.menu_photos.new_photo')}
          </Text>
        </View>
      </View>
      {shot.state === 'proposed' && view.canAct ? (
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <Button testID={`menu-photos-accept-${dish.itemId}`} label={t('merchant.menu_photos.accept')} disabled={decide.isPending} onPress={() => void answer(true)} style={{ flex: 1 }} />
          <Button testID={`menu-photos-reject-${dish.itemId}`} variant="secondary" label={t('merchant.menu_photos.reject')} disabled={decide.isPending} onPress={() => void answer(false)} style={{ flex: 1 }} />
        </View>
      ) : null}
    </View>
  );
}

function RequestForm({ storeId }: { storeId: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const menu = useMenu(storeId);
  const { request } = useMenuPhotoActions();
  const [draft, setDraft] = useState<RequestDraft>(EMPTY_DRAFT);
  const dishes = menuDishes(menu.data);

  const submit = async () => {
    try {
      await request.mutateAsync(toRequestInput(storeId, draft));
      setDraft(EMPTY_DRAFT);
      toast.show({ message: t('merchant.menu_photos.requested_toast'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  return (
    <Panel testID="menu-photos-form">
      <PanelTitle glyph="camera" title={t('merchant.menu_photos.ask_title')} hint={t('merchant.menu_photos.ask_hint')} />
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <ChoiceTile testID="menu-photos-whole" selected={draft.wholeMenu} onPress={() => setDraft({ ...draft, wholeMenu: true })} style={{ flex: 1 }}>
          <Text variant="label" weight={600}>
            {t('merchant.menu_photos.whole_menu')}
          </Text>
        </ChoiceTile>
        <ChoiceTile testID="menu-photos-some" selected={!draft.wholeMenu} onPress={() => setDraft({ ...draft, wholeMenu: false })} style={{ flex: 1 }}>
          <Text variant="label" weight={600}>
            {t('merchant.menu_photos.some_dishes')}
          </Text>
        </ChoiceTile>
      </View>
      {!draft.wholeMenu ? (
        menu.data ? (
          <View testID="menu-photos-dishes" style={{ gap: theme.space[1] }}>
            <Text variant="caption" color="textMuted">
              {t('merchant.menu_photos.picked', { count: draft.itemIds.length })}
            </Text>
            {dishes.map((d) => {
              const on = draft.itemIds.includes(d.id);
              return (
                <Pressable
                  key={d.id}
                  testID={`menu-photos-dish-${d.id}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setDraft(toggleDish(draft, d.id))}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 52, paddingVertical: theme.space[1], opacity: pressed ? 0.85 : 1 })}
                >
                  <Thumb url={d.photoUrl} name={d.nameAr} size={44} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="body" numberOfLines={1}>
                      {d.nameAr}
                    </Text>
                    {d.photoUrl ? null : (
                      <Text variant="caption" color="textMuted">
                        {t('merchant.menu_photos.no_photo')}
                      </Text>
                    )}
                  </View>
                  <View style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: on ? theme.colors.accent : theme.colors.borderStrong, backgroundColor: on ? theme.colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Glyph name="check" size={16} color="onAccent" strokeWidth={2.6} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Skeleton lines={4} />
        )
      ) : null}
      <TextField
        testID="menu-photos-note"
        label={t('merchant.menu_photos.note')}
        value={draft.note}
        onChangeText={(v) => setDraft(withNote(draft, v))}
        placeholder={t('merchant.menu_photos.note_placeholder')}
        multiline
        maxLength={MENU_PHOTO_RULES.noteMaxChars}
        style={{ minHeight: NOTE_HEIGHT }}
      />
      <Button testID="menu-photos-submit" size="lg" fullWidth label={t('merchant.menu_photos.submit')} disabled={!canSubmit(draft)} loading={request.isPending} onPress={() => void submit()} />
    </Panel>
  );
}

function PastRequests({ list }: { list: MenuPhotoRequestView[] }) {
  const theme = useTheme();
  const t = useT();
  const dates = useDates();
  const now = Date.now();
  return (
    <Panel testID="menu-photos-past">
      <PanelTitle glyph="history" title={t('merchant.menu_photos.past')} />
      {list.map((r) => (
        <View key={r.requestId} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="body">{dates.day(r.requestedAt, now)}</Text>
            <Text variant="caption" color="textMuted">
              {r.state === 'done' ? t('merchant.menu_photos.past_accepted', { count: r.counts.accepted }) : r.wholeMenu ? t('merchant.menu_photos.whole_menu') : t('merchant.menu_photos.dishes', { count: r.counts.dishes })}
            </Text>
          </View>
          <Pill tone={r.state === 'done' ? 'success' : 'neutral'} size="sm" label={t(STATE_KEY[r.state])} />
        </View>
      ))}
    </Panel>
  );
}
