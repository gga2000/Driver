import { View } from 'react-native';
import { useTheme } from '@driver/ui';
import { budgetBar } from './family';

/**
 * A bullet bar (audit S-4, dataviz): one hue for what was spent, the budget as the end of the track
 * and an ink tick at it; labels stay in text beside it, never only in the colour. No budget: no bar.
 */
export function BudgetBar({ spentIqd, budgetIqd, testID }: { spentIqd: number; budgetIqd: number | null; testID?: string }) {
  const theme = useTheme();
  const bar = budgetBar(spentIqd, budgetIqd);
  if (!bar) return null;
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 10, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden', justifyContent: 'center' }}
    >
      <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, width: `${Math.round(bar.fraction * 100)}%`, backgroundColor: bar.over ? theme.colors.warning : theme.colors.accent, borderRadius: theme.radius.pill }} />
      <View style={{ position: 'absolute', top: 0, bottom: 0, end: 0, width: 2, backgroundColor: theme.colors.text }} />
    </View>
  );
}
