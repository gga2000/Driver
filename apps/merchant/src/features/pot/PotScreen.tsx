import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Chip, EmptyState, SearchField, Skeleton, Text, TextField, useTheme, useToast } from '@driver/ui';
import { Page } from '@/components/Page';
import { Glyph } from '@/features/menu/Glyph';
import { Panel, PanelTitle } from '@/features/menu/parts';
import { useMenu } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { clock12 } from '@/lib/time';
import { POT_UNTIL_CHOICES, potCandidates, potNote, potNoteLeft } from './logic';
import { usePot, usePotActions } from './queries';

/** Dishes listed before «كل المنيو»: the pot is usually one of a few cooked dishes. */
const SHORT_LIST = 8;

const DOW_KEYS = ['merchant.date.dow_0', 'merchant.date.dow_1', 'merchant.date.dow_2', 'merchant.date.dow_3', 'merchant.date.dow_4', 'merchant.date.dow_5', 'merchant.date.dow_6'] as const;

/** Note box: one short line («ويا تمن عنبر»). */
const NOTE_HEIGHT = 52;

/** "16:00" → today's "4:00 م" on the city clock. */
function untilLabel(hhmm: string, date: string): string {
  return clock12(new Date(`${date}T${hhmm}:00+03:00`));
}

/**
 * قدر اليوم (joy h2): one dish a day, posted in one tap. Last week's same day comes first («نفسها
 * اليوم»), then the dishes cooked lately, then the whole menu (on sale only). A short note and «لحد»
 * are optional. Customers see it on «العزيزية اليوم» and the restaurant page; people who follow the dish
 * get one notification. Owner and staff both post it.
 */
