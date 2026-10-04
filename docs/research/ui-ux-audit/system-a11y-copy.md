# UI/UX audit: design system, accessibility, motion and copy (all apps)

Date: 2026-10-04 · Base commit: `2874b7f` · Owner: cross-cutting audit (system, accessibility, motion, copy, perceived performance)

Scope: `packages/design-tokens`, `packages/ui` (24 components and the gallery), `packages/i18n`
(3,473 shared keys) and `apps/merchant/locales` (833 keys), the API's user-facing error copy, and how
Driver (customer), Driver Partner, Driver Merchant and the Console use all of these. Screen-by-screen
journeys belong to the per-app audits; this report covers what is shared or should be.

Benchmarks: Uber Base, Airbnb DLS, Material 3, Apple HIG, and the Arabic RTL quality bar set by
Careem and Talabat.

## How this was measured

Every number below comes from a script run on `2874b7f`. The scripts are saved next to the captures
in `scratchpad/audit/system/`:

| Script | What it measures |
|---|---|
| `inventory.mjs` | Hard-coded colours, sizes, radii, spacing, shadows, durations; physical left/right; Pressable roles and labels; spinners, skeletons, haptics, animation calls; Arabic literals in code |
| `pressables.mjs` | Every `Pressable` / `AnimatedPressable` in the three Expo apps: role, label, visible text, icon-only |
| `dupes.mjs` | Files repeated across apps with their line overlap |
| `contrast.mjs` | WCAG ratios for every token pair the code draws, including non-text pairs (WCAG 1.4.11) and the Console palette |
| `copy.mjs` | MSA markers, term variants, digits, currency, punctuation, long strings, placeholder parity, across both locale files |
| `a11y-probe.mjs` | On a running page: axe-core 4.13 (WCAG 2.2 AA plus best practice), tap-target sizes, a keyboard Tab walk, and a simulated large-text pass (all text ×1.6, the way iOS "Larger Text" grows text but not fixed-height boxes) |

The probe ran on the `@driver/ui` gallery (390 px). It could not run on the Expo apps' web
exports from this worktree: Metro's `blockList` ignores any path containing `.claude`, and agent
worktrees live under `.claude/worktrees/`, so `expo export` cannot resolve the entry. App-level
evidence comes from earlier screenshot sets (`scratchpad/shots/`) and the source.

---

## 1. Scorecards

Scores are 0–10. The target is where the system should be before public launch.

| Area | Score | Target | Why this score |
|---|---|---|---|
| Token adherence | 7 | 9 | The token package is strong: two themes, semantic roles, a contrast test, warm elevation, motion springs. The apps then bypass it in 793 places: 256 raw radii (30 different values), 288 raw spacing values, 71 raw font sizes (19 different sizes), 79 raw shadow props, 40 hex colours. The Console runs its own palette. |
| Component coverage | 6 | 9 | 24 shared components with good states. About 4,000 lines of near-identical UI and app plumbing are copied across apps in 28 file families (chat ×3, OTP input ×3, sheets ×4, tab bar ×2, icons ×4). Missing: modal sheet, confirm dialog, switch, offline banner, progress meter, display numerals. |
| Consistency across apps | 5 | 8 | The three Expo apps look like one family. The Console does not: a different orange, different status colours, Latin type metrics, no IBM Plex. Six clock formatters disagree on time zone and on morning/evening. The merchant app has three names. |
| Accessibility (WCAG 2.2 AA) | 6 | 9 | Labelling is excellent: 126 of 130 app pressables have a role and none of the icon-only ones lacks a label. Text contrast is CI-tested and passes. Failing: non-text contrast (fields, focus, selected states), the Console's secondary text, web focus and tap targets, large-text clipping, modal semantics, text at 10–11 px. |
| Motion | 6 | 8 | Good token base (durations, curves, four springs) and reduce-motion handling in `@driver/ui` and Partner. The customer app animates with its own durations and springs. Toasts have no exit. There is no sound on native for the two moments that need it most. |
| Arabic typography | 7 | 9 | IBM Plex Sans Arabic, Arabic-height line spacing (×1.65), tabular numerals, Western digits everywhere, an `ltr()` isolate helper. Lost points: 22 places set 10–11 px text, the Console uses Latin line heights and never loads Plex, no plural forms, ad-hoc bidi isolation, and clock times with no morning/evening. |
| Copy and voice | 8 | 9 | Unusually good Iraqi voice: zero Eastern digits, zero "د.ع", Arabic punctuation everywhere, honest apologies with next steps. Drift: مندوب vs دليفري, رحلة vs مشوار for the same taxi ride, الموزّع vs الديسباتشر, about 175 error messages and the support canned replies written outside the locale files, 92 count-plus-singular-noun strings, the "د" abbreviation for minutes. |
| Resilience and perceived performance | 5 | 8 | Skeletons in all three apps (128 uses), retry on most error states. Missing: no app detects being offline, `error.offline_queued` is never used, only 2 optimistic updates, toasts with an action vanish after 3.5 s, and the native builds have no audible alarm for new orders or offers. |

### Heuristic view (system level, Nielsen 0–4)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Live pills, timelines and countdowns are strong; no offline state anywhere; silent alarms on native. |
| 2 | Match with the real world | 4 | Iraqi dialect, دينار, garages and خطوط named the way people say them. |
| 3 | User control and freedom | 3 | Undo exists in places, but action toasts expire in 3.5 s. |
| 4 | Consistency and standards | 2 | Console palette and type, six clock formats, three names for the courier, four sheet implementations. |
| 5 | Error prevention | 3 | Server-computed money, held seats and confirmations are good; 1.1:1 input boundaries hide where to type. |
| 6 | Recognition over recall | 3 | Labelled icons, reasons on every fee; ambiguous "7:30" with no morning/evening. |
| 7 | Flexibility and efficiency | 3 | Console has a designed keyboard focus ring; the RN apps on web rely on the browser default. |
| 8 | Aesthetic and minimalist design | 3 | Warm, calm, distinct from the Talabat/Careem look; spends little on brand moments beyond the wordmark. |
| 9 | Error recovery | 3 | Errors usually say what to do next; about 15 API messages do not ("محاولات كثيرة", "انتهت جلستك"). |
| 10 | Help and documentation | 2 | Gallery shows components but not usage rules, states or do/don't. |
| | **Total** | **29/40** | Solid; consistency and status visibility are the gaps. |

### What is already world-class

- **Contrast as a test, not a hope.** `contrastPairs` lists every text pair a component draws and
  `contrast.test.ts` fails CI below AA in both themes. The brand rule (ink, never white, on the
  orange) is asserted in code. Few teams do this.
- **Labelling discipline.** `IconButton` makes `accessibilityLabel` a required prop, so not one of the
  130 app pressables is an unlabelled icon. 126 have a role.
- **Numbers done right for Iraq.** One formatter family (`formatIqd`, `iqd`, `amountParam`), comma
  thousands, `دينار` after the number, U+2212 minus inside a left-to-right isolate so `−1,500` never
  splits. Zero Eastern digits in copy; Eastern digits are accepted on input and converted.
- **A voice people will recognise.** "دا يتحضّر", "وصل طلبك، صحة وعافية", "تأخرنا وهذا غلطنا" read like
  a Wasit shop, not a ministry. 350 Arabic commas, 110 Arabic question marks, zero Latin ones.

---

## 2. Findings

Severity: **P0** blocks launch or harms people; **P1** fix before launch; **P2** fix in the next
polish wave; **P3** worth doing. Effort: S ≤ ½ day, M ≤ 2 days, L > 2 days.

