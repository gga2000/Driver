import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import type { AdminMenuItem } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { addDismissed, parseDismissed } from '@/features/day/logic';
import { COUNTER } from '@/lib/counter';
import { useT, type TFn } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { Glyph } from './Glyph';
import { photoDownReason, type PhotoDownReason } from './photo-down';

/** «نزّلنا صورة {dish} لأنها {reason}، صوّرها من جديد» (p4). */
export function photoDownNotice(t: TFn, dish: string, reason: PhotoDownReason | string): string {
  return t('merchant.photo_down.notice', { dish, reason: t(`merchant.photo_down.reason_${photoDownReason(reason)}`) });
}

/** The tray's tile while the dish has no photo because the team took it down. */
export function photoDownTile(t: TFn, item: Pick<AdminMenuItem, 'nameAr' | 'photoUrl' | 'photoTakenDown'>): { label: string; a11y: string } | undefined {
  if (item.photoUrl || !item.photoTakenDown) return undefined;
  return { label: t('merchant.photo_down.tile'), a11y: photoDownNotice(t, item.nameAr, item.photoTakenDown.reason) };
}

/** The dish screen's line above the photo: why it came down and that a new one fixes it. */
export function PhotoDownNote({ item }: { item: Pick<AdminMenuItem, 'nameAr' | 'photoUrl' | 'photoTakenDown'> }) {
  const theme = useTheme();
  const t = useT();
  if (item.photoUrl || !item.photoTakenDown) return null;
  return (
    <View testID="photo-down-note" accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], backgroundColor: COUNTER.lateWash, borderBottomWidth: 1, borderBottomColor: COUNTER.late }}>
      <Glyph name="camera" size={18} color={COUNTER.late} strokeWidth={2} />
      <Text variant="footnote" weight={700} style={{ flex: 1, color: COUNTER.late }}>
        {photoDownNotice(t, item.nameAr, item.photoTakenDown.reason)}
      </Text>
    </View>
  );
}

// ───────────────────────── told on the board, on this device ─────────────────────────

const SEEN_KEY = 'driver.merchant.photo_down_seen';
let seen: readonly string[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

async function load() {
  if (loaded) return;
  loaded = true;
  const raw = await storage.getItem(SEEN_KEY).catch(() => null);
  seen = [...new Set([...parseDismissed(raw), ...seen])];
  emit();
}

/** Take-downs the board has already told about here («تمام» or «صوّرها»), kept across reloads. */
export function usePhotoDownSeen(): { seen: readonly string[]; markSeen: (keys: readonly string[]) => void } {
  useEffect(() => {
    void load();
  }, []);
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => seen,
    () => seen,
  );
  const markSeen = useCallback((keys: readonly string[]) => {
    seen = keys.reduce<readonly string[]>((list, k) => addDismissed(list, k), seen);
    emit();
    void storage.setItem(SEEN_KEY, JSON.stringify(seen)).catch(() => undefined);
  }, []);
  return { seen: value, markSeen };
}
