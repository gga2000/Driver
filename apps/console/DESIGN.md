# Driver Console design guide

The Console is where dispatchers, support agents and finance staff spend 14-hour shifts. This guide
covers the look, the tokens, the components and the page patterns. If you're building a Console
page, read it first, then open `/design` in the studio. That page shows every component in every
state, in both themes.

## Direction: a working ledger under one lamp

The Console looks like the paperwork of a small-town dispatch room. The canvas is warm cream paper,
work sits on white sheets, everything is written in ink, and one orange lamp (the brand accent) is
switched on only where something needs a hand. Most of the screen stays quiet. Colour turns up only
when it means something: late, money, selected, safety. Hierarchy comes from type, rules and white
space, not from more boxes.

The one bold element is the **SLA fuse** on the support desk: a small ring that burns down across the
same-day window, with the time left in words beside it ("باقي 2 س 30 د", "متأخرة 20 س"). Everything
around it stays calm.

The dark theme is for night shifts and the metrics wall. It is built from the same tokens, not a
separate palette.

## Tokens: where colour comes from

| Layer | File | What it holds |
|---|---|---|
| Brand tokens | `packages/design-tokens/src/tokens.ts` | `color.*` scales and `themes.light` / `themes.dark` roles (brand spec 2026-10-03) |
| Console palette | `src/theme/palette.ts` | Console roles, each a token value or a `mix()` of two token values, plus `CONSOLE_PAIRS` (every fg/bg pair the Console draws) |
| CSS variables | `themeCss()`, inlined by `src/app/layout.tsx` | `--c-<role>` as RGB channels on `:root` (light) and `[data-theme=dark]` |
| Tailwind | `tailwind.config.ts` | Only the roles: `bg-surface`, `text-muted`, `border-line-strong`, `bg-accent/10`… Raw scales (`danger-500`) are not exposed |

The roles:

| Role | Light | Use |
|---|---|---|
| `canvas` | cream `#FBF6EE` | the page |
| `sidebar` | a shade deeper | the nav rail |
| `surface` | white | cards, panes, tables |
| `surface-2` / `surface-3` | warm wells | hover, zebra / tracks, skeletons, pressed |
| `raised` | white | dialogs, popovers, palette |
| `line` / `line-strong` | rules / control edges | `line-strong` is at least 3:1 on every surface (WCAG 1.4.11) |
| `text` / `muted` / `faint` | ink `#1F1A14` / `#6B6157` / mixed | `faint` is still at least 4.5:1 |
| `accent` | orange `#E08A1E` | **fills only**: primary button, selected bar, current step. Text on it is ink (`on-accent`) |
| `accent-text` | rust `#9A5200` | orange as *text*: links, selected counts, totals |
| `accent-tint` / `accent-wash` | pale oranges | selected pill, nav / selected row |
| `ok` `warn` `bad` `info` | token `*Text` shades | status text and small marks (text-safe) |
| `*-solid` / `*-tint` | token fills / tints | dots, bars, meters / pills, banners |
| `note` / `note-line` | pale amber | internal notes in the support thread |
| `inverse` / `on-inverse` | ink / cream | tooltips, toasts |
| `focus` | rust | the focus ring, 2 px outline + 2 px offset |

Rules:

- **No raw colours in `apps/console/src`.** `src/theme/no-raw-colors.test.ts` fails on any hex,
  `rgb()`/`hsl()` literal or `bg-[#…]`. Need a new colour? Add a role to `palette.ts` (from tokens),
  then add its pairs to `CONSOLE_PAIRS`.
- **Contrast is tested, not eyeballed.** `src/theme/palette.test.ts` reads the generated CSS back
  and checks every pair in both themes (text at least 4.5:1, non-text at least 3:1).
- **Orange is never text.** `#E08A1E` on white is 2.68:1. Use `text-accent-text` (rust).
- **Islands.** Any subtree can set `data-theme="dark"` or `"light"`. The wall is a dark island. The
  banner preview on /controls is a light island, because it shows the customer app.

## Type

IBM Plex Sans Arabic (400/500/600/700), loaded from `@fontsource/ibm-plex-sans-arabic`, the same
files the apps' web builds use. The Console uses no other family and no monospace "data" face.

| Class | Size / line | Use |
|---|---|---|
| `text-2xl` bold | 24 / 36 | page title (one per page) |
| `text-lg` semibold | 17 / 28 | ticket subject, dialog title |
| `text-[15px]` semibold | 15 / 24 | section title (`SectionHeader`) |
| `text-base` | 15 / 25 | conversation body |
| `text-sm` | 14 / 22 | UI default |
| `text-dense` | 13 / 21 | tables, queues, meta |
| `text-xs` | 12 / 20 | timestamps, hints. Never smaller, except kbd caps and `sm` chips at 11 |

