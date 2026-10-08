import { useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import { Button, EmptyState, Skeleton, Text, TextField, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { Page } from '@/components/Page';
import { Glyph } from '@/features/menu/Glyph';
import { Panel, PanelTitle } from '@/features/menu/parts';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { sameStory, storyDraftFrom, storyLeft, storyProblems, toStoryInput, type StoryDraft, type StoryProblem } from './logic';
import { useSaveStory, useStory } from './queries';

/** About three lines of text. */
const TEXT_HEIGHT = 112;

const PROBLEM_KEY: Readonly<Record<StoryProblem, 'merchant.story.too_long' | 'merchant.story.too_many_lines' | 'merchant.story.bad_year' | 'merchant.story.nothing_to_show'>> = {
  too_long: 'merchant.story.too_long',
  too_many_lines: 'merchant.story.too_many_lines',
  year: 'merchant.story.bad_year',
  nothing_to_show: 'merchant.story.nothing_to_show',
};

/**
 * قصة مطعمك («مطاعمنا», joy h5): one to three lines in the owner's own words and the year the kitchen
 * opened. Customers see it on the restaurant page only while «اعرضها للزباين» is on — that switch is
 * the owner's consent, so only the owner edits; staff see the same, read-only. A preview shows how it
 * will read.
 */
export function StoryScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const story = useStory(storeId);
  const save = useSaveStory();
  const [draft, setDraft] = useState<StoryDraft | null>(null);

  if (!story.data) {
    return (
      <Page title={t('merchant.story.title')} back testID="story" maxWidth={720}>
        {story.isError ? (
          <EmptyState icon="x" title={t('merchant.story.load_failed')} action={{ label: t('merchant.menu.retry'), onPress: () => void story.refetch() }} />
        ) : (
          <Skeleton height={260} radius={theme.radius.xl} />
        )}
      </Page>
    );
  }

  const view = story.data;
  const base = storyDraftFrom(view);
  const current = draft ?? base;
  const editable = view.canEdit;
  const problems = storyProblems(current, new Date().getFullYear());
  const dirty = !sameStory(current, base);
  const submit = async () => {
    if (!storeId) return;
    try {
      await save.mutateAsync(toStoryInput(storeId, current));
      setDraft(null);
      toast.show({ message: current.shown && current.text.trim() ? t('merchant.story.saved_shown') : t('merchant.story.saved_hidden'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  return (
    <Page title={t('merchant.story.title')} back testID="story" maxWidth={720}>
      <Text variant="body" color="textMuted">
        {t('merchant.story.intro')}
      </Text>
      {!editable ? (
        <View testID="story-read-only" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.infoTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <Glyph name="info" size={20} color="textMuted" strokeWidth={2} />
          <Text variant="label" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.story.read_only')}
          </Text>
        </View>
      ) : null}

      <Panel testID="story-edit">
        <PanelTitle glyph="pencil" title={t('merchant.story.text')} hint={t('merchant.story.text_hint')} />
        {editable ? (
          <TextField testID="story-text" value={current.text} onChangeText={(v) => setDraft({ ...current, text: v })} placeholder={t('merchant.story.text_placeholder')} multiline hint={t('merchant.story.left', { count: storyLeft(current) })} style={{ minHeight: TEXT_HEIGHT }} />
        ) : (
          <Text variant="body" color={current.text ? 'text' : 'textMuted'}>
            {current.text || t('merchant.story.none')}
          </Text>
        )}
        {editable ? (
          <TextField testID="story-year" value={current.year} onChangeText={(v) => setDraft({ ...current, year: v })} label={t('merchant.story.year')} placeholder={t('merchant.story.year_placeholder')} keyboardType="number-pad" maxLength={4} />
        ) : current.year ? (
          <Text variant="label" color="textMuted" tabular>
            {t('merchant.story.since', { year: current.year })}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 48 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{t('merchant.story.show')}</Text>
            <Text variant="caption" color="textMuted">
              {t('merchant.story.show_hint')}
            </Text>
          </View>
          <Switch
            testID="story-shown"
            accessibilityLabel={t('merchant.story.show')}
            value={current.shown}
            disabled={!editable}
            onValueChange={(v) => setDraft({ ...current, shown: v })}
            trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
            {...(Platform.OS === 'web' ? { activeThumbColor: theme.colors.surface } : {})}
          />
        </View>
        {problems.length > 0 ? (
          <Text variant="label" color="dangerText" testID="story-problem">
            {t(PROBLEM_KEY[problems[0]!])}
          </Text>
        ) : null}
      </Panel>

      {current.text.trim() ? (
        <Panel testID="story-preview">
          <PanelTitle glyph="store" title={t('merchant.story.preview')} hint={current.shown ? t('merchant.story.preview_shown') : t('merchant.story.preview_hidden')} />
          <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[4], gap: theme.space[2], opacity: current.shown ? 1 : 0.6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[2] }}>
              <Text variant="label" weight={600} color="accentText">
                {t('merchant.story.customer_title')}
              </Text>
              {current.year.trim() ? (
                <Text variant="caption" color="textMuted" tabular>
                  {t('merchant.story.since', { year: current.year.trim() })}
                </Text>
              ) : null}
            </View>
            <Text variant="body">{current.text.trim()}</Text>
          </View>
        </Panel>
      ) : null}

      {editable ? <Button testID="story-save" size="lg" fullWidth label={t('merchant.story.save')} disabled={!dirty || problems.length > 0} loading={save.isPending} onPress={() => void submit()} /> : null}
    </Page>
  );
}
