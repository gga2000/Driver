import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { EmptyState, Skeleton, Text, useTheme } from '@driver/ui';
import { Page } from '@/components/Page';
import { Glyph } from '@/features/menu/Glyph';
import { Panel } from '@/features/menu/parts';
import { useCurrentStore } from '@/features/store/queries';
import { useDates } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { unseenChanges } from './logic';
import { useStaffChanges, useStaffSeen } from './queries';

/**
 * «فريقنا عدّل بمحلك»: every change Driver's team made to the store from the Console (menu, prices,
 * photos, hours, open and closed), newest first, with the team member's first name. Opening it marks
 * them seen on this device; the ones that were new keep their «جديد» until he leaves. Owner only.
 */
export function StaffChangesScreen() {
  const theme = useTheme();
  const t = useT();
  const dates = useDates();
  const { store, canSeeMoney: owner } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const changes = useStaffChanges(storeId, owner);
  const { seen, see } = useStaffSeen();
  // What was new when he opened the list, kept while he reads it.
  const [newIds, setNewIds] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!storeId || !changes.data || newIds) return;
    setNewIds(new Set(unseenChanges(changes.data, seen[storeId], Date.now()).map((r) => r.id)));
    see(storeId, changes.data);
  }, [storeId, changes.data, newIds, seen, see]);

  const page = (body: React.ReactNode) => (
    <Page title={t('merchant.staff_changes.title')} back testID="staff-changes" maxWidth={760}>
      {body}
    </Page>
  );
  if (store && !owner) return page(<EmptyState icon="lock" title={t('merchant.staff_changes.owner_only')} />);
  if (!changes.data) {
    return page(
      changes.isError ? (
        <EmptyState icon="x" title={t('merchant.staff_changes.load_failed')} action={{ label: t('merchant.menu.retry'), onPress: () => void changes.refetch() }} />
      ) : (
        <View style={{ gap: theme.space[3] }}>
          <Skeleton height={72} radius={theme.radius.xl} />
          <Skeleton height={72} radius={theme.radius.xl} />
          <Skeleton height={72} radius={theme.radius.xl} />
        </View>
      ),
    );
  }

  const now = Date.now();
  return page(
    <>
      <Text variant="body" color="textMuted">
        {t('merchant.staff_changes.intro')}
      </Text>
      {changes.data.length === 0 ? (
        <EmptyState icon="check" title={t('merchant.staff_changes.empty')} />
      ) : (
        <Panel padded={false} testID="staff-changes-list" style={{ overflow: 'hidden' }}>
          {changes.data.map((c, i) => {
            const fresh = newIds?.has(c.id) ?? false;
            return (
              <View
                key={c.id}
                testID="staff-change"
                style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border, backgroundColor: fresh ? theme.colors.accentTint : undefined }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: fresh ? theme.colors.surface : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                  <Glyph name="store" size={18} color={fresh ? 'accentText' : 'textMuted'} strokeWidth={2} />
                </View>
                <View style={{ flex: 1, gap: theme.space[1] }}>
                  <Text variant="bodyStrong">{c.summaryAr}</Text>
                  <Text variant="caption" color="textMuted">
                    {(c.byFirstName ? t('merchant.staff_changes.by', { name: c.byFirstName }) : t('merchant.staff_changes.by_team')) + ' · ' + dates.when(c.at, now)}
                  </Text>
                </View>
                {fresh ? (
                  <Text variant="caption" weight={700} color="accentText">
                    {t('merchant.staff_changes.new')}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </Panel>
      )}
      <Text variant="caption" color="textMuted">
        {t('merchant.staff_changes.wrong')}
      </Text>
    </>,
  );
}