Arabic needs taller leading than Latin (dots and descenders). Every size here carries about 1.6×.

Numbers: Western digits. Add `.num` (tabular) to every number that sits in a column or ticks.
Amounts read "12,500 دينار" (`formatMoney`). IDs, phones and order numbers go inside `<bdi>` or
`.ltr`, so "#1284" keeps its # in front. Durations read "2 س 30 د" (`compactDuration`), never "2:30".

## Spacing, radius, elevation, motion

- Spacing is the token scale of 4. Pages pad 32 px (desktop); cards pad 20 px; table rows use
  `--row-y` and `--row-x`, which the **compact** density setting tightens.
- Radius carries hierarchy: controls `md` 10 px, cards `lg` 14 px, dialogs `xl` 20 px, pills `pill`.
- Elevation: cards get `shadow-card` (1 px, warm). Popovers get `shadow-pop`. Dialogs, the palette
  and toasts get `shadow-overlay`. Shadows are warm brown, never grey.
- Motion uses the tokens' durations and easings: pop-in for overlays, sheet-in for side sheets. The
  only ambient motion is the live dot's pulse and the current timeline step.
  `prefers-reduced-motion` turns it all off.

## Shell

- **Sidebar** sits on the start edge (right), 248 px, and collapses to a 68 px icon rail (on the
  support desk below 1440 px it collapses by itself). Groups: العمليات (الخريطة، التوزيع، الطلبات،
  السواق) · الخدمة (الدعم، الموافقات) · الفلوس (الكاش الليلي، التسعير) · النظام (التحكّم، شاشة
  الإطلاق، النظام). Items are filtered by role (`visibleNav`, K-08). Live badges come from
  `useNavCounts`: needs-dispatcher, open tickets (red when one is overdue) and approvals. The
  selected item is a white tab with an orange bar and a rust icon. On the desk, الدعم expands to its
  smart views.
- **Top bar** (56 px) holds global search (opens the palette), the API connection, density and theme
  toggles, and the signed-in person with their role. Below 1024 px the pages scroll as a strip.
- **Command palette** opens with ⌘K / Ctrl+K or "/". It takes order numbers ("1284", "#1284",
  "١٢٨٤" through `orders.search`), drivers and restaurants by name (spelling-folded by
  `lib/command.ts`), pages and actions.
- **Keys**: "?" opens the sheet with every key, and `g` + letter jumps to a page. Bindings use the
  physical key, so they work on an Arabic layout (`lib/hotkeys.ts`).

## Components (`src/components/ui`)

| Component | Notes |
|---|---|
| `Button` | `primary` (one per view), `secondary`, `ghost`, `danger`, `danger-soft` · `sm/md/lg` · `loading` · `kbd` hint · `aria-pressed` toggles get a wash and weight |
| `IconButton` | needs `label` (the accessible name and the tooltip) |
| `Chip` / `Badge` | tones `neutral live ready done warn bad accent`, optional `dot`. Always words, never colour alone |
| `CountBadge`, `StatusDot` | nav counts, live dots |
| `Card`, `SectionHeader`, `PageHeader`, `Row`, `Divider` | inside a card, separate sections with a hairline, not another card |
| `Stat`, `StatStrip`, `Delta`, `Sparkline`, `Meter` | delta carries ▲/▼ plus colour; a meter's cap state goes in words beside it |
| `DataTable` (+ `thCls`/`tdCls`/`trCls`) | sticky header, hover, selection, skeleton rows, empty state, numeric end-aligned |
| `Tabs`, `Segmented` | radio-like keyboard; in RTL the right arrow goes back |
| `Input`, `Textarea`, `Select`, `Checkbox`, `Combobox`, `Field` | `aria-invalid` red edge plus the error in words |
| `Switch` | `role="switch"`, `on` = running; it only asks (`onToggle`), the page confirms and the server flips it. The state goes in words beside it |
| `Dialog`, `Sheet`, `Drawer`, `Popover` | native `<dialog>` for modals (focus trap, Esc); the sheet comes in from the end edge |
| `ToastProvider` / `useToast`, `ToastCard` | the toast uses the action's own word: "انرسل الرد", "تعوّض 2,000 دينار" |
| `Tooltip`, `Avatar`, `Timeline`, `Kbd`, `KeyboardHint`, `EmptyState`, `Skeleton` | |
| `LiveBadge`, `NetworkBanner`, `QueryError`, `NeedLogin` | honest live, stale, down and error states (K-06) |
| Icons (`Icon*`) | 20-px grid, 1.6 stroke, drawn for RTL (back points right, send points left) |

