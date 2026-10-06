/**
 * Driver stroke icon set. 24×24 grid, drawn for 1.75 px round strokes, 2 px optical padding.
 * Directional glyphs are drawn for LTR and mirrored at render time in RTL (see `MIRRORED`).
 */

export type IconShape =
  | { d: string }
  | { circle: [cx: number, cy: number, r: number] }
  | { rect: [x: number, y: number, w: number, h: number, r: number] };

export const ICONS = {
  home: [{ d: 'M3 10.5 12 3l9 7.5' }, { d: 'M5 9v10.5a1 1 0 0 0 1 1h4V15h4v5.5h4a1 1 0 0 0 1-1V9' }],
  /** Where a ride goes (L-15): a pennant on a pole; the house is only for a saved home. */
  flag: [{ d: 'M6 21V4' }, { d: 'M6 4.5h11l-2.5 4 2.5 4H6' }],
  search: [{ circle: [11, 11, 6.5] }, { d: 'M20 20l-4.2-4.2' }],
  cart: [
    { d: 'M3 4h2.2l2.1 10.1a1.5 1.5 0 0 0 1.5 1.2h8.5a1.5 1.5 0 0 0 1.4-1.1L20.5 8H6.1' },
    { circle: [9.5, 19.25, 1.25] },
    { circle: [17, 19.25, 1.25] },
  ],
  'map-pin': [{ d: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z' }, { circle: [12, 10, 2.25] }],
  car: [
    { d: 'M3.5 17v-4l1.9-4.6A2 2 0 0 1 7.3 7h9.4a2 2 0 0 1 1.9 1.4l1.9 4.6v4a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z' },
    { d: 'M3.5 13h17' },
    { circle: [7.5, 15.5, 0.9] },
    { circle: [16.5, 15.5, 0.9] },
    { d: 'M6.5 18v2M17.5 18v2' },
  ],
  tuktuk: [
    { d: 'M4.5 16V8.5A2.5 2.5 0 0 1 7 6h7l3.6 5H20a.5.5 0 0 1 .5.5V16' },
    { d: 'M9 6v5h8.6' },
    { circle: [7, 17, 2] },
    { circle: [18, 17, 2] },
    { d: 'M9 17h7' },
  ],
  bike: [
    { circle: [5.5, 16.5, 3] },
    { circle: [18.5, 16.5, 3] },
    { d: 'M5.5 16.5 9.5 10H14l4.5 6.5' },
    { d: 'M14 10l-2-4H9.5' },
    { d: 'M9.5 10l2.5 6.5h3' },
  ],
  bag: [{ d: 'M5 8h14l-1 12.5H6L5 8z' }, { d: 'M9 8V6.5a3 3 0 0 1 6 0V8' }],
  /** Work (saved places, A-06): the bag means food everywhere else. */
  briefcase: [{ rect: [3.5, 7.5, 17, 12, 2] }, { d: 'M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5' }, { d: 'M3.5 12.5h17' }, { d: 'M11 12.5v1.5h2v-1.5' }],
  parcel: [
    { d: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z' },
    { d: 'M3.5 7.5 12 12l8.5-4.5' },
    { d: 'M12 12v9' },
    { d: 'M7.75 5.25l8.5 4.5' },
  ],
  /** A banknote: cash payments and hand-overs (same drawing as the merchant app's `cash`). */
  cash: [{ d: 'M4.5 6h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' }, { circle: [12, 12, 2.6] }, { d: 'M6 9.5v5M18 9.5v5' }],
  wallet: [
    { d: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3' },
    { d: 'M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5z' },
    { circle: [16, 13.5, 1] },
  ],
  user: [{ circle: [12, 8, 3.75] }, { d: 'M4.5 20.5a7.5 7.5 0 0 1 15 0' }],
  phone: [
    { d: 'M5 3.75h3.4l1.6 4.5-2.1 1.4a10.5 10.5 0 0 0 6.4 6.4l1.4-2.1 4.5 1.6V19a1.5 1.5 0 0 1-1.5 1.5A16.75 16.75 0 0 1 3.5 5.25 1.5 1.5 0 0 1 5 3.75z' },
  ],
  chat: [
    { d: 'M20 14.5a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5z' },
    { d: 'M8 9h8M8 12.25h5' },
  ],
  /** Chat: attach a photo. */
  camera: [
    { d: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z' },
    { circle: [12, 12.75, 3.25] },
  ],
  /** Chat: send (points along the reading direction, mirrored in RTL). */
  send: [{ d: 'M4.5 12h11' }, { d: 'M4 4.5 20 12 4 19.5l2.5-7.5z' }],
  /** Read receipt: two ticks. */
  'check-double': [{ d: 'M2.5 12.5l4.5 4.5L16.5 7.5' }, { d: 'M12 16l1 1 9.5-9.5' }],
  star: [{ d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z' }],
  clock: [{ circle: [12, 12, 8.5] }, { d: 'M12 7.5V12l3 2' }],
  check: [{ d: 'M5 12.5l4.5 4.5L19 7.5' }],
  x: [{ d: 'M6 6l12 12M18 6 6 18' }],
  'chevron-forward': [{ d: 'M9.5 5.5 16 12l-6.5 6.5' }],
  'chevron-back': [{ d: 'M14.5 5.5 8 12l6.5 6.5' }],
  'chevron-down': [{ d: 'M5.5 9.5 12 16l6.5-6.5' }],
  'arrow-forward': [{ d: 'M4 12h15M13.5 6l6 6-6 6' }],
  'arrow-back': [{ d: 'M20 12H5M10.5 6l-6 6 6 6' }],
  // Top-down car seat (matches the seat map): cushion, backrest along the rear edge.
  seat: [
    { rect: [6.5, 4, 11, 10.5, 2.5] },
    { rect: [4.5, 16, 15, 4.5, 2] },
  ],
  garage: [{ d: 'M3 21V9l9-5 9 5v12' }, { d: 'M7 21v-8.5h10V21' }, { d: 'M7 16.5h10' }],
  shield: [{ d: 'M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z' }, { d: 'M9 12l2.2 2.2L15.5 10' }],
  sos: [
    { d: 'M6.5 18v-4.5a5.5 5.5 0 0 1 11 0V18' },
    { rect: [4, 18, 16, 3, 1] },
    { d: 'M12 3v2M4.6 6.1l1.4 1.4M19.4 6.1 18 7.5' },
    { d: 'M12 13.5V16' },
  ],
  gift: [
    { rect: [4, 9.5, 16, 3.5, 1] },
    { d: 'M5.5 13v7.5h13V13' },
    { d: 'M12 9.5v11' },
    { d: 'M12 9.5c-1-2.8-2.4-4.5-4-4.5a2.25 2.25 0 0 0 0 4.5M12 9.5c1-2.8 2.4-4.5 4-4.5a2.25 2.25 0 0 1 0 4.5' },
  ],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  minus: [{ d: 'M5 12h14' }],
  filter: [{ d: 'M4 6.5h16M7 12h10M10 17.5h4' }],
  share: [
    { circle: [17.5, 5.5, 2.5] },
    { circle: [6.5, 12, 2.5] },
    { circle: [17.5, 18.5, 2.5] },
    { d: 'M8.7 10.8l6.6-4M8.7 13.2l6.6 4' },
  ],
  bell: [{ d: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z' }, { d: 'M10 20.5a2 2 0 0 0 4 0' }],
  volume: [{ d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z' }, { d: 'M15.5 9a4 4 0 0 1 0 6' }, { d: 'M18 6.5a7.5 7.5 0 0 1 0 11' }],
  receipt: [
    { d: 'M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z' },
    { d: 'M9 8h6M9 11.5h6M9 15h3.5' },
  ],
  'location-arrow': [{ d: 'M20 4 4 11l7 2 2 7z' }],
  mic: [{ rect: [9, 3, 6, 11, 3] }, { d: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21' }],
  wifi: [{ d: 'M2.5 9a14 14 0 0 1 19 0' }, { d: 'M5.5 12.5a9.5 9.5 0 0 1 13 0' }, { d: 'M8.6 16a5 5 0 0 1 6.8 0' }, { circle: [12, 19.25, 1] }],
  'wifi-off': [{ d: 'M3 3l18 18' }, { d: 'M2.5 9a14 14 0 0 1 4.6-3' }, { d: 'M11 5.5a14 14 0 0 1 10.5 3.5' }, { d: 'M5.5 12.5a9.5 9.5 0 0 1 4-2.3' }, { d: 'M15.5 10.8a9.5 9.5 0 0 1 3 1.7' }, { d: 'M8.6 16a5 5 0 0 1 6.8 0' }, { circle: [12, 19.25, 1] }],
  refresh: [{ d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3' }, { d: 'M19.5 4.5v4h-4' }],
  // Phase 3 (Partner readiness row): the phone's battery.
  battery: [{ rect: [2.5, 7, 16.5, 10, 2] }, { d: 'M21.5 10.5v3' }],
} satisfies Record<string, IconShape[]>;

export type IconName = keyof typeof ICONS;

/** Glyphs that point along the reading direction and flip in RTL. */
export const MIRRORED: ReadonlySet<IconName> = new Set<IconName>([
  'chevron-forward',
  'chevron-back',
  'arrow-forward',
  'arrow-back',
  'send',
]);

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
