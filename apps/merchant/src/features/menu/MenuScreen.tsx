import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { AdminMenuItem } from '@driver/contracts';
import { Button, EmptyState, SearchField, Skeleton, Text, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { Page } from '@/components/Page';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { CategoryNameSheet, ReorderSheet } from './CategorySheets';
import { Glyph } from './Glyph';
import { categoryNames, filterMenu, itemStatus, sectionCounts, type MenuCategoryLike } from './logic';
import { MenuItemRow } from './MenuItemRow';
import { GlyphButton, Panel, Pill } from './parts';
import { PotEntry } from '@/features/pot/PotEntry';
import { useMenu, useMenuActions } from './queries';

type StatusFilter = 'all' | 'sold_out_today' | 'off';
type Section = MenuCategoryLike<AdminMenuItem> & { key: string; pending?: boolean };

/** Minute ticker: "خلص اليوم" flips back by itself at midnight. */
function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * المنيو. Tablet: sections on the start side, the chosen section's dishes beside them. Phone: one
 * column with section chips. Both: search, "what's off right now" filters, instant switches.
 */
export function MenuScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { wide } = useLayout();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const menu = useMenu(storeId);
  const actions = useMenuActions(storeId);
  const now = useMinuteNow();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [nameSheet, setNameSheet] = useState<{ renameFrom: string | null } | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);

  const categories = useMemo(() => menu.data?.categories ?? [], [menu.data]);
  const named = useMemo(() => categoryNames(categories), [categories]);
  const allItems = useMemo(() => categories.flatMap((c) => c.items), [categories]);
  const counts = useMemo(() => sectionCounts(allItems, now), [allItems, now]);

  // Sections on screen: the menu's, plus new empty ones the owner just named.
  const sections: Section[] = useMemo(() => {
    const real = categories.map((c, i) => ({ ...c, key: c.nameAr ?? `__none_${i}` }));
    const extra = pending.filter((p) => !named.includes(p)).map((p) => ({ nameAr: p, items: [], key: p, pending: true }));
    const unnamedIdx = real.findIndex((c) => c.nameAr === null);
    return unnamedIdx >= 0 ? [...real.slice(0, unnamedIdx), ...extra, ...real.slice(unnamedIdx)] : [...real, ...extra];
  }, [categories, pending, named]);

  const searching = query.trim().length > 0 || status !== 'all';
  const visible: Section[] = useMemo(() => {
    let list: Section[] = sections;
    if (query.trim()) list = filterMenu(list, query).map((c) => ({ ...c, key: c.nameAr ?? '__none' }));
    if (status !== 'all') list = list.map((c) => ({ ...c, items: c.items.filter((i) => itemStatus(i, now) === status) })).filter((c) => c.items.length > 0);
    return list;
  }, [sections, query, status, now]);

  const selectedKey = selected && sections.some((s) => s.key === selected) ? selected : (sections[0]?.key ?? null);
  const paneSections = wide && !searching ? sections.filter((s) => s.key === selectedKey) : !wide && !searching && selected ? sections.filter((s) => s.key === selected) : visible;

  const openItem = useCallback((item: AdminMenuItem) => router.push({ pathname: '/menu/item', params: { id: item.id } }), []);
  const addItem = (category: string | null) => router.push({ pathname: '/menu/item', params: category ? { category } : {} });

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });

  const onToggle = useCallback(
    (item: AdminMenuItem, on: boolean) => {
      if (!storeId) return;
      actions.setAvailability.mutate(
        { merchantOrgId: storeId, itemId: item.id, available: on },
        {
          onSuccess: () =>
            toast.show(
              on
                ? { message: t('merchant.menu.toast_on', { name: item.nameAr }), tone: 'success' }
                : { message: t('merchant.menu.toast_off', { name: item.nameAr }), tone: 'neutral', action: { label: t('merchant.menu.undo'), onPress: () => actions.setAvailability.mutate({ merchantOrgId: storeId, itemId: item.id, available: true }) } },
            ),
          onError: fail,
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeId, t],
  );
  const onSoldOut = useCallback(
    (item: AdminMenuItem) => {
      if (!storeId) return;
      actions.soldOutToday.mutate(
        { merchantOrgId: storeId, itemId: item.id },
        {
          onSuccess: () =>
            toast.show({
              message: t('merchant.menu.toast_sold_out', { name: item.nameAr }),
              tone: 'warning',
              action: { label: t('merchant.menu.undo'), onPress: () => actions.setAvailability.mutate({ merchantOrgId: storeId, itemId: item.id, available: true }) },
            }),
          onError: fail,
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeId, t],
  );

  const saveName = (name: string) => {
    if (!storeId || !nameSheet) return;
    const from = nameSheet.renameFrom;
    if (!from) {
      setPending((p) => [...p, name]);
      setSelected(name);
      setNameSheet(null);
      toast.show({ message: t('merchant.menu.section_added', { name }), tone: 'success' });
      return;
    }
    if (pending.includes(from)) {
      setPending((p) => p.map((x) => (x === from ? name : x)));
      setSelected(name);
      setNameSheet(null);
      return;
    }
    actions.upsertCategory.mutate(
      { merchantOrgId: storeId, nameAr: name, renameFrom: from },
      {
        onSuccess: () => {
          setSelected(name);
          setNameSheet(null);
          toast.show({ message: t('merchant.menu.section_renamed', { name }), tone: 'success' });
        },
        onError: fail,
      },
    );
  };

  const saveOrder = (order: string[]) => {
    if (!storeId) return;
    actions.reorderCategories.mutate(
      { merchantOrgId: storeId, order },
      {
        onSuccess: () => {
          setReorderOpen(false);
          toast.show({ message: t('merchant.menu.reorder_done'), tone: 'success' });
        },
        onError: fail,
      },
    );
  };

  // ── pieces ──
  const headerActions = wide ? (
    <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
      <Button testID="menu-import" label={t('merchant.menu.import_cta')} variant="secondary" trailing={<Glyph name="scan" size={20} strokeWidth={2} />} onPress={() => router.push('/menu/import')} />
      <Button testID="menu-add-item" label={t('merchant.menu.add_item')} icon="plus" onPress={() => addItem(searching ? null : (sections.find((s) => s.key === selectedKey)?.nameAr ?? null))} />
    </View>
  ) : (
    <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
      <GlyphButton testID="menu-import" glyph="scan" label={t('merchant.menu.import_cta')} onPress={() => router.push('/menu/import')} />
      <GlyphButton testID="menu-add-item" glyph="plus" variant="accent" label={t('merchant.menu.add_item')} onPress={() => addItem(selected ? (sections.find((s) => s.key === selected)?.nameAr ?? null) : null)} />
    </View>
  );

  const subtitle = menu.data ? t('merchant.menu.subtitle', { count: counts.total, sections: named.length }) : store?.name;

  const filters = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} style={{ flexGrow: 0 }}>
      <FilterChip testID="filter-all" label={t('merchant.menu.filter_all', { count: counts.total })} selected={status === 'all'} onPress={() => setStatus('all')} />
      <FilterChip testID="filter-sold-out" label={t('merchant.menu.filter_sold_out', { count: counts.soldOutToday })} selected={status === 'sold_out_today'} onPress={() => setStatus('sold_out_today')} tone="warning" />
      <FilterChip testID="filter-off" label={t('merchant.menu.filter_off', { count: counts.off })} selected={status === 'off'} onPress={() => setStatus('off')} tone="neutral" />
    </ScrollView>
  );

  const search = <SearchField testID="menu-search" value={query} onChangeText={setQuery} placeholder={t('merchant.menu.search')} onClear={() => setQuery('')} style={wide ? { flex: 1, maxWidth: 420 } : undefined} />;

  const body = (() => {
    if (menu.isLoading || !menu.data) {
      return menu.isError ? (
        <EmptyState icon="x" title={t('merchant.menu.load_failed')} action={{ label: t('merchant.menu.retry'), onPress: () => void menu.refetch() }} />
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={84} radius={theme.radius.xl} />
          ))}
        </View>
      );
    }
    if (allItems.length === 0 && pending.length === 0) {
      return (
        <Panel style={{ alignItems: 'center', paddingVertical: theme.space[10], gap: theme.space[4] }}>
          <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
            <Glyph name="utensils" size={34} color="accentText" />
          </View>
          <Text variant="title" align="center">
            {t('merchant.menu.empty_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 420 }}>
            {t('merchant.menu.empty_body')}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button label={t('merchant.menu.import_cta')} variant="secondary" onPress={() => router.push('/menu/import')} />
            <Button label={t('merchant.menu.add_first')} icon="plus" onPress={() => addItem(null)} />
          </View>
        </Panel>
      );
    }
    if (paneSections.length === 0) {
      return (
        <Panel style={{ alignItems: 'center', paddingVertical: theme.space[8] }}>
          <Text variant="bodyStrong" align="center">
            {status !== 'all' && !query.trim() ? (status === 'off' ? t('merchant.menu.none_off') : t('merchant.menu.none_sold_out')) : t('merchant.menu.no_results', { query: query.trim() })}
          </Text>
        </Panel>
      );
    }
    return (
      <View style={{ gap: theme.space[5] }}>
        {paneSections.map((s) => (
          <SectionBlock
            key={s.key}
            section={s}
            now={now}
            wide={wide}
            showHeader
            big={wide && !searching}
            onRename={s.nameAr ? () => setNameSheet({ renameFrom: s.nameAr }) : undefined}
            onAdd={() => addItem(s.nameAr)}
            onOpen={openItem}
            onToggle={onToggle}
            onSoldOut={onSoldOut}
          />
        ))}
      </View>
    );
  })();

  const sheets = (
    <>
      <CategoryNameSheet visible={nameSheet !== null} renameFrom={nameSheet?.renameFrom ?? null} existing={[...named, ...pending]} busy={actions.upsertCategory.isPending} onClose={() => setNameSheet(null)} onSave={saveName} />
      <ReorderSheet visible={reorderOpen} sections={named} busy={actions.reorderCategories.isPending} onClose={() => setReorderOpen(false)} onSave={saveOrder} />
    </>
  );

  if (wide) {
    return (
      <Page title={t('merchant.nav.menu')} subtitle={subtitle} aside={headerActions} scroll={false} maxWidth={1320} testID="menu">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4], paddingBottom: theme.space[4] }}>
          {search}
          {filters}
        </View>
        <View style={{ flex: 1, flexDirection: 'row', gap: theme.space[5] }}>
          <View style={{ width: 296 }}>
            <ScrollView contentContainerStyle={{ gap: theme.space[3], paddingBottom: theme.space[8] }}>
              <PotEntry merchantOrgId={storeId} />
              <Panel padded={false} style={{ overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space[4], paddingTop: theme.space[4], paddingBottom: theme.space[2] }}>
                  <Text variant="label" color="textMuted" style={{ flex: 1 }}>
                    {t('merchant.menu.sections')}
                  </Text>
                  <GlyphButton testID="menu-reorder" glyph="sort" size={36} variant="plain" label={t('merchant.menu.reorder_title')} disabled={named.length < 2} onPress={() => setReorderOpen(true)} />
                </View>
                {sections.map((s, i) => (
                  <SectionNavRow key={s.key} index={i} section={s} now={now} selected={!searching && s.key === selectedKey} onPress={() => {
                    setQuery('');
                    setStatus('all');
                    setSelected(s.key);
                  }} />
                ))}
                <Pressable
                  testID="menu-add-category"
                  accessibilityRole="button"
                  onPress={() => setNameSheet({ renameFrom: null })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[4], borderTopWidth: 1, borderTopColor: theme.colors.border, opacity: pressed ? 0.7 : 1 })}
                >
                  <Glyph name="plus" size={20} color="accentText" strokeWidth={2} />
                  <Text variant="bodyStrong" color="accentText">
                    {t('merchant.menu.new_section')}
                  </Text>
                </Pressable>
              </Panel>
              <CustomerHint />
            </ScrollView>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: theme.space[10] }}>
            {body}
          </ScrollView>
        </View>
        {sheets}
      </Page>
    );
  }

  return (
    <Page title={t('merchant.nav.menu')} subtitle={subtitle} aside={headerActions} testID="menu">
      <PotEntry merchantOrgId={storeId} />
      {search}
      {filters}
      {menu.data && sections.length > 0 && !searching ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingEnd: theme.space[2] }} style={{ flexGrow: 0, marginTop: -theme.space[2] }}>
          <SectionChip testID="menu-cat-all" label={t('merchant.menu.all_sections')} selected={selected === null} onPress={() => setSelected(null)} />
          {sections.map((s, i) => (
            <SectionChip key={s.key} testID={`menu-cat-${i}`} label={s.nameAr ?? t('merchant.menu.no_section')} selected={selected === s.key} onPress={() => setSelected(s.key)} />
          ))}
          <SectionChip testID="menu-add-category" label={t('merchant.menu.new_section')} glyph="plus" selected={false} onPress={() => setNameSheet({ renameFrom: null })} />
          {named.length > 1 ? <SectionChip testID="menu-reorder" label={t('merchant.menu.reorder_short')} glyph="sort" selected={false} onPress={() => setReorderOpen(true)} /> : null}
        </ScrollView>
      ) : null}
      {body}
      {sheets}
    </Page>
  );
}