## Page patterns

1. **Header**: `PageHeader` with the title, one line of what the page is for, then the live badge and
   at most one primary action on the end side.
2. **Numbers first, then the work**: a `StatStrip` of up to 6 tiles, then the list or board people
   act on. Engineering metrics belong on /system.
3. **Lists**: `DataTable`, or a two-line list (subject, then who · what · when) with the status at the
   end edge. Problems sort first. "#1284" and names, never raw ids. Ids are one hover (title) or one
   click (copy) away.
4. **Detail**: master/detail. The list stays mounted and the detail changes with the route (see
   `app/support/layout.tsx`).
5. **Actions**: calm buttons grouped in one place. Each opens a dialog that says what will happen, in
   a sentence, before the button that does it. Money is always computed on the server; the client
   only shows limits.
6. **States**: every page has loading (skeleton), empty (what + why + what next), error (Arabic
   message + retry), offline (`NetworkBanner`) and signed-out (`NeedLogin`) states.

### The support desk (reference implementation)

`src/components/support/`: `desk.tsx` (data, keys, layout), `queue.tsx`, `conversation.tsx` (thread,
order chats, composer, "/" picker), `context.tsx` (customer, actions, order, ledger), `actions.tsx`
(refund / fault / escalate / resolve dialogs), `new-ticket.tsx`, `sla.tsx`.

- Three panes: queue 340 px · conversation · context 320 px. Below 1200 px the context moves into a
  sheet. Below 768 px it's one pane at a time.
- Smart views: المفتوحة، لي، غير مستلمة، فات موعدها، نزاعات، مصعّدة، بانتظار الزبون، محلولة
  (`lib/support-views.ts`, keys 1–8). Unread markers are kept per browser.
- Thread: the customer sits on the start side on white, our replies on the end side on the accent
  tint, internal notes are amber sticky notes with a lock, and actions are quiet centred event lines.
- Composer: R reply / N note, "/" opens canned replies (the suggested one first), ⌘/Ctrl+Enter sends.
  A canned reply with an action pre-fills the matching dialog; it never fires it.
- Keys: J/K move, E resolves, R/N focus the composer.
- Reads: `support.list/get/customer` (`customer` is additive: first name via a logged vault read,
  orders, lifetime value, refunds, other tickets).

### The control room (Controls, Approvals, Finance, Wall, Pricing, System, Login)

- **/controls** is a breaker panel. Top to bottom: four stats, **الموقّف هسة** (every switch that is
  on, with the reason, who, "يرجع وحده الساعة …" and the exact line customers see), the city-wide
  services as big `Switch`es (`ui/switch.tsx`: `on` = running, the knob and the word say it, colour
  is never alone), the **zones × services matrix** (one row per zone: live load meter that opens the
  cap dialog, then a cell per service; a cell is `on`, `off` here, or inherited from the whole zone
  or the whole city, `matrixCell()` in `lib/control-room.ts`; only zones that need eyes show until
  "كل المناطق"), restaurants, the status banner composer with a live phone preview per app (light
  islands), then **طريقة التوزيع** (moved from /dispatch, K-14) and the control log in sentences.
- Nothing flips on click. A switch, cell, cap or dispatch mode opens a dialog that names the action
  in its button ("وقّف تكسي بشارع 30", "غيّره إلى تلقائي"). The stop dialog shows the customer's
  phone with the refusal, and the message follows the end time ("لحد الساعة 11:30 م", rounded up to
  5 minutes) until the person writes their own (K-13). The API's fallback copy says the same.
- **/approvals** reviews one item at a time: the queue on the start side, the item with its photo
  (side by side with the comparison, or wide with the facts beside it when there is nothing to
  compare, K-20), and a sticky decision bar. Keys: A approve, X reject (needs a reason), 1–4 quick
  reasons, J/K next/previous. "g a" never approves. Document expiry is picked as "بعد سنة / سنتين / 3
  سنين" and read back as "4 تشرين الأول 2027" (K-15).
- **/finance** says money in words (K-16): "بيده 48,000 دينار", "لازم يسلّم 52,000 دينار", "له 2,000
  دينار", "للمطعم 120,000 دينار". The ledger check is a calm hero (check icon, "الدفتر متوازن", each
  net as "ماكو فرق"). Courier cash against the cap uses the money spec's thresholds (amber from 70 %,
  red from 90 %, ticks on the meter, the level in words beside it). The 23:00 round is a numbered
  list beside a light map cropped to the route (`round-map.tsx`, theme roles only). One "صدّر CSV" menu.
