import type { MarkerState } from '@driver/map';

/**
 * Driver state as a shape (K-09), so it never rides on colour alone: a filled dot is free, a ring is
 * offered (waiting on his answer), a square is on a job, a cross is over the cash cap, a dashed
 * hollow circle has dropped offline. 24-px viewBox SVG markup; the colours are theme roles in
 * globals.css (`.ops-pin` on the map, `.ops-glyph` in legends and chips).
 */
export const MARKER_SHAPES: Readonly<Record<MarkerState, string>> = {
  free: '<circle cx="12" cy="12" r="7" class="s-fill s-free"/>',
  offered: '<circle cx="12" cy="12" r="8.6" class="s-paper"/><circle cx="12" cy="12" r="6" class="s-ring"/>',
  on_job: '<rect x="5" y="5" width="14" height="14" rx="3.2" class="s-fill s-on_job"/>',
  over_cap: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9" class="s-cross-halo"/><path d="M7.5 7.5l9 9M16.5 7.5l-9 9" class="s-cross"/>',
  offline: '<circle cx="12" cy="12" r="6.5" class="s-dash"/>',
};
