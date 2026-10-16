/**
 * «الكاونتر» (merchant redesign step 1, Ali 2026-10-07): the counter's own colours, Date & Saffron
 * pushed darker so a tablet reads in the sun. Merchant-only on purpose: the shared tokens in
 * @driver/design-tokens belong to the customer home work, so the counter keeps its few extra
 * colours here and uses the theme for everything else (buttons, sheets, text roles).
 *
 * One job per colour: saffron = a new order that needs you, green = ready, red = allergy or late,
 * gold = busy mode, date brown = the status bar and quiet labels, cardamom olive = a drink on a
 * ticket, rose = a sweet on a ticket (j6). No blue or teal anywhere.
 */
export const COUNTER = {
  /** Status bar, count badges for the cooking lane, quiet labels. */
  date: '#2A170C',
  /** A lifted surface on the date bar (store tile, neutral chips). */
  dateRaised: '#4A2814',
  /** Text and icons on `date`. */
  onDate: '#FFF3E2',
  /** Secondary text on `date`. */
  onDateMuted: '#E9CFAF',
  /** A chip or button outline on `date`. */
  dateEdge: '#7A5A44',
  /** Ticket paper: warmer than the white surface, matches the printed 80 mm ticket. */
  paper: '#FFFDF8',
  /** Behind the tickets, per lane (tablet). */
  laneNew: '#FFE9CC',
  laneCooking: '#EFE3D3',
  laneReady: '#ECEBD3',
  /** Count badge of the new lane: the dark saffron, with cream text. */
  newBadge: '#9A4A06',
  /** Ready / open: green, and its text on the date bar. */
  ready: '#23744A',
  onDateReady: '#9FE7BA',
  /** Late tickets: the whole ticket tints and gets a thick outline. */
  late: '#B8321F',
  lateWash: '#FFF0EB',
  onDateLate: '#FFB4A6',
  /** Busy mode: gold, with its text on the date bar. */
  busy: '#FFC155',
  onBusy: '#2A170C',
  /** The screen edge flashing in the middle 30 s of a new order's ring (a8); never text. */
  saffron: '#F38A1B',
  /** The bed a dish sits on in the glass display and the editor (the mockup's sand), behind drawings. */
  sand: '#F3E7D6',
  /** Quantities on a ticket: date brown, never saffron (saffron means "new"). */
  qty: '#7A3F06',
  /** «الكبنك» on المحل (step 5): the rolling shutter's warm steel, its grooves, and the lit shop behind it. */
  shutter: '#B8A690',
  shutterGroove: '#8F7D68',
  shutterBox: '#6E5B47',
  glow: '#FFE2A8',
  /** j6 colour by kind: a drink's edge and mark on a ticket (cardamom olive), and its wash. */
  kindDrink: '#5A5714',
  kindDrinkWash: '#EFECD2',
  /** j6: a sweet's edge and mark on a ticket (rose, not the late red), and its wash. */
  kindSweet: '#9A3656',
  kindSweetWash: '#F9E4EA',
} as const;

export type CounterColor = keyof typeof COUNTER;