| ID | Sev | Where | Evidence | Why it matters | Recommendation | Effort |
|---|---|---|---|---|---|---|
| S-01 | P0 | Merchant and Partner, native | `apps/merchant/src/lib/alert-sound.native.ts`: the new-order alarm is `Vibration.vibrate(...)` only ("TODO(native-sound)"). `apps/partner/src/lib/alert.native.ts`: `playOfferChime()` is empty ("TODO(offer-sound)"). | A tablet on a kitchen counter does not feel vibration; a phone in a courier's pocket on a motorbike does not either. Missed orders auto-reject (merchant accept timer); missed offers cost the driver money and the customer time. Every benchmark app treats this as the most important sound in the product. | Add `expo-audio` (or `expo-av`) with two bundled sounds: a loud, repeating new-order chime that plays in silent mode and repeats every 10 s until acknowledged, and a short offer chime. Android: a notification channel at max importance. Add a "test sound" row in Merchant settings and Partner account. | M |
| S-02 | P1 | Console | `apps/console/src/app/globals.css` defines its own colours: accent `#f2a33a` labelled "placeholder brand amber" (brand is `#E08A1E`), success `#1f9d55` (token `#2F8F5B`), danger `#d03b3b` (token `#C2412D`), info `#4e9bc4` (token `#2F6FB0`). The comments cite token values that no longer exist (`neutral.900` is `#1F1A14`, not `#1a1917`). `themes.dark` is never used. | Ops staff see a different brand than the people they support; screenshots in support tickets don't match the Console. When the brand changes, the Console will be forgotten again. | Generate the Console's CSS variables from `@driver/design-tokens` at build time (a `console` theme in tokens, built on `themes.dark`), and delete the hand-written hexes. | M |
| S-03 | P1 | Console | Contrast (section 3): `text-faint` (55 uses) 3.22:1 on cards and 3.95:1 on the page; `text-bad` (33 uses) 2.98:1 on cards; `text-ok` (13 uses) 4.10:1 on cards; `text-muted` on `bg-surface-2` (table headers, hovers) 3.81:1; `border-line` 2.09:1. | Dispatchers read these screens for hours, often on cheap monitors in bright offices. Red "فات موعدها" and red counts at 2.98:1 are the numbers they most need. | Use the dark theme's `*Text` roles: danger text `#F2937F` (6.31:1), success text `#7ACF9D` (7.67:1), muted `#B8AA98` (6.30:1). Drop `faint` for text or raise it to ≥ 4.5:1. Borders at ≥ 3:1 where they outline inputs. | S |
| S-04 | P1 | `packages/ui` TextField, Chip, SegmentedControl, Button (secondary), ListRow, SeatMap | Non-text contrast (WCAG 1.4.11): a TextField at rest has a sunken fill and a transparent border, 1.10:1 against the screen and 1.18:1 on a card; its focus border is the orange at 2.27:1. Selected chip vs unselected: 2.68:1. Segmented thumb vs track: 1.18:1. Selected list row: 1.17:1. Taken vs free seat: 1.32:1. Secondary button outline: 2.41:1. Customer notification `Switch` off track (`border`): 1.32:1. `contrastPairs` only covers text, so CI can't see any of these. | People with low vision, and everyone outdoors at noon in Wasit, can't find the phone field or see which chip is chosen. Selected state carried only by a faint fill is the classic RTL-app failure Talabat fixed with check marks. | (1) Change `borderStrong` to `#8C7F6F` (neutral 500: 3.63:1 on cream, 3.90:1 on white) and give TextField a 1.5 px `borderStrong` border at rest. (2) Focus border in ink `#1F1A14`, or `accentText` `#9A5200` (4.95:1 on the field). (3) Add a non-colour cue to every selected state: a check icon in selected chips (soft chips already have one), bold label plus a 1.5 px `accentText` outline on the segmented thumb, a check on selected rows and seats. (4) Add `nonTextPairs` to tokens and test them at 3:1. Card borders and dividers are decorative and can stay. | M |
| S-05 | P1 | All three Expo apps | `dupes.mjs`: 28 file families repeated at 90–100% overlap, about 4,000 lines: `ChatScreen.tsx` (3 copies, 98% and 96% identical, 837 lines), `session.ts` ×3, `live.ts` ×3, `OtpInput` ×3, `BaseMap.web`/`ZoneLayer`/`SvgBase` ×2, `api.tsx` ×3, `Push.tsx` ×2, `api-links` ×3, `push.native` ×3, `storage` ×3, `TabBar` ×2, `money` ×3, `AuthHeader` ×2, `phone` ×3, `Screen` ×2, `fonts.web` ×3, `haptics` ×3, `useMaskedCall` ×3, `SystemBanner` ×3, `font-files` ×3. | Every fix has to be made three times; it won't be. Copies are already drifting (`Push.tsx` 90%, `push.native` 95%). The chat screen is the one place all three audiences meet, and it's the most duplicated. | Move UI to `packages/ui`: `ChatThread` (+ composer, bubble, receipts), `OtpInput`, `Screen` + `ScreenHeader`, `TabBar`, `AuthHeader`, `PermissionPrompt`, `ModalSheet`. Move plumbing to a new `packages/app-core`: session, live socket, API links, push, storage, haptics, fonts, money, phone. Move map primitives to `packages/map` (RN entry). Section 7 has the order. | L |
| S-06 | P1 | All apps | Six clock formatters: `formatClock` (`@driver/ui`, device time zone, no period), `clock12` (customer checkout, device time zone), `clock12` (merchant, Baghdad offset), `clockLabel` (customer الرجعة and partner intercity, Baghdad offset), partner ops (`ص`/`م`), Console `formatClock` (`Intl` Asia/Baghdad, `ص`/`م`). The Console support table shows `باقي 19:32` (a duration) next to `4:23 ص` (a clock time) in the same row. Gallery: `باقي 94 ثانية` where the voice spec says `m:ss`. 66 strings say "الساعة {time}". | "الساعة 7:30" on a Baghdad seat can mean morning or evening; a phone set to another time zone shows the wrong hour in the customer app. In the Console, "19:32" reads as a time of day, not "19 hours left". | One `formatClock(date, { period })` and one `formatDuration(ms)` in `@driver/i18n` (pure, no RN), always Asia/Baghdad. Customer and Partner add a part of day for anything beyond 6 hours away: "7:30 الصبح", "7:30 المسا" (Partner intercity already has the helper). Console keeps `ص`/`م`. Durations: under 1 hour `m:ss` or "{n} دقيقة"; 1 hour or more "19 ساعة و32 دقيقة". | M |
| S-07 | P1 | Customer, Partner, Merchant | No app uses NetInfo or React Query's `onlineManager` (0 references). `error.offline_queued` ("ماكو نت هسة. حفظنا طلبك…") exists and is never used. Partner and Merchant show a connection strip only when their live socket drops; Customer has no offline state at all. | In Aziziyah the network drops in lifts, basements and on the Kut road. Without a clear offline state, people retry and double-order, or think the app is broken. Every screen is supposed to have an offline state (CLAUDE.md rule). | `useNetwork()` in `app-core` (NetInfo plus `onlineManager`), a shared `OfflineBanner` in `@driver/ui` under the status banner, pause polling while offline, and queue the few safe writes (chat messages, ratings) with `error.offline_queued`. | M |
| S-08 | P1 | Copy sources outside i18n | `packages/contracts/src/errors.ts` holds about 175 user-facing `message_ar` strings. `apps/api/src` has about 930 lines with Arabic literals in 61 files; `support/canned.ts` repeats `support.canned.*` from i18n; `controls.service.ts` repeats `console.ctl_refusal_*`. None of this goes through the voice checklist. | Voice drift is already visible in that copy: مندوب (3), نقد, هسه (4 vs 0 in i18n), "المدخلات مو صحيحة", "مغلق مؤقتاً", "لهذا الإجراء", "حدّث الصفحة" (10). Two copies of the same sentence will diverge. | Every error code gets an `error.<code>` key in `ar-IQ.json` / `en.json` (some already have `i18n:`); `errors.ts` keeps only codes and retry hints. Canned replies and refusal texts move to i18n and the API reads them by key. Then the copy in section 5 applies to them too. | M |
| S-09 | P1 | Copy, all apps | Courier: الدليفري (spec) in 79 shared + 25 merchant strings, مندوب in 19 shared (Console support and finance, Partner field-ops) + 3 API errors. Taxi ride: رحلة in `trip.*`, `safety.*` (e.g. "الرحلة ماشية", "شارك الرحلة") but مشوار in `ride.*`, `share.*`. Dispatcher: ديسباتشر (spec) vs الموزّع in `intercity.stranded`, `rajaa.demand_escalate` and 3 Console strings. Merchant app name: "درايفر ماركت" (`app.merchant`, gallery) vs "درايفر للمطاعم" (merchant app and home-screen name) vs "Driver Merchant" (brand spec). | A courier hears himself called two things in two apps; the customer's taxi is a رحلة on the tracking screen and a مشوار on the share screen. The merchant app's name is the brand. | Adopt the glossary in section 4. Mechanical replacement across 50 keys, plus the merchant name decision (we recommend "درايفر للمطاعم"). | S |
| S-10 | P1 | Typography, all apps | 22 places set text at 10–11 px, below the 12 px caption floor: chat timestamps and receipts in all three chat copies (11), map attribution (10), merchant chart labels (10–11), partner earnings chart (10–11), intercity seat captions (11), `Badge` and `SeatMap` (11). Raw sizes outside the scale: 19 distinct values; display numerals at 34, 40, 44, 46, 48 px have no token. | Arabic at 10–11 px loses its dots and stacked forms (ت/ث/ن look the same) on 300-dpi Android screens. Display numerals invented per screen give earnings, cash and PIN screens five different hero sizes. | Raise the floor to 12 px (`caption`). Add `numeral` tokens: `numeralSm 34/44`, `numeralMd 44/56`, `numeralLg 48/64` (tabular, bold). Badge counts move to 12 px with a 22 px badge. | S |
| S-11 | P1 | Font scaling, all apps | `allowFontScaling` / `maxFontSizeMultiplier`: 0 uses. Fixed heights: StatusPill 24/30, Chip 36, Badge 20, Segmented 40, seat cells 38×40. Large-text probe on the gallery (all text ×1.6): 14 truncated labels (segments "مع السطور الـ…", plates, delivery hints) and 1 clipped swatch where "برتقالي فاتح" overprints its ratio. | Many of our couriers and older customers run Android at the largest font. RN scales text by default, so fixed-height pills and chips will clip Arabic, which needs more height than Latin. | Decide a policy: body text scales freely; chips, pills, badges and tab labels cap at `maxFontSizeMultiplier={1.3}` via `Text` props by variant; replace fixed `height` with `minHeight` plus vertical padding in StatusPill, Chip, Badge, SegmentedControl. Add a large-text row to the gallery. | M |
| S-12 | P1 | Sheets and modals | Four sheet implementations: `@driver/ui` `Sheet` (non-modal, live screens), Merchant `ModalSheet` (RN `Modal`, `accessibilityViewIsModal`), Partner `ModalSheet` (RN `Modal`, scrim announced as a button named after the sheet title), Customer `ItemSheet` (an absolutely-positioned `View` over the restaurant page: not modal, and Android's back button leaves the restaurant instead of closing the sheet). axe on the gallery: the `Sheet` handle is `role="slider"` with no value (critical, ×2). | With a screen reader, the customer's item sheet lets focus wander into the restaurant page behind it. The partner scrim reads as a second copy of the title. Users of TalkBack can't tell the sheet handle's state. | One `ModalSheet` in `@driver/ui` (RN `Modal`, `accessibilityViewIsModal`, scrim labelled "سكّر", Escape and focus trap on web, the same enter/exit motion). `Sheet` handle: `accessibilityValue={{ min: 0, max: n-1, now: index, text: … }}`. | M |
| S-13 | P2 | Web focus (RN-web apps, gallery) | Keyboard walk: 60 of 60 stops show only Chrome's default 1 px "auto" ring; nothing in `@driver/ui` draws a focus state. `TextField` sets `outlineStyle: 'none'` and replaces it with the 2.27:1 orange border. The Console has a proper 2 px ring (`--ring`). | The merchant tablet and the Console are used with keyboards and barcode scanners; the web studio is how Ali reviews. WCAG 2.2 asks for a clearly visible focus indicator. | `state.focusRing` token (2 px ink, 2 px cream offset). On web, apply it to every `Pressable` through `@driver/ui` (`:focus-visible` style via `onFocus`/`onBlur` or a small CSS rule keyed on `data-focusable`). | S |
| S-14 | P2 | Tap targets | `hitSlop` does not exist on web, so on the web studio and any web build: chips 36 px, segments 40 px, stepper (sm) 36 px, price lines 34 px, seat cells 38×40, sheet handle 24 px. Probe: 38 of 92 interactive elements under 44 px. On native too: `SegmentedControl` 40 px (no hitSlop), toast dismiss about 26 px + 8 slop, sheet handle 24 px. | CLAUDE.md sets 44 px as non-negotiable. Couriers tap with gloves and while riding; the seat map is a money decision. | Make the visual size and the hit size the same component concern: `minHeight: 44` on Pressables with an inner visual (chip stays 36 px tall visually, its Pressable is 44); segments 44; seat cells 44; handle area 44. | S |
| S-15 | P2 | Hard-coded values | `inventory.mjs`, app code only (`ui` excluded): radii 63/119/74 (customer/partner/merchant), 30 distinct values (3, 5, 7, 11, 13, 15, 18, 22…); spacing 74/118/96; font sizes 17/19/35; raw shadow numbers 34/27/18 (`shadowOpacity: 0.08`, `shadowRadius: 16`… instead of `theme.elevation[n]`); hex 5/19/7 plus 9 in Console (tier colours `#E7B48A`/`#F6CF6A`, `EarningsParts` copies dark-theme hexes `#7ACF9D`/`#F2BC68`, Console's banner preview uses `#FBF8F3`/`#E9E1D6`/`#F1EBE2`, which are not token values). | Each raw value is a place where a brand change, dark mode or a spacing fix won't land. The Console banner preview already shows customers a colour the app does not use. | Add missing tokens (`radius.xs = 4`, tier palette, `numeral` sizes, `zIndex` scale). Add an ESLint rule in the apps that flags numeric `borderRadius`/`fontSize`/`shadow*` and hex literals outside `packages/design-tokens`; codemod the Partner app first (119 radii). | M |
| S-16 | P2 | Icons | Four icon sets on one grid: `@driver/ui` `ICONS` (39), Merchant `MIcon` (18 more), Merchant menu `Glyph`, Partner account `Glyph` (12, stroke 2.0 where the system says 1.75). `camera` is drawn three times. Missing from the shared set: alert, lock, calendar, document, printer, upload, trend arrows. RTL mirroring list (`MIRRORED`) is correct. | Mismatched stroke weights show up side by side (Partner account vs everything else). New screens can't find an icon and draw another one. | Merge everything into `ICONS` (about 70 glyphs), one stroke (1.75 at 24 px), one `Icon` component; delete `MIcon` and both `Glyph` files. Add the new glyphs to the gallery's icon grid. | S |
| S-17 | P2 | Plurals | `t()` has no plural support. 92 strings put a count before a singular noun: "{n} طلب", "{items} صنف", "{n} سايق", "{n} مقاعد". Merchant ticket screenshot: "2 صنف", "5 صنف". Partner wrote its own `pluralForm()` with `_one/_few/_many` keys (81 such keys exist, ad hoc). | "2 صنف" reads as broken Arabic to every merchant on every order. Iraqi speech says صنفين، 3 أصناف، 11 صنف. | `plural(key, n)` in `@driver/i18n` using Arabic CLDR categories (zero, one, two, few 3–10, many 11–99, other), keys `x_one`, `x_two`, `x_few`, `x_many`; move Partner's helper there. Keep the voice spec's exception for دقيقة. | M |
| S-18 | P2 | Merchant and Console copy | 15 merchant strings and 4 Console strings abbreviate minutes as "د": "متأخر {minutes} د", "الدليفري بالطريق · {minutes} د", "باقي {minutes} د للرد". | "د" also starts "دينار", and the kitchen ticket shows money and minutes side by side ("15,250 دينار" … "8 د"). | Write "دقيقة" in full ("متأخر {minutes} دقيقة"); where space is tight use the countdown form `m:ss`. | S |
| S-19 | P2 | Console typography | Tailwind's default `text-xs` (119 uses) and `text-sm` (164) carry Latin line heights (16 and 20 px, ratio 1.33–1.43) where the tokens use about 1.65 for Arabic. No `@font-face` or `next/font` for IBM Plex Sans Arabic, so the Console falls back to Noto, Segoe or the system face. | Dense tables at Latin leading clip ي/ج descenders and stacked dots. Ops staff see a different typeface from the apps. | Load Plex with `next/font/local` (the woff files are already in `@expo-google-fonts/ibm-plex-sans-arabic`). Map Tailwind `fontSize` to the token type scale, including line heights. | S |
| S-20 | P2 | Native font family names | `apps/partner/app/ops/cash.tsx` sets `fontFamily: 'IBM Plex Sans Arabic'` with `fontWeight: '700'`; `PinMap.tsx` and Merchant `Charts.tsx` pass the same CSS family name to `SvgText`. On native the loaded families are `IBMPlexSansArabic_700Bold` etc. | On phones these render in the system font (and Android fakes the bold), the one screen where the ops agent types a cash amount in 34 px. | Use `theme.font(700)` (and a `fontFamilyFor(weight)` helper for SVG text). | S |
| S-21 | P2 | Toast | `ToastProvider` shows one toast for 3.5 s even when it has an action; no exit animation; dismiss button about 26 px + 8 slop; new toasts replace old ones without queuing; auto-hide does not extend for screen readers. | An "undo"-style action that disappears in 3.5 s fails WCAG 2.2.1 (timing adjustable) and frustrates everyone. | Toasts with an action stay 8 s and pause while touched or focused; queue up to 2; exit with `accelerate` at 150 ms; dismiss target 44 px; longer duration when a screen reader is on (`AccessibilityInfo.isScreenReaderEnabled`). | S |
| S-22 | P2 | Gallery axe results (web semantics of shared components) | `Timeline`: `aria-selected` on list items ×14 (critical) and list items missing their role ×3 (critical). `SeatMap`: `aria-label` on a generic `div` for the driver seat ×4. `SearchField`: `role="search"` on the `input` ×2, and one field with no label. `CountdownRing`: `progressbar` with no name. Page: no `main` landmark, no `h1`. | Each is a small fix in one component that lands in every app on web. | Timeline: `accessibilityRole="listitem"` on steps and `aria-current="step"` instead of `aria-selected`. SeatMap: give the driver cell `accessibilityRole="image"`. SearchField: put `role="search"` on the wrapper, keep `searchbox` on the input. CountdownRing: label it. Screens: `accessibilityRole="header"` on titles (the apps do this 36 times already) and a `main` landmark from `Screen`. | S |
| S-23 | P2 | Bidi isolation | `ltr()` exists in `@driver/ui`, but apps paste raw U+2066/U+2069 characters into template strings (customer and partner OTP, partner onboarding) and most phone numbers, plates and codes inside sentences are not isolated (isolation calls: customer 9, partner 9, merchant 3). The gallery itself shows the failure: "الأبيض على #E08A1E" renders as "E08A1E#". | Phone numbers, plates ("23 ب 7731"), PINs and order numbers are exactly the strings people read aloud to each other. A reordered phone number is a wrong phone number. | Typed parameters: `t('x', { phone: isolate(phone) })`, or let `t()` isolate any param whose name is `phone`, `plate`, `code`, `pin`, `number`, `id`. One `PhoneText` component for standalone numbers. | S |
| S-24 | P2 | Customer motion | Customer animations use their own values: camera 500/600 ms, arrival fly 650 ms after 700 ms, pop spring damping 6, pulse ring 2,100 ms, `RideMap` lift springs damping 12/16. `reduceMotion` is referenced 3 times in the customer app vs 32 in Partner and 38 in `@driver/ui`. Reanimated 3.16's default (`ReduceMotion.System`) covers most of it, but not the camera glides or the custom loop. | Two apps from the same team feel different in the hand; the arrival celebration overshoots harder than any other moment in the product. | Adopt the motion language in section 6; give the camera a token (`duration.camera = 600`, `standard` curve); route celebration through `spring.celebrate`. | S |
| S-25 | P2 | Copy: MSA, exclamation marks, symbols | Customer-facing MSA: `order.status.disputed` "شكوتك قيد المراجعة"; refusal copy (API) "…نرجع قريب إن شاء الله" (spec §7 bans it on ETAs); `dispute.resolved_q` "هل انحلت مشكلتك؟" (also in spec example 18). Exclamation marks beyond the two allowed: `track.arrived_title` "وصل!", `track.rate_thanks`, `push.order_delivered.body`, `promo.community_unlocked`, `merchant.board.alert_count`, `console.sos_alert`. `ledger.nightly_ok` uses "✓", which Plex does not have. | Small, but these are the most-seen strings (arrival, delivery push). | Rewrites in section 5. Update spec example 18 to "انحلت مشكلتك؟". | S |
| S-26 | P2 | Copy: errors with no next step | `otp_locked` "محاولات كثيرة", `session_expired` "انتهت جلستك", `phone_invalid` "الرقم مو صحيح" (no format), `merchant_paused` "مغلق مؤقتاً", `sms_not_configured` "خدمة الرسائل مو مهيأة" (internal), state conflicts "حدّث الصفحة" ×10 (a web word in a native app), `refund_needs_escalation` names "علي أو نائبه". | Spec §7: every message gives a next step. "حدّث الصفحة" asks the user to do what the app should do itself. | Rewrites in section 5; on `*_state_conflict` the client refetches and says what changed. | S |
| S-27 | P2 | Optimistic updates | 2 optimistic mutations in all apps (customer notification prefs, merchant menu availability). | Accept, ready, picked-up and chat send are the moments people tap repeatedly on a slow network. | Optimistic state for chat send (with "ما وصلت، اضغط حتى تعيد"), merchant accept/ready, and partner job steps, rolled back with a toast on error. | M |
| S-28 | P3 | Dark mode readiness | `themes.dark` is complete and AA for text, but no app reads it (`theme="light"` everywhere); Partner's earnings card hand-builds a dark surface from `CREAM` and raw hexes; the Console is dark on a separate palette; the dark stub fails non-text contrast too (field 1.03:1). Customer and Partner set `userInterfaceStyle: "automatic"`, so on a phone in dark mode the system keyboard, alerts and pickers go dark over a light app. | Not a launch need, but the stub will rot. The keyboard mismatch is visible today. | Set `userInterfaceStyle: "light"` until dark ships. Make the earnings card a `surface="inverse"` role. Build the Console from `themes.dark` (S-02) so dark has one real user. | S |
| S-29 | P3 | Font loading | Apps render with the system font until Plex loads (`fonts={loaded ? 'plex' : 'system'}`), with no splash hold. | Arabic system fonts have different widths; lines re-wrap after first paint. | Hold the splash screen until fonts load (they are bundled, so it's milliseconds). | S |
| S-30 | P3 | Colour-only meaning | Console urgency strip on support rows (`aria-hidden` red/amber/grey bar) and cap bars rely on colour; star ratings in `accent` are 2.68:1 (the number beside them carries the meaning). | Mostly backed by text nearby; worth keeping that way. | Keep a text or icon twin for every coloured bar; add the urgency word in the row ("عاجل"). | S |
| S-31 | P3 | Gallery as documentation | The gallery shows 24 components and their states, but no pressed, focus or large-text states, no usage rules, and none of the app-local patterns (chat, sheets, tab bar). | The gallery is the review surface for a non-coding founder. | Add a states row per component (rest, pressed, focus, disabled, loading, error, large text), a "do / don't" line each, and the new shared components as they land. | M |

---

## 3. Contrast table

Computed by `contrast.mjs` from `tokens.ts` and the Console's `globals.css`. Text needs 4.5:1
(3:1 at ≥ 24 px, or ≥ 18.5 px bold). Icons, boundaries, focus indicators and selected-state
indicators need 3:1 against what is next to them (WCAG 1.4.11), when they are needed to identify the
control or its state. Rows marked "not used" are reference rows explaining a rule.

Result: every text pair in the light theme passes. Failures are non-text pairs in the light theme
(state and boundaries) and text in the Console.

| Theme | Foreground | Background | Kind | Ratio | Needs | Result | Where |
|---|---|---|---|---|---|---|---|
| light | `text` #1F1A14 | `bg` #FBF6EE | text | 16.05:1 | 4.5:1 | pass | body copy |
| light | `textMuted` #6B6157 | `bg` #FBF6EE | text | 5.62:1 | 4.5:1 | pass | secondary copy (529 Text color="textMuted") |
| light | `textMuted` #6B6157 | `surface` #FFFFFF | text | 6.05:1 | 4.5:1 | pass | card secondary, list subtitles |
| light | `textMuted` #6B6157 | `surfaceSunken` #F3EBDD | text | 5.11:1 | 4.5:1 | pass | placeholders, unselected segment |
| light | `textMuted` #6B6157 | `accentTint` #FCEBD3 | text | 5.17:1 | 4.5:1 | pass | secondary copy on selected rows |
| light | `onAccent` #1F1A14 | `accent` #E08A1E | text | 6.43:1 | 4.5:1 | pass | primary button, selected chip, badge count |
| light | `accentText` #9A5200 | `surface` #FFFFFF | text | 5.86:1 | 4.5:1 | pass | links, ghost button |
| light | `accentText` #9A5200 | `accentTint` #FCEBD3 | text | 5.02:1 | 4.5:1 | pass | accent pill |
| light | `successText` #23744A | `successTint` #E3F2E8 | text | 4.94:1 | 4.5:1 | pass | success pill |
| light | `warningText` #8A5300 | `warningTint` #FBEBCC | text | 5.38:1 | 4.5:1 | pass | warning pill, status banner |
| light | `dangerText` #A8361F | `dangerTint` #F9E3DE | text | 5.31:1 | 4.5:1 | pass | danger pill, status banner |
| light | `infoText` #245C96 | `infoTint` #E1ECF7 | text | 5.76:1 | 4.5:1 | pass | info pill, status banner |
| light | `onDanger` #FFFFFF | `danger` #C2412D | text | 5.14:1 | 4.5:1 | pass | destructive button |
| light | `bg` #FBF6EE | `text` #1F1A14 | text | 16.05:1 | 4.5:1 | pass | toast message |
| light | `accentTint` #FCEBD3 | `text` #1F1A14 | text | 14.77:1 | 4.5:1 | pass | toast action |
| light | `textMuted` #6B6157 | `seatTaken` #E8DFD0 | text | 4.58:1 | 4.5:1 | pass | taken seat caption (thin margin) |
| light | `warningText` #8A5300 | `surfaceSunken` #F3EBDD | text | 5.35:1 | 4.5:1 | pass | earnings warning caption |
| light | white #FFFFFF | `accent` #E08A1E | text | 2.68:1 | 4.5:1 | not used | white on the brand orange: never used (rule upheld) |
| light | `success` #2F8F5B | `surface` #FFFFFF | text | 4.04:1 | 4.5:1 | not used | why `success` is fill-only |
| light | `warning` #C77700 | `surface` #FFFFFF | text | 3.46:1 | 4.5:1 | not used | why `warning` is fill-only |
| light | `surface` #FFFFFF | `warning` #C77700 | icon | 3.46:1 | 3:1 | pass | status banner warning icon |
| light | `surface` #FFFFFF | `info` #2F6FB0 | icon | 5.22:1 | 3:1 | pass | status banner info icon |
| light | `surface` #FFFFFF | `danger` #C2412D | icon | 5.14:1 | 3:1 | pass | status banner critical icon |
| light | `danger` #C2412D | `surfaceSunken` #F3EBDD | boundary | 4.34:1 | 3:1 | pass | TextField error border |
| light | `surfaceSunken` #F3EBDD | `bg` #FBF6EE | boundary | 1.10:1 | 3:1 | **FAIL** | TextField at rest on the screen (no border) |
| light | `surfaceSunken` #F3EBDD | `surface` #FFFFFF | boundary | 1.18:1 | 3:1 | **FAIL** | TextField at rest on a card; Stepper and Segmented tracks |
| light | `accent` #E08A1E | `surfaceSunken` #F3EBDD | focus | 2.27:1 | 3:1 | **FAIL** | TextField focus border (web outline removed) |
| light | `accent` #E08A1E | `surface` #FFFFFF | state | 2.68:1 | 3:1 | **FAIL** | selected chip fill vs unselected chip |
| light | `accent` #E08A1E | `bg` #FBF6EE | state | 2.49:1 | 3:1 | **FAIL** | selected chip on the screen background |
| light | `surface` #FFFFFF | `surfaceSunken` #F3EBDD | state | 1.18:1 | 3:1 | **FAIL** | segmented thumb vs track |
| light | `accentTint` #FCEBD3 | `surface` #FFFFFF | state | 1.17:1 | 3:1 | **FAIL** | selected list row vs unselected |
| light | `seatTaken` #E8DFD0 | `surface` #FFFFFF | state | 1.32:1 | 3:1 | **FAIL** | taken seat vs free seat (label also says it) |
| light | `accent` #E08A1E | `accentTint` #FCEBD3 | state | 2.30:1 | 3:1 | **FAIL** | tinted card outline |
| light | `borderStrong` #B3A594 | `surface` #FFFFFF | boundary | 2.41:1 | 3:1 | **FAIL** | secondary button outline |
| light | `borderStrong` #B3A594 | `bg` #FBF6EE | boundary | 2.24:1 | 3:1 | **FAIL** | secondary button outline on the screen |
| light | `border` #EADFCF | `surface` #FFFFFF | boundary | 1.32:1 | 3:1 | advisory | unselected chip outline (label identifies it); card borders and dividers are decorative |
| light | `border` #EADFCF | `surfaceRaised` #FFFFFF | boundary | 1.32:1 | 3:1 | **FAIL** | sheet drag handle (it is a control) |
| light | `accent` #E08A1E | `surface` #FFFFFF | icon | 2.68:1 | 3:1 | advisory | rating star (the number beside it carries the meaning) |
| light | `borderStrong` #B3A594 | `surface` #FFFFFF | icon | 2.41:1 | 3:1 | advisory | fleet "offline" dot (text label beside it) |
| dark (stub) | `textMuted` #B8AA98 | `surfaceRaised` #2A231C | text | 6.82:1 | 4.5:1 | pass | sheet secondary |
| dark (stub) | `onAccent` #1F1A14 | `accent` #EE9A32 | text | 7.65:1 | 4.5:1 | pass | primary button |
| dark (stub) | `onDanger` #1F1A14 | `danger` #E06A54 | text | 5.23:1 | 4.5:1 | pass | destructive button |
| dark (stub) | `surfaceSunken` #120E0B | `bg` #16120E | boundary | 1.03:1 | 3:1 | **FAIL** | TextField at rest |
| dark (stub) | `border` #3A3027 | `surface` #201A15 | boundary | 1.34:1 | 3:1 | advisory | chip outline |
| console | `text` #f8f7f4 | `bg` #1a1917 | text | 16.40:1 | 4.5:1 | pass | body |
| console | `muted` #a39e94 | `bg` #1a1917 | text | 6.59:1 | 4.5:1 | pass | `text-muted` (153 uses) |
| console | `muted` #a39e94 | `surface` #2c2a26 | text | 5.37:1 | 4.5:1 | pass | `text-muted` on cards |
| console | `muted` #a39e94 | `surface-2` #44413b | text | 3.81:1 | 4.5:1 | **FAIL** | `text-muted` on table headers and hovers |
| console | `faint` #7c776e | `bg` #1a1917 | text | 3.95:1 | 4.5:1 | **FAIL** | `text-faint` (55 uses) |
| console | `faint` #7c776e | `surface` #2c2a26 | text | 3.22:1 | 4.5:1 | **FAIL** | `text-faint` on cards |
| console | `accent` #f2a33a | `surface` #2c2a26 | text | 6.87:1 | 4.5:1 | pass | `text-accent` (43 uses) |
| console | `accent` #f2a33a | `surface-2` #44413b | text | 4.88:1 | 4.5:1 | pass | `text-accent` on surface-2 |
| console | `on-accent` #1a1917 | `accent` #f2a33a | text | 8.43:1 | 4.5:1 | pass | primary buttons |
| console | `bad` #d03b3b | `surface` #2c2a26 | text | 2.98:1 | 4.5:1 | **FAIL** | `text-bad` (33 uses) on cards |
| console | `bad` #d03b3b | `bg` #1a1917 | text | 3.66:1 | 4.5:1 | **FAIL** | `text-bad` on the page |
| console | `ok` #1f9d55 | `surface` #2c2a26 | text | 4.10:1 | 4.5:1 | **FAIL** | `text-ok` (13 uses) on cards |
| console | `ok` #1f9d55 | `bg` #1a1917 | text | 5.03:1 | 4.5:1 | pass | `text-ok` on the page |
| console | `bad` #d03b3b | `surface` #2c2a26 | state | 2.98:1 | 3:1 | **FAIL** | red cap bars and urgency strips |
| console | `ok` #1f9d55 | `surface` #2c2a26 | state | 4.10:1 | 3:1 | pass | green cap bars, health dot |
| console | `info-500` #4e9bc4 | `surface` #2c2a26 | text | 4.64:1 | 4.5:1 | pass | info chip |
| console | `line` #5e5a52 | `surface` #2c2a26 | boundary | 2.09:1 | 3:1 | **FAIL** | input borders |
| console | `line` #5e5a52 | `bg` #1a1917 | boundary | 2.56:1 | 3:1 | **FAIL** | input borders on the page |
| console | `accent` #f2a33a | `bg` #1a1917 | focus | 8.43:1 | 3:1 | pass | focus ring |

**Proposed replacements (checked):**

| Use | Today | Proposed | Ratio |
|---|---|---|---|
| Field border at rest, secondary button outline (`borderStrong`) | `#B3A594` (2.24–2.41) | `#8C7F6F` neutral 500 | 3.63 on cream, 3.90 on white, 3.30 on sunken |
| Field focus border | `accent` (2.27) | `accentText` `#9A5200` or ink `#1F1A14` | 4.95 / 14+ on sunken |
| Selected chip outline (plus check icon) | none | `primary.600` `#C27214` 1.5 px | 3.68 on white, 3.42 on cream |
| Console danger text | `#d03b3b` | dark `dangerText` `#F2937F` | 6.31 on surface |
| Console success text | `#1f9d55` | dark `successText` `#7ACF9D` | 7.67 on surface |
| Console muted text | `#a39e94` | dark `textMuted` `#B8AA98` | 6.30 on surface, 4.48 on surface-2 (use surfaceRaised `#2A231C` for table headers) |

---

## 4. Glossary: one word per concept, all apps

Applies to customer, Partner, Merchant, Console, push, WhatsApp templates and API errors.

| Concept | Use | Never | Notes |
|---|---|---|---|
| Food, parcel or errand courier | الدليفري | مندوب، موصّل، كابتن | Console and Partner field-ops screens too ("من يا دليفري؟"). |
| Taxi, tuktuk, الرجعة or خطوط driver | السايق (pl. السواق) | سائق، كابتن | |
| Shop-for-me runner | الشاري | | |
| Customer | الزبون | العميل، عزيزي العميل | |
| Restaurant / shop | المطعم (food) · المحل (grocery, other shops) · "المطعم أو المحل" when either | متجر، تاجر | Merchant onboarding badge: "للمطاعم والمحلات". |
| Food or parcel order | طلب | أوردر | |
| In-town taxi or tuktuk ride | مشوار | رحلة | `trip.*`, `safety.*` move to مشوار. |
| Intercity seat trip (customer) | رحلة | مشوار | الرجعة booking, pass, board. |
| Intercity departure (driver's side) | طلعة | | Partner only. |
| Intercity product | الرجعة | | |
| School/work route | خط (pl. خطوط) · اشتراك for the subscription | | |
| Dispatcher (person) | الديسباتشر | الموزّع | Spec-approved loanword. |
| Our field staff (customer-facing) | موظف درايفر | موظف العمليات | Partner-facing: العمليات. |
| Support | الدعم | خدمة العملاء | |
| Cash | كاش | نقد، نقدي | Includes `over_cap`: "سقف الكاش". |
| Wallet / balance / top up | المحفظة / الرصيد / اشحن | | |
| Money (Partner, Merchant) | فلوس; المبلغ for a specific amount | أموال | |
| Payout | تحويل | | |
| Menu | المنيو | القائمة (for a menu) | القائمة is fine for "list". |
| One-time code, PIN, handover code, top-up code | الرمز | الكود | كود only for "كود الخصم". |
| Now | هسة | هسه، الآن | 4 API strings spell it هسه. |
| Minutes | دقيقة (`{n} دقيقة`), `دقايق` only in fixed phrases | د (abbreviation), دقائق | |
| Time of day | `7:30` + part of day when more than 6 h away: الصبح، الظهر، العصر، المسا، بالليل | ص/م in customer and partner apps | Console keeps ص/م. |
| Currency | دينار after the number | د.ع، IQD (Arabic) | |
| Closed (merchant) | مسكّر · موقّف الطلبات (paused) | مغلق، مقفول | |
| Buttons | Imperative verbs: أكّد، الغي، احفظ، عدّل، امسح، كمّل، بعدين، تمام | Nouns: تأكيد، إلغاء، حفظ، تعديل، حذف، التالي، تخطي | `action.*` today uses nouns while screens use verbs ("دزلي الرمز"، "اقبل"، "ارفض"). |
| App names | درايفر · درايفر بارتنر · درايفر للمطاعم · لوحة درايفر | درايفر ماركت | Latin: Driver, Driver Partner, Driver Merchant, Driver Console. |
| "In progress" | دا + verb ("دا يتحضّر") or دن… for "we are" ("دنرسل طلبك…") | قيد، جاري | Both forms are already used; keep both, never قيد/جاري. |

---

## 5. Strings to rewrite

Proposed Iraqi copy. Keys are in `packages/i18n/src/locales/ar-IQ.json` unless marked **(API)**
(`packages/contracts/src/errors.ts` or the named service) or **(M)** (`apps/merchant/locales/ar.json`).
English keeps parity.

| Key | Today | Proposed | Why |
|---|---|---|---|
| `order.status.disputed` | شكوتك قيد المراجعة | دا نراجع شكوتك، ونبلّغك بالنتيجة | MSA "قيد"; add what happens next |
| `dispute.resolved_q` (and spec example 18) | هل انحلت مشكلتك؟ | انحلت مشكلتك؟ | Iraqi questions drop هل |
| `console.ctl_refusal_vertical` + **(API)** `controls.service.ts` | خدمة {name} موقّفة مؤقتاً. نرجع قريب إن شاء الله | {name} موقّف هسة. نبلّغك أول ما يرجع | Spec §7: no إن شاء الله on timing; give a next step |
| `console.ctl_refusal_zone` + **(API)** | ما نگدر نخدم منطقة {name} هسة. نرجع قريب إن شاء الله | ما نوصل لـ{name} هسة. نبلّغك أول ما نرجع | Same |
| `track.arrived_title` | وصل! | وصل طلبك | Exclamation policy |
| `track.rate_thanks` | شكراً! تقييمك يوصلهم | شكراً، تقييمك وصلهم | Exclamation policy; past tense is truer |
| `push.order_delivered.body` | صحة وعافية! شوف الوصل وقيّم الطلب | صحة وعافية. شوف الوصل وقيّم الطلب | Exclamation policy |
| `promo.community_unlocked` | انفتح عرض الحي! خصم {percent}% | انفتح عرض الحي: خصم {percent}% | Exclamation policy |
| `merchant.board.alert_count` **(M)** | {count} طلبات جديدة! | `_two`: طلبين جدد · `_few`: {count} طلبات جديدة · `_many`: {count} طلب جديد | Plural forms; the spec allows "!" only on the single "طلب جديد!" |
| `ledger.nightly_ok` | الدفتر متوازن ✓ | الدفتر متوازن (with the check icon) | Plex has no ✓ glyph |
| `trip.status.in_transit`, `trip.in_progress` | الرحلة ماشية | المشوار ماشي | Glossary: taxi = مشوار |
| `trip.share`, `safety.share_trip` | شارك الرحلة … | شارك المشوار … | Same |
| `trip.rate_title` | شلون كانت الرحلة؟ | شلون كان المشوار؟ | Same |
| `safety.deviation_prompt` | الرحلة طلعت عن الطريق. كلشي تمام؟ | السيارة طلعت عن الطريق. كلشي تمام؟ | Works for taxi and الرجعة alike |
| `push.safety_deviation.body` | الرحلة طلعت عن الطريق. اضغط لتأكيد إنك بخير | السيارة طلعت عن الطريق. اضغط وگلنا إنك بخير | Dialect; "لتأكيد" is MSA syntax |
| `intercity.stranded`, `rajaa.demand_escalate` | الموزّع … | الديسباتشر … | Glossary |
| `partner.ops_cash_pick` | من أي مندوب؟ | من يا دليفري؟ | Glossary |
| `partner.ops_cash_none` | ماكو مندوب عنده كاش هسة | ماكو دليفري عنده كاش هسة | Glossary (also the other 17 مندوب keys) |
| `handover_code_invalid` **(API)** | رمز التسليم غلط. خلي المندوب يقرا الرمز من تطبيقه | الرمز ما طابق. خلي الدليفري يقرا الرمز من تطبيقه مرة ثانية | Glossary; "غلط" points at a person |
| `over_cap` **(API)** | وصلت حد النقد. سدّد حتى توصلك طلبات جديدة | وصلت سقف الكاش. سلّم الكاش حتى ترجع توصلك طلبات | Glossary (كاش، سقف) |
| `invalid_input` **(API)** | المدخلات مو صحيحة. راجعها وجرب | أكو معلومة ناقصة أو مو مضبوطة. شوف الخانات المعلّمة بالأحمر | "المدخلات" is jargon; point at where |
| `forbidden` **(API)** | ما عندك صلاحية لهذا الإجراء | ما تگدر تسوي هذا من حسابك. إذا تحتاجه احچي ويا صاحب الحساب | MSA "الإجراء"; next step |
| `merchant_paused` **(API)** | مغلق مؤقتاً | المطعم موقّف الطلبات هسة. جرّب مطعم ثاني | MSA; next step |
| `otp_locked` **(API)** | محاولات كثيرة | حاولت هواية. انتظر {minutes} دقيقة واطلب رمز جديد | No next step; the API already sends `minutes` (15) |
| `session_expired` **(API)** | انتهت جلستك | طلعت من حسابك. ادخل برقمك مرة ثانية | "جلسة" is jargon; next step |
| `phone_invalid` **(API)** | الرقم مو صحيح | اكتب الرقم مثل 0770 123 4567 | Show the format |
| `call_unavailable` **(API)** | اتصل من خلال التطبيق غير متوفر | الاتصال من التطبيق ما يشتغل هسة. دز رسالة بالمحادثة | Ungrammatical; MSA "غير متوفر" |
| `*_state_conflict` ×10 **(API)** | حالة الطلب تغيّرت. حدّث الصفحة | الطلب تغيّر هسة. حدّثناه، شوفه وكمّل | Native apps have no "page"; the client should refetch |
| `sms_not_configured` **(API)** | خدمة الرسائل مو مهيأة | ما گدرنا نبعث الرمز هسة. جرّب واتساب أو بعد شوية | Internal state shown to users |
| `refund_needs_escalation` **(API)** | …يحتاج موافقة علي أو نائبه… | …يحتاج موافقة مدير المالية… | No personal names in product copy |
| `order_empty` **(API)** | الطلب فارغ | السلة فاضية. ضيف شي وكمّل | Dialect; next step |
| `outside_zone` **(API)** | هذا الموقع برا منطقة الخدمة حالياً | هذا المكان برا منطقتنا هسة. اختار مكان داخل العزيزية | "حالياً" MSA; next step |
| `app.merchant` | درايفر ماركت | درايفر للمطاعم | One merchant name |
| `merchant.card.late` **(M)** and 14 more | متأخر {minutes} د | متأخر {minutes} دقيقة | "د" reads as دينار |
| `console.sla_left` / `console.sla_over` | باقي {time} / فات {time} with `19:32` | باقي {duration} / فات {duration} with "19 ساعة" | A duration must not look like a clock |
| `partner.jobs_today` (and 91 like it) | {n} طلب اليوم | `_one`: طلب واحد اليوم · `_two`: طلبين اليوم · `_few`: {n} طلبات اليوم · `_many`: {n} طلب اليوم | Arabic plurals |
| `merchant.new_order_body` **(M)** | طلب #{id} · {items} صنف · {amount} دينار | … · `_two`: صنفين · `_few`: {items} أصناف · `_many`: {items} صنف … | "2 صنف" seen on the ticket |
| `action.confirm` / `action.cancel` / `action.save` / `action.edit` / `action.delete` / `action.next` / `action.skip` / `action.done` | تأكيد / إلغاء / حفظ / تعديل / حذف / التالي / تخطي / تم | أكّد / الغي / احفظ / عدّل / امسح / كمّل / بعدين / تمام | Buttons are verbs; matches "اقبل"، "ارفض"، "دزلي الرمز" |

---

## 6. Motion language proposal

Our motion should feel like a quick, warm hand: things arrive fast and settle softly, nothing
bounces unless it's a celebration, and the app is silent and still when nothing is happening.

### Named durations (tokens)

| Token | ms | Use |
|---|---|---|
| `instant` | 80 | Press-in, select dip |
| `fast` | 150 | Fades, colour/state changes, exits of small things |
| `base` | 220 | Enter of small things (toast, inline note, panel content) |
| `slow` | 360 | Panels and modal sheets entering |
| `camera` (new) | 600 | Map camera moves (today 500/600/700 by hand) |
| `deliberate` | 600 | One-off reveals (rating, check-in success) |
| `celebrate` (new) | ≤ 900 total | Arrival, tier-up; once per event |
| `pulse` | 1,400 | Live dot ring, new-order card glow |
| `ambient` (new, replaces 2,100/2,200) | 2,000 | Radar under the online driver, courier ring |
| `shimmer` | 1,200 | Skeleton sweep (right to left) |
| `countUp` | 500 | Totals changing |

### Curves and springs

- `standard` for moves within the screen, `decelerate` for anything entering, `accelerate` for
  anything leaving. Exits run about 30% faster than entries.
- Springs: `press` (no wobble), `select` (one small overshoot), `sheet` (detents), `gentle` (toast),
  and a new `celebrate` (damping 10, stiffness 180: the partner check-in tick and the customer arrival
  pop share it; today they use damping 6, 10, 11 and 12).

### Choreography rules

1. Motion answers a person. Ambient loops are allowed only for live status (courier moving, live pill,
   online radar, an unacknowledged new order) and stop when the person acknowledges.
2. One region moves at a time. Lists stagger at most three items, 40 ms apart.
3. Direction follows reading: forward goes toward the end side (left in Arabic), back toward the
   start; sheets come from the bottom; shimmer sweeps right to left (already true).
4. Every enter has an exit. Toasts and inline notes leave with `accelerate` at `fast`.
5. Reduced motion: transforms become ≤ 150 ms cross-fades, loops stop, camera jumps, count-ups jump,
   countdown rings keep updating their number. Every animated hook takes `theme.reduceMotion`
   explicitly instead of relying on library defaults.
6. Celebrations happen once per event, finish within 900 ms, and never on a money-loss moment
   (cancellation fee, cash cap).

### Haptics map (one meaning per kind)

| Kind | When |
|---|---|
| `selection` | Chip, segment, tab, seat, sheet detent, stepper |
| `light` | Primary button press |
| `medium` | Accept a job or an order, go online |
| `success` | Order placed, cash handed over, check-in passed, ride finished |
| `warning` | Destructive confirmation, running late, cash cap near |
| `error` | Failure toast |
| `heavy` (pattern) | New offer (Partner), new order (Merchant), repeated with the sound |

### Sound map

| Sound | App | Behaviour |
|---|---|---|
| New order | Merchant | Loud, plays in silent mode, repeats every 10 s until accepted, rejected or silenced; respects "busy" mode |
| New offer | Partner | Short and loud, plays in silent mode, once per offer with the heavy haptic |
| Message | All | Soft, only when the chat is not on screen |
| Customer | — | No in-app sounds beyond the system push sound |

### Implementation

A `motionPresets` module in `@driver/ui` exporting Reanimated `entering`/`exiting` builders
(`fadeIn`, `fadeOut`, `panelIn`, `panelOut`, `sheetIn`, `pop`) already wired to the tokens and to
reduce-motion, so screens stop writing `FadeIn.duration(180)` by hand (9 places today, with 5
different durations).

---

## 7. Component roadmap for `packages/ui`

### Wave 1: merge what is copied (removes about 2,500 lines)

| Component | Today | Notes |
|---|---|---|
| `ChatThread`, `ChatComposer`, `MessageBubble` | 3 copies of `ChatScreen.tsx` (98% / 96% identical) | Role-aware header, quick replies, read receipts, masked call; timestamps at 12 px |
| `OtpInput` | 3 identical copies | Autofill, paste, Eastern-digit conversion |
| `ModalSheet` | 4 sheet implementations | Modal semantics, motion presets, 44 px handle area |
| `Screen`, `ScreenHeader` (+ back) | 2 copies of `Screen`, `HeaderBack`, per-app headers | Safe areas, `main` landmark, header role |
| `TabBar` | 2 identical copies | Active pill, badge, 44 px targets |
| `AuthHeader` / `AuthFrame` | 2 + 1 | |
| `PermissionPrompt` | Customer `PrePrompt`, Partner and Merchant `Push.tsx` | Push and location pre-prompts |
| `ComingSoon` | 3 `PlaceholderScreen` versions | |
| `Wordmark` | 3 versions | One component, `app` prop |
| Icons | `MIcon`, two `Glyph` sets | Into `ICONS` |
| Map primitives (`BaseMap`, `ZoneLayer`, `SvgBase`) | Customer and Partner copies | Into `packages/map` (RN entry) |

### Wave 2: patterns that are missing

| Component | Why |
|---|---|
| `OfflineBanner` + `useNetwork` | S-07 |
| `QueryState` | One way to render loading (skeleton), empty, error with retry and offline from a React Query result; today each screen wires `EmptyState` + `apiErrorMessage` + `refetch` by hand (85 call sites of `error.network`) |
| `ConfirmDialog` | Destructive confirmations with action-named buttons ("الغي الطلب" / "لا، خليه") |
| `Switch` | RN `Switch` used raw in Customer and Merchant (`thumbColor="#FFFFFF"`); the customer's off track is `border` `#EADFCF`, 1.32:1 on white, so an off switch is nearly invisible |
| `Meter` (progress bar) | Cash cap (Partner, Merchant, Console), acceptance, low fill |
| `InlineNotice` | Merchant `InfoStrip`, customer late notes, partner warnings |
| `Numeral` | Display amounts, PINs, top-up codes, earnings (tokens from S-10) |
| `PhoneText` / `isolate()` | S-23 |
| `RatingStars` | Star + number built by hand on 5 screens |
| `KeyValueRow` | Receipts, statements, order details |

### Wave 3: system pieces

- Tokens: `borderStrong` → `#8C7F6F`, `focusRing`, `nonTextPairs` test, `numeral` sizes, `radius.xs`,
  `duration.camera`, `duration.ambient`, `spring.celebrate`, tier palette, `zIndex` scale, a Console
  theme generated from `themes.dark`.
- i18n: `plural()`, isolated params, `formatClock` / `formatDuration` (Asia/Baghdad), `error.<code>`
  keys replacing `message_ar` in contracts.
- Gallery: states row per component (rest, pressed, focus, disabled, loading, error, large text) and
  a do/don't line.
- Console stays on its own web kit (`components/ui.tsx`), but takes its colours, type scale and
  formatters from the shared packages.

---

## 8. Top 15 to do next (ranked by user impact per effort)

1. **Audible alarms on native** (S-01): new-order chime for Merchant, offer chime for Partner, both
   playing in silent mode. Test-sound buttons in settings.
2. **Non-text contrast and focus** (S-04, S-13): `borderStrong` to `#8C7F6F`, a visible field border
   at rest, an ink focus border, a check mark on every selected chip, row and seat; extend the
   contrast test to non-text pairs.
3. **Console from tokens, and its contrast** (S-02, S-03): one generated palette; danger, success
   and muted text on the dark theme's text roles.
4. **One clock and one duration formatter** (S-06): Asia/Baghdad everywhere, part of day in the
   customer and partner apps, durations in hours in the Console.
5. **Terminology sweep** (S-09): مندوب → دليفري, taxi رحلة → مشوار, الموزّع → الديسباتشر, and one
   merchant app name.
6. **All user-facing copy in the locale files** (S-08), then apply the rewrites in section 5 (S-25,
   S-26).
7. **Offline awareness** (S-07): network detection, a shared offline banner, queued chat messages and
   ratings.
8. **Merge the copied UI** (S-05, S-12): `ChatThread`, `OtpInput`, `ModalSheet` (with proper modal
   semantics), `Screen`, `TabBar`, `PermissionPrompt`.
9. **Type floor and large text** (S-10, S-11): nothing under 12 px, `numeral` tokens, a font-scaling
   cap for chips and pills, `minHeight` instead of fixed heights.
10. **Arabic plurals** (S-17) and "دقيقة" instead of "د" (S-18).
11. **Toast behaviour** (S-21): longer and pausable when it has an action, a queue, an exit, a 44 px
    close button.
12. **Shared-component semantics** (S-22): Timeline, SeatMap, SearchField, CountdownRing, header and
    landmark roles; re-run axe on the gallery until it is clean.
13. **One icon set** (S-16).
14. **Lint for raw style values** (S-15), with a codemod starting in Partner.
15. **Console typography** (S-19): load IBM Plex Sans Arabic, map Tailwind sizes to the token scale
    with Arabic line heights.

---

## Appendix: captures and raw outputs

`/tmp/claude-0/-home-claude-driver/9e36f95e-a04f-5dd2-b358-67d18250f0e3/scratchpad/audit/system/`

- `gallery-base-*.png`: the `@driver/ui` gallery at 390 px, in slices.
- `gallery-largetext-*.png`: the same with all text ×1.6 (clipping and truncation).
- `gallery-focus.png`: keyboard focus on the gallery (browser default ring only).
- `gallery-a11y.json`: axe-core violations, tap-target list, keyboard walk, large-text clipping.
- The six scripts listed under "How this was measured".

Screenshots referenced from earlier waves: `scratchpad/shots/console-ops/06-support.png` (mixed
24-hour durations and 12-hour times), `scratchpad/shots/merchant-w1/tablet-board-new-order.png`
("2 صنف", "5 صنف"), `scratchpad/shots/app-phone.png` (resting vs focused field),
`scratchpad/shots/partner-w2-earnings/core-offer.png` (offer screen that has no sound on native).
