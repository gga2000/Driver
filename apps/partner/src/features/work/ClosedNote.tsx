import { useTheme } from '@driver/ui';
import { SlipNote } from '@/features/offer/SlipParts';
import { closedLine, type CourierClosure } from '@/features/map/closed';
import { useT } from '@/lib/i18n';

/**
 * N20: one warning line when the road goes around a street closed today («شارع المستشفى مسدود اليوم، طريقك
 * دار حوله (+3 دقيقة)»), in the warning tint, never red. Nothing when the road bends round nothing. It
 * slides in once when it arrives (none under reduce motion).
 */
export function ClosedNote({ testID, closures }: { testID: string; closures: readonly CourierClosure[] | null | undefined }) {
  const theme = useTheme();
  const t = useT();
  const line = closedLine(closures);
  if (!line) return null;
  return <SlipNote testID={testID} icon="swap" title={t(line.key, line.params)} bg={theme.colors.warningTint} ink={theme.colors.warningText} />;
}