- **/wall** is built for a TV at 1920×1080 and fits without scrolling: dark island (`?theme=light`
  for a bright room, `?tv=1` hides the way back), six tiles with the status as icon + words + a
  bullet bar to the playbook target, orders per day as emphasis bars (today orange, the rest ink)
  with the 30-a-day line, and a red line across the top once it hasn't updated for 2 minutes. Status
  colours (green/red) fail the CVD check against each other (dataviz validator, ΔE 5.2 deutan), so
  they always travel with an icon and a word.

## Copy

Iraqi Arabic from `packages/i18n` (`console.*`). Follow the voice guide: الدليفري for food couriers,
"دينار" after amounts, Western digits, no "إن شاء الله" in times. Buttons are verbs ("عوّض 2,000
دينار", "حلّها"). Each confirmation repeats the verb of its action. Errors say what happened and what
to do next.

Exception: the `/design` reference page hard-codes sample content as fixtures. It is not product copy.

### Dispatch and the live map (wave 2)

`src/components/dispatch-page.tsx` + `dispatch/` (`triage-bar.tsx`, `queue.tsx`, `assign.tsx`,
`sound.ts`), `map-page.tsx`, the shared canvas `live-map-canvas.tsx` and `map-cards.tsx`. Pure parts:
`lib/dispatch.ts` (queue order, candidate ranking, wave history, the key reducer), `lib/map-labels.ts`
(label placement, order-tag stacking), `lib/live-map.ts` (GeoJSON, filters, order tags).

- **Full bleed**: both pages fill the height (like the desk). Map on the start side (two-thirds),
  queue 400–440 px on the end side. They show the network banner themselves.
- **Triage bar**: the one loud block is "27 يحتاجون موزّع · أقدم واحد من 5:26" with **خذه (A)**; then
  five quiet numbers on hairlines (طلبات بالساعة، سواق أونلاين، وقت القبول، متأخرة، كاش بالميدان). The
  rest sits behind "تفاصيل", which also links to the dispatch modes. Sound is on by default (two
  tones when the count rises), with a visible mute (M) that the browser remembers.
- **Queue**: يحتاج موزّع, معروض, يبحث, مُعيَّن (collapsed). A card is "#1284 مطعم خالد" and the wait
  on the end side (amber after 3 min, red when it needs a hand), then vertical · zone · wave pips
  ("جولة 3 · 2 ما قبلوا"). The selected card opens in place with its five best drivers.
- **Candidates**: ranked by the spec weights (distance 40, tier 30, load 20, vehicle fit 10), the
  ones that need force (over cap, offline, wrong vehicle) last and in words. Each row: key cap, state
  shape, name · vehicle · plate, km and minutes to the pickup, cash against the cap. The same numbers
  1–5 appear on the drivers on the map. 1–5 picks, Enter sends ("دز العرض لحيدر ج."); a forced one
  asks for the reason first. Drag a card onto a driver on the map to pick him.
- **Dispatch modes** moved to /controls (`dispatch-modes.tsx`, `#dispatch-modes`): each change asks
  first, in a sentence that says what will happen.
- **Map**: the `@driver/map` style with `zoneShading: 'sequential'`: the tier bands as one sepia ink
  ramp (light → dark outwards on cream, the reverse at night), split by paper-coloured hairlines.
  Driver state is shape + colour (`lib/marker-shapes.ts`): dot free, ring offered, square on a job,
  cross over the cap, dashed hollow offline. Waiting orders are tags at the kitchen ("#4816 +3");
  tags that overlap fold into the most urgent one. Labels (garages, zones from zoom 12, names of the
  drivers that matter) are placed greedily without collisions; digits are Western.
- **Map page**: state chips (shape, word, count) and service chips filter the map and the side list;
  hover a marker for name, vehicle and plate, job and cash; click opens the drawer; F follows a
  driver until you drag the map or press Esc.

## Wave 2

- **/dispatch, /map**: done (above). Still open: S-K1's sticky triage strip on every other page,
  the alert repeating until someone takes the card, and a plate for bikes (the registry has none).
- **/orders, /orders/[id]**: Arabic date ranges (K-15), status tones by phase plus a "late" column
  (K-17), the event log collapsed into a story (K-22). Move to `DataTable`.
- **/drivers, ledger**: name search (needs a names-aware roster read), and words instead of signs
  (K-16).
- **/controls, /approvals, /finance, /wall**: done (see "The control room" above): K-13, K-14 (the
  dispatch modes now live on /controls; /dispatch should drop its copy), K-15 on these pages, K-16,
  K-20, K-21.
- **Voice**: `apps/api/src/modules/support/canned.ts` still says "المندوب" in customer-facing replies
  (K-12).
