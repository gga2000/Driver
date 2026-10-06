/**
 * Joy J4: a kitchen closed outside its hours shows the night-market drawing (a crescent over the
 * shuttered market) only when it is actually evening or night on the phone; by day, and for a paused
 * kitchen, the card keeps its clock icon. A crescent at ten in the morning would be a lie.
 */
export const NIGHT_FROM_HOUR = 19;
export const NIGHT_UNTIL_HOUR = 6;

export function closedArt(closedReason: string | null | undefined, now: Date): 'night' | 'clock' {
  if (closedReason === 'paused') return 'clock';
  const h = now.getHours();
  return h >= NIGHT_FROM_HOUR || h < NIGHT_UNTIL_HOUR ? 'night' : 'clock';
}
