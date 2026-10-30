import { Text, useTheme } from '@driver/ui';

/** The map's credit (maps program f12): our tiles carry OpenStreetMap streets and Overture's buildings and places. */
// Isolated left-to-right so «©» stays in front inside the right-to-left screen.
export const LIVE_MAP_CREDIT = '⁦© OpenStreetMap · Overture Maps⁩';

/** Small and quiet, just above the bottom cards, on the side away from the slide's thumb. */
export function LiveCredit({ bottom }: { bottom: number }) {
  const theme = useTheme();
  return (
    <Text pointerEvents="none" variant="caption" color="textMuted" style={{ position: 'absolute', end: theme.space[3], bottom: bottom + theme.space[1], fontSize: 10, lineHeight: 14, opacity: 0.8 }}>
      {LIVE_MAP_CREDIT}
    </Text>
  );
}
