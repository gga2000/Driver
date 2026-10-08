import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Button, Icon, ModalSheet, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { pluralKey } from '@driver/i18n';
import { playTestSound } from '@/lib/alert';
import { useT, type TFn } from '@/lib/i18n';
import { askGps, openSettings } from '@/lib/readiness-probe';
import type { ReadyItem, ReadyKey, ReadyTone } from './readiness';
import { useReadiness } from './useReadiness';

const TONE: Record<ReadyTone, { fg: ThemeColorKey; bg: ThemeColorKey }> = {
  ok: { fg: 'successText', bg: 'successTint' },
  warn: { fg: 'warningText', bg: 'warningTint' },
  bad: { fg: 'dangerText', bg: 'dangerTint' },
};

/** "64%" in one left-to-right piece, so Arabic never shows it as "%64". */
const pct = (n: number) => `\u2066${n}%\u2069`;

function iconOf(item: ReadyItem): IconName {
  if (item.key === 'gps') return 'location-arrow';
  if (item.key === 'net') return item.tone === 'ok' ? 'wifi' : 'wifi-off';
  if (item.key === 'sound') return 'volume';
  return 'battery';
}

function labelOf(item: ReadyItem, t: TFn): string {
  if (item.key === 'battery') return t('partner.ready_battery', { percent: pct(item.percent ?? 0) });
  return t(`partner.ready_${item.key}` as `partner.ready_${Exclude<ReadyKey, 'battery'>}`);
}

/**
 * "جاهز تستلم طلبات" above the start slide (UI/UX audit S-8, every shift; dashboard idea h6): when all is
 * well, one quiet line «كلشي جاهز: GPS، النت، الصوت · 82%»; when something isn't, four big chips — GPS ·
 * النت · الصوت · البطارية — with only the bad ones in colour (never a ✓ glyph: IBM Plex Sans Arabic has
 * none). The whole row is one 44-px+ target: it opens a sheet where every item that needs a look says
 * why in a sentence and carries its fix (allow location, open settings, play the sound).
 */
export function ReadinessRow({ enabled = true }: { enabled?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const r = useReadiness(enabled);
  const [open, setOpen] = useState(false);
  const ok = r.issues === 0;
  const title = ok ? t('partner.ready_title') : t(pluralKey('partner.ready_issues', r.issues), { n: r.issues });
  const spoken = r.items.map((i) => t(i.tone === 'ok' ? 'partner.ready_ok_a11y' : 'partner.ready_bad_a11y', { item: labelOf(i, t) })).join('، ');
  // h6: all good = one quiet line; anything wrong = the four chips, only the bad ones in colour.
  const open_ = () => {
    theme.haptic('selection');
    r.recheck();
    setOpen(true);
  };
  const battery = r.items.find((i) => i.key === 'battery');
  return (
    <>
      <Pressable
        testID="readiness"
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${spoken}`}
        onPress={open_}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', borderRadius: theme.radius.lg, opacity: pressed ? 0.8 : 1 })}
      >
        {ok ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[1] }}>
            <Icon name="check" size={18} color="successText" strokeWidth={2.6} />
            <Text testID="readiness-title" variant="footnote" weight={600} color="text" style={{ flex: 1 }}>
              {t('partner.ready_all_ok')}
            </Text>
            {battery?.percent != null ? (
              <Text variant="footnote" weight={600} color="textMuted" tabular>
                {pct(battery.percent)}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: theme.space[2] }}>
            <Text testID="readiness-title" variant="label" weight={700} color="warningText">
              {title}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
              {r.items.map((i) => (
                <View
                  key={i.key}
                  testID={`ready-${i.key}`}
                  style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 14, backgroundColor: theme.colors[TONE[i.tone].bg], borderWidth: i.tone === 'ok' ? 0 : 1.5, borderColor: theme.colors[TONE[i.tone].fg] }}
                >
                  <Icon name={iconOf(i)} size={18} color={TONE[i.tone].fg} strokeWidth={2.2} />
                  <Text variant="caption" weight={700} color={TONE[i.tone].fg} tabular numberOfLines={1}>
                    {i.key === 'battery' ? pct(i.percent ?? 0) : t(`partner.ready_chip_${i.key}` as `partner.ready_chip_${Exclude<ReadyKey, 'battery'>}`)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </Pressable>
      <ReadinessSheet visible={open} onClose={() => setOpen(false)} title={title} items={r.items} onFixed={r.recheck} setGps={r.setGps} setSound={r.setSound} />
    </>
  );
}

function ReadinessSheet({
  visible,
  onClose,
  title,
  items,
  onFixed,
  setGps,
  setSound,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: ReadyItem[];
  onFixed: () => void;
  setGps: ReturnType<typeof useReadiness>['setGps'];
  setSound: ReturnType<typeof useReadiness>['setSound'];
}) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<ReadyKey | null>(null);
  const sorted = [...items].sort((a, b) => rank(b.tone) - rank(a.tone));
  const fix = async (item: ReadyItem) => {
    setBusy(item.key);
    try {
      if (item.fix === 'gps') setGps(await askGps());
      else if (item.fix === 'settings') await openSettings();
      else if (item.fix === 'sound') {
        const played = await playTestSound();
        if (!played) toast.show({ message: t('partner.test_sound_blocked'), tone: 'warning' });
        else setSound('ready');
      }
      onFixed();
    } finally {
      setBusy(null);
    }
  };
  return (
    <ModalSheet visible={visible} onClose={onClose} title={title} testID="readiness-sheet">
      <View style={{ gap: theme.space[3] }}>
        {sorted.map((i) => (
          <View key={i.key} testID={`ready-row-${i.key}`} style={{ flexDirection: 'row', alignItems: i.problem ? 'flex-start' : 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: i.tone === 'ok' ? theme.colors.surfaceSunken : theme.colors[TONE[i.tone].bg] }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={iconOf(i)} size={18} color={TONE[i.tone].fg} />
            </View>
            <View style={{ flex: 1, gap: theme.space[2] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Text variant="label" weight={600} style={{ flex: 1 }}>
                  {labelOf(i, t)}
                </Text>
                {i.tone === 'ok' ? <Icon name="check" size={18} color="successText" strokeWidth={2.6} /> : null}
              </View>
              {i.problem ? (
                <Text variant="footnote" color={TONE[i.tone].fg}>
                  {t(i.problem, { percent: pct(i.percent ?? 0) })}
                </Text>
              ) : null}
              {i.fix && i.tone !== 'ok' ? (
                <Button
                  testID={`ready-fix-${i.key}`}
                  size="sm"
                  variant={i.tone === 'bad' ? 'primary' : 'secondary'}
                  label={t(i.fix === 'gps' ? 'partner.ready_fix_gps' : i.fix === 'settings' ? 'partner.ready_fix_settings' : i.fix === 'sound' ? 'partner.ready_fix_sound' : 'partner.ready_fix_retry')}
                  icon={i.fix === 'sound' ? 'volume' : i.fix === 'gps' ? 'location-arrow' : i.fix === 'retry' ? 'refresh' : undefined}
                  loading={busy === i.key}
                  onPress={() => void fix(i)}
                  style={{ alignSelf: 'flex-start', minHeight: 44 }}
                />
              ) : null}
            </View>
          </View>
        ))}
        <Button testID="readiness-close" label={t('partner.ready_fix_ok')} variant="secondary" fullWidth onPress={onClose} />
      </View>
    </ModalSheet>
  );
}

function rank(tone: ReadyTone): number {
  return tone === 'bad' ? 2 : tone === 'warn' ? 1 : 0;
}