function FilterChip({ label, selected, onPress, testID, tone }: { label: string; selected: boolean; onPress: () => void; testID: string; tone?: 'warning' | 'neutral' }) {
  const theme = useTheme();
  const dot = tone === 'warning' ? theme.colors.warning : tone === 'neutral' ? theme.colors.textMuted : null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 44,
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius.pill,
        backgroundColor: selected ? theme.colors.text : theme.colors.surface,
        borderWidth: 1,
        borderColor: selected ? theme.colors.text : theme.colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      <Text variant="label" weight={600} color={selected ? 'bg' : 'text'} tabular numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SectionChip({ label, selected, onPress, testID, glyph }: { label: string; selected: boolean; onPress: () => void; testID: string; glyph?: 'plus' | 'sort' }) {
  const theme = useTheme();
  return (
    <Pressable hitSlop={2}
      testID={testID}
      accessibilityRole={glyph ? 'button' : 'radio'}
      accessibilityState={glyph ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 40,
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius.pill,
        backgroundColor: selected ? theme.colors.accentTint : 'transparent',
        borderWidth: selected ? 0 : 1,
        borderColor: glyph ? theme.colors.border : 'transparent',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {glyph ? <Glyph name={glyph} size={17} color="accentText" strokeWidth={2} /> : null}
      <Text variant="label" weight={selected ? 700 : 500} color={glyph ? 'accentText' : selected ? 'accentText' : 'textMuted'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SectionNavRow({ section, now, selected, onPress, index }: { section: Section; now: number; selected: boolean; onPress: () => void; index: number }) {
  const theme = useTheme();
  const t = useT();
  const c = sectionCounts(section.items, now);
  const away = c.soldOutToday + c.off;
  return (
    <Pressable
      testID={`menu-cat-${index}`}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 56,
        paddingHorizontal: theme.space[4],
        backgroundColor: selected ? theme.colors.accentTint : pressed ? theme.colors.surfaceSunken : 'transparent',
        borderStartWidth: 4,
        borderStartColor: selected ? theme.colors.accent : 'transparent',
      })}
    >
      <View style={{ flex: 1, gap: 0 }}>
        <Text variant="bodyStrong" color={selected ? 'text' : 'text'} numberOfLines={1}>
          {section.nameAr ?? t('merchant.menu.no_section')}
        </Text>
        <Text variant="caption" color="textMuted" tabular>
          {section.pending ? t('merchant.menu.section_empty_short') : t('merchant.menu.items_count', { count: c.total })}
        </Text>
      </View>
      {away > 0 ? <Pill size="sm" tone="warning" label={t('merchant.menu.away_count', { count: away })} /> : null}
    </Pressable>
  );
}

function SectionBlock({
  section,
  now,
  wide,
  big,
  onRename,
  onAdd,
  onOpen,
  onToggle,
  onSoldOut,
}: {
  section: Section;
  now: number;
  wide: boolean;
  showHeader: boolean;
  big: boolean;
  onRename?: (() => void) | undefined;
  onAdd: () => void;
  onOpen: (item: AdminMenuItem) => void;
  onToggle: (item: AdminMenuItem, on: boolean) => void;
  onSoldOut: (item: AdminMenuItem) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const c = sectionCounts(section.items, now);
  const title = section.nameAr ?? t('merchant.menu.no_section');
  const summary = [t('merchant.menu.items_count', { count: c.total }), c.soldOutToday ? t('merchant.menu.count_sold_out', { count: c.soldOutToday }) : null, c.off ? t('merchant.menu.count_off', { count: c.off }) : null].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ flex: 1 }}>
          <Text variant={big ? 'heading' : 'title'} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {section.pending ? t('merchant.menu.section_empty_short') : summary}
          </Text>
        </View>
        {onRename ? <GlyphButton testID={`rename-${section.key}`} glyph="pencil" size={wide ? 44 : 40} label={t('merchant.menu.rename_title', { name: title })} onPress={onRename} /> : null}
        {wide ? <Button size="sm" variant="secondary" icon="plus" label={t('merchant.menu.add_here')} onPress={onAdd} /> : <GlyphButton glyph="plus" size={40} label={t('merchant.menu.add_here')} onPress={onAdd} />}
      </View>
      {section.items.length === 0 ? (
        <Panel style={{ alignItems: 'center', paddingVertical: theme.space[8], gap: theme.space[3] }}>
          <Text variant="bodyStrong" align="center">
            {t('merchant.menu.section_empty_title')}
          </Text>
          <Text variant="footnote" color="textMuted" align="center" style={{ maxWidth: 360 }}>
            {t('merchant.menu.section_empty_body')}
          </Text>
          <Button label={t('merchant.menu.add_first')} icon="plus" onPress={onAdd} />
        </Panel>
      ) : (
        <Panel padded={false} style={{ overflow: 'hidden' }}>
          {section.items.map((item, i) => (
            <MenuItemRow key={item.id} item={item} now={now} wide={wide} last={i === section.items.length - 1} onOpen={onOpen} onToggle={onToggle} onSoldOut={onSoldOut} />
          ))}
        </Panel>
      )}
    </View>
  );
}

/** A calm reminder of what customers see (sold-out-today and hidden dishes). */
function CustomerHint() {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surfaceSunken }}>
      <Glyph name="info" size={20} color="textMuted" />
      <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
        {t('merchant.menu.customer_hint')}
      </Text>
    </View>
  );
}
