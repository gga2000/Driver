import type { ReactNode } from 'react';
import { View } from 'react-native';
import { t } from '@driver/i18n';
import { RollingDigits } from '../components/RollingDigits';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeProvider';
import { panelMinutes } from './logic';
import { HomePress } from './media';
import { GUARD_MS, homeSize } from './format';
import { countWord, useHomeLook } from './look';

/** The pieces every panel under the map shares: the forest shell, its heading, the big minutes and the round button. */

/** Big minutes in orange with the word beside them: «12 دقيقة», «5 دقايق». */
export function BigMinutes({ n, size = 'numeralMd', rough, testID }: { n: number; size?: 'numeralMd' | 'numeralSm'; /** Offline: an estimate, in cream, with «تقريباً». */ rough?: boolean; testID?: string }) {
  const theme = useTheme();
  const m = panelMinutes(n);
  const look = useHomeLook();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[1] }}>
      {rough ? (
        <Text variant="label" color={look.panel.muted} compact>
          {t('home.panel.about')}
        </Text>
      ) : null}
      <RollingDigits value={String(m)} variant={size} face="display" color={rough ? look.panel.muted : look.panel.accent} testID={testID} />
      <Text variant="label" weight={600} color={look.panel.muted} compact>
        {countWord(m, 'home.unit.minute')}
      </Text>
    </View>
  );
}

/** The forest panel. `band` sits edge to edge above the padded body (the late band), so nothing relies on negative margins. */
export function PanelShell({ children, band, testID, tight }: { children: ReactNode; band?: ReactNode; testID?: string; tight?: boolean }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <View testID={testID} style={{ backgroundColor: look.panel.fill, borderTopWidth: look.panel.edge ? 1 : 0, borderTopColor: look.panel.edge ?? undefined }}>
      {band}
      <View style={{ padding: theme.space[4], paddingVertical: tight ? theme.space[3] : theme.space[4], gap: tight ? theme.space[2] : theme.space[3] }}>{children}</View>
    </View>
  );
}

export function Heading({ over, title, live }: { over?: string; title: string; live?: boolean }) {
  const look = useHomeLook();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {over ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: homeSize.gapTight }}>
          {live ? <View style={{ width: homeSize.dot, height: homeSize.dot, borderRadius: homeSize.dot / 2, backgroundColor: look.live }} /> : null}
          <Text variant="footnote" color={look.panel.muted} numberOfLines={1}>
            {over}
          </Text>
        </View>
      ) : null}
      <Text variant="title" face="display" color={look.panel.on} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

/**
 * A full-width round button on the forest: `accent` (orange) for the one next step on a screen, `light`
 * (cream with forest text) when the orange already lives elsewhere on the screen (the food tile), and
 * `quiet` (raised forest) for the second choice.
 */
export function PanelButton({ label, a11y, onPress, tone, testID }: { label: string; a11y?: string; onPress: () => void; tone: 'accent' | 'light' | 'quiet'; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  const filled = tone !== 'quiet';
  const bg = tone === 'accent' ? look.panel.accent : tone === 'light' ? look.panel.on : look.panel.raised;
  const fg = tone === 'accent' ? look.panel.onAccent : tone === 'light' ? look.panel.fill : look.panel.on;
  return (
    <HomePress
      onPress={onPress}
      haptic={filled ? 'light' : 'secondary'}
      guardMs={GUARD_MS}
      accessibilityLabel={a11y ?? label}
      testID={testID}
      style={{ minHeight: homeSize.button, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space[5], backgroundColor: bg }}
    >
      <Text variant="bodyStrong" face="display" color={fg} compact numberOfLines={1}>
        {label}
      </Text>
    </HomePress>
  );
}
