import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MessageKey } from '@driver/i18n';
import { Button, Icon, IconButton, Text, useTheme, useToast, type IconName } from '@driver/ui';
import type { ThemeColorKey } from '@driver/design-tokens';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useReorder, type ReorderState } from './queries';
import { reorderIsClean, type ReorderMissReason } from './reorder';

const REASON: Record<ReorderMissReason, MessageKey> = {
  gone: 'reorder.reason_gone',
  sold_out: 'reorder.reason_sold_out',
  schedule: 'reorder.reason_schedule',
  choice_gone: 'reorder.reason_choice_gone',
};

/**
 * "اطلبه مرة ثانية" from anywhere (orders list, home card): `start(row)` rebuilds the cart from
 * today's menu. When nothing changed it goes straight to the cart; otherwise a sheet says what comes
 * back, what doesn't and why, what costs something else now, and whether the current cart is
 * replaced — before anything happens.
 */
export function useReorderFlow(): { start: ReturnType<typeof useReorder>['start']; busyOrderId: string | null; sheet: ReactNode } {
  const t = useT();
  const toast = useToast();
  const flow = useReorder();
  const { state, confirm, close } = flow;

  const go = () => {
    if (state.phase !== 'ready') return;
    const merchant = state.result.cart.merchant?.name ?? '';
    if (confirm()) {
      close();
      toast.show({ message: t('reorder.done', { merchant }), tone: 'success', icon: 'cart' });
      router.push('/cart');
    }
  };

  // Clean rebuilds (same dishes, same prices, kitchen open, nothing to replace) skip the sheet.
  const clean = state.phase === 'ready' && reorderIsClean(state.result) && !state.replacing;
  useEffect(() => {
    if (clean) go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean]);

  const busyOrderId = state.phase === 'loading' ? state.row.order.id : null;
  const show = state.phase === 'error' || (state.phase === 'ready' && !clean);
  return {
    start: flow.start,
    busyOrderId,
    sheet: show ? <ReorderSheet state={state} onClose={close} onGo={go} onRetry={() => void flow.start((state as Extract<ReorderState, { phase: 'error' }>).row)} /> : null,
  };
}