export function PotScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const pot = usePot(storeId);
  const menu = useMenu(storeId);
  const { set, clear } = usePotActions();
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [until, setUntil] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
  const post = async (itemId: string, withExtras: boolean) => {
    if (!storeId) return;
    try {
      await set.mutateAsync({ merchantOrgId: storeId, itemId, ...(withExtras ? { note: note.trim() || null, until } : {}) });
      setPicked(null);
      setNote('');
      setUntil(null);
      toast.show({ message: t('merchant.pot.posted'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };
  const takeOff = async () => {
    if (!storeId) return;
    try {
      await clear.mutateAsync({ merchantOrgId: storeId });
      toast.show({ message: t('merchant.pot.cleared'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };

  if (!pot.data) {
    return (
      <Page title={t('merchant.pot.title')} back testID="pot" maxWidth={720}>
        {pot.isError ? (
          <EmptyState icon="x" title={t('merchant.pot.load_failed')} action={{ label: t('merchant.menu.retry'), onPress: () => void pot.refetch() }} />
        ) : (
          <View style={{ gap: theme.space[4] }}>
            <Skeleton height={120} radius={theme.radius.xl} />
            <Skeleton height={260} radius={theme.radius.xl} />
          </View>
        )}
      </Page>
    );
  }

  const view = pot.data;
  const candidates = potCandidates(menu.data, query);
  const listed = query.trim() || showAll ? candidates.slice(0, 40) : candidates.slice(0, SHORT_LIST);
  const followersOf = (id: string) => view.followers[id] ?? 0;
  const weekday = t(DOW_KEYS[new Date(`${view.date}T12:00:00+03:00`).getUTCDay()] ?? 'merchant.date.dow_0');

  return (
    <Page title={t('merchant.pot.title')} back testID="pot" maxWidth={720}>
      <Text variant="body" color="textMuted">
        {t('merchant.pot.intro')}
      </Text>

      {view.today ? (
        <Panel testID="pot-today">
          <PanelTitle glyph="flame" title={t('merchant.pot.today_title')} />
          <Text variant="title">{view.today.name}</Text>
          {view.today.note ? <Text variant="body">{view.today.note}</Text> : null}
          <Text variant="label" color="textMuted" tabular>
            {view.today.until ? t('merchant.pot.until', { time: untilLabel(view.today.until, view.date) }) : t('merchant.pot.until_out')}
            {followersOf(view.today.itemId) > 0 ? ` · ${t('merchant.pot.followers', { count: followersOf(view.today.itemId) })}` : ''}
          </Text>
          <Button testID="pot-clear" variant="secondary" label={t('merchant.pot.clear')} loading={clear.isPending} onPress={() => void takeOff()} />
        </Panel>
      ) : view.lastWeek ? (
        <Panel testID="pot-last-week">
          <PanelTitle glyph="history" title={t('merchant.pot.last_week', { day: weekday })} />
          <Text variant="title">{view.lastWeek.name}</Text>
          <Button testID="pot-same" size="lg" fullWidth label={t('merchant.pot.same_today')} loading={set.isPending && picked === null} onPress={() => void post(view.lastWeek!.itemId, false)} />
        </Panel>
      ) : null}

      <Panel testID="pot-pick">
        <PanelTitle glyph="flame" title={view.today ? t('merchant.pot.change_title') : t('merchant.pot.pick_title')} hint={t('merchant.pot.pick_hint')} />
        {view.recent.length > 0 ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" color="textMuted">
              {t('merchant.pot.recent')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {view.recent.map((r, i) => (
                <Chip key={r.itemId} testID={`pot-recent-${i}`} role="radio" label={r.name} selected={picked === r.itemId} onPress={() => setPicked(r.itemId)} />
              ))}
            </View>
          </View>
        ) : null}
        <SearchField testID="pot-search" value={query} onChangeText={setQuery} placeholder={t('merchant.pot.search')} accessibilityLabel={t('merchant.pot.search')} />
        {menu.isPending ? (
          <Skeleton height={160} radius={theme.radius.lg} />
        ) : candidates.length === 0 ? (
          <Text variant="label" color="textMuted" testID="pot-none">
            {query.trim() ? t('merchant.menu.no_results', { query: query.trim() }) : t('merchant.pot.none_on_sale')}
          </Text>
        ) : (
          <View accessibilityRole="radiogroup">
            {listed.map((i) => {
              const on = picked === i.id;
              return (
                <Pressable
                  key={i.id}
                  testID={`pot-dish-${i.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setPicked(i.id)}
                  style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? theme.colors.selected : theme.colors.borderStrong, backgroundColor: on ? theme.colors.selected : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Glyph name="check" size={14} color="onSelected" strokeWidth={2.5} /> : null}
                  </View>
                  <Text variant="body" style={{ flex: 1 }}>
                    {i.nameAr}
                  </Text>
                  {followersOf(i.id) > 0 ? (
                    <Text variant="caption" color="textMuted" tabular>
                      {t('merchant.pot.followers', { count: followersOf(i.id) })}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            {listed.length < candidates.length && !query.trim() && !showAll ? (
              <Button testID="pot-show-all" variant="ghost" label={t('merchant.pot.show_all', { count: candidates.length })} onPress={() => setShowAll(true)} />
            ) : null}
          </View>
        )}
      </Panel>

      <Panel testID="pot-extras">
        <PanelTitle glyph="pencil" title={t('merchant.pot.note')} />
        <TextField testID="pot-note" value={note} onChangeText={(v) => setNote(potNote(v))} placeholder={t('merchant.pot.note_placeholder')} hint={t('merchant.pot.note_left', { count: potNoteLeft(note) })} style={{ minHeight: NOTE_HEIGHT }} />
        <Text variant="label" color="textMuted">
          {t('merchant.pot.until_title')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {POT_UNTIL_CHOICES.map((u) => (
            <Chip key={u ?? 'out'} testID={`pot-until-${u ?? 'out'}`} role="radio" label={u ? t('merchant.pot.until', { time: untilLabel(u, view.date) }) : t('merchant.pot.until_out')} selected={until === u} onPress={() => setUntil(u)} />
          ))}
        </View>
      </Panel>

      <Button testID="pot-post" size="lg" fullWidth label={t('merchant.pot.post')} disabled={picked === null} loading={set.isPending && picked !== null} onPress={() => (picked ? void post(picked, true) : undefined)} />
    </Page>
  );
}