function ReorderSheet({ state, onClose, onGo, onRetry }: { state: ReorderState; onClose: () => void; onGo: () => void; onRetry: () => void }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  if (state.phase !== 'ready' && state.phase !== 'error') return null;
  const merchant = state.row.merchantName ?? '';
  const r = state.phase === 'ready' ? state.result : null;
  const nothing = r !== null && r.cart.lines.length === 0;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('action.close')} onPress={onClose} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }} />
        <View
          testID="reorder-sheet"
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: MAX_CONTENT_WIDTH,
            maxHeight: '88%',
            alignSelf: 'center',
            backgroundColor: theme.colors.surface,
            borderTopStartRadius: theme.radius['2xl'],
            borderTopEndRadius: theme.radius['2xl'],
            paddingTop: theme.space[3],
            paddingBottom: theme.space[5] + insets.bottom,
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: theme.space[3] }} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], paddingHorizontal: theme.space[5] }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading" accessibilityRole="header">
                {t('reorder.title')}
              </Text>
              <Text variant="footnote" color="textMuted">
                {t('reorder.subtitle', { merchant })}
              </Text>
            </View>
            <IconButton icon="x" variant="tonal" size={44} accessibilityLabel={t('action.close')} onPress={onClose} testID="reorder-close" />
          </View>

          {state.phase === 'error' ? (
            <View style={{ padding: theme.space[5], gap: theme.space[4] }}>
              <Text variant="body" color="textMuted">
                {t('reorder.failed')}
              </Text>
              <Button label={t('action.retry')} variant="secondary" fullWidth onPress={onRetry} />
            </View>
          ) : r ? (
            <>
              <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingTop: theme.space[4], gap: theme.space[4] }}>
                {r.closed ? <Note icon="clock" tone="warningTint" fg="warningText" text={r.opensAt ? t('reorder.closed', { time: r.opensAt }) : t('reorder.closed_no_time')} /> : null}
                {nothing ? <Note icon="x" tone="dangerTint" fg="dangerText" text={t('reorder.nothing')} testID="reorder-nothing" /> : null}

                {r.added.length > 0 ? (
                  <Group title={t('reorder.added_heading')} testID="reorder-added">
                    {r.cart.lines.map((l) => (
                      <Line key={l.key} icon="check" fg="successText" title={l.qty > 1 ? `${l.qty}× ${l.name}` : l.name} />
                    ))}
                  </Group>
                ) : null}

                {r.missing.length > 0 ? (
                  <Group title={t('reorder.missing_heading')} testID="reorder-missing">
                    {r.missing.map((m, i) => (
                      <Line key={`${m.name}-${i}`} icon="x" fg="dangerText" title={m.qty > 1 ? `${m.qty}× ${m.name}` : m.name} sub={t(REASON[m.reason])} muted />
                    ))}
                  </Group>
                ) : null}

                {r.repriced.length > 0 ? (
                  <Group title={t('reorder.repriced_heading')} testID="reorder-repriced">
                    {r.repriced.map((p) => (
                      <Line key={p.name} icon="receipt" fg="warningText" title={p.name} sub={t('reorder.price_change', { was: amountParam(p.wasIqd), now: amountParam(p.nowIqd) })} />
                    ))}
                  </Group>
                ) : null}

                {r.droppedExtras.length > 0 ? (
                  <Group title={t('reorder.extras_heading')}>
                    {r.droppedExtras.map((d, i) => (
                      <Line key={`${d.dish}-${d.extra}-${i}`} icon="x" fg="textMuted" title={t('reorder.extra_line', { dish: d.dish, extra: d.extra })} muted />
                    ))}
                  </Group>
                ) : null}

                {state.phase === 'ready' && state.replacing && !nothing ? <Note icon="cart" tone="surfaceSunken" fg="text" text={t('reorder.replace_note', { merchant: state.replacing })} testID="reorder-replace" /> : null}
                {!nothing ? (
                  <Text variant="caption" color="textMuted">
                    {t('reorder.total_note')}
                  </Text>
                ) : null}
              </ScrollView>
              <View style={{ paddingHorizontal: theme.space[5], paddingTop: theme.space[4], gap: theme.space[2] }}>
                {nothing ? (
                  <Button
                    testID="reorder-menu"
                    size="lg"
                    fullWidth
                    icon="bag"
                    label={t('reorder.open_menu')}
                    onPress={() => {
                      const id = state.row.order.merchantOrgId;
                      onClose();
                      if (id) router.push({ pathname: '/restaurant/[id]', params: { id } });
                    }}
                  />
                ) : (
                  <Button testID="reorder-go" size="lg" fullWidth icon="cart" label={t('reorder.go')} onPress={onGo} />
                )}
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Group({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={600} color="textMuted">
        {title}
      </Text>
      <View style={{ gap: theme.space[2] }}>{children}</View>
    </View>
  );
}

function Line({ icon, fg, title, sub, muted }: { icon: IconName; fg: ThemeColorKey; title: string; sub?: string; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken, marginTop: 2 }}>
        <Icon name={icon} size={14} color={fg} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="body" color={muted ? 'textMuted' : 'text'}>
          {title}
        </Text>
        {sub ? (
          <Text variant="footnote" color="textMuted" tabular>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Note({ icon, tone, fg, text, testID }: { icon: IconName; tone: ThemeColorKey; fg: ThemeColorKey; text: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors[tone] }}>
      <View style={{ marginTop: 2 }}>
        <Icon name={icon} size={18} color={fg} strokeWidth={2.2} />
      </View>
      <Text variant="label" color={fg} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** The small "اطلبه مرة ثانية" button (orders list rows, the home card). */
export function ReorderButton({ onPress, loading, testID, size = 'sm' }: { onPress: () => void; loading: boolean; testID?: string; size?: 'sm' | 'md' }) {
  const t = useT();
  return <Button testID={testID} size={size} variant="secondary" icon="refresh" label={t('orders.reorder')} loading={loading} onPress={onPress} />;
}
