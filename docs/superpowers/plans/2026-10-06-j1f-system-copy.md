# System, wording and small bugs (J1f) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every piece of logic gets a failing test first.

**Goal:** The customer app speaks like Aziziyah everywhere: natural minute forms (J-D9), «أكل» not «طعام», «دينار» after every amount, the part of day on every الرجعة time, gender-free share and approval texts, no «السيرفر». Six small bugs go (orphan dot, double tick, bag icon for work, toast over the pass, clipped plate at 360, dead-end deep links). The running-late banner stops looking like the brand card (inverse banner, warning hue off the brand hue). Moment sounds stop playing on Android phones set to silent or vibrate. The app forces light mode (J-D4).

**Architecture:** Minute agreement and the part-of-day clock live in `@driver/i18n` (pure, tested), so the customer app, the partner app and the API's push texts all agree through the one `t()`. Copy changes are locale edits guarded by two new voice rules. UI fixes are small and local; the inverse banner gets semantic tokens with contrast pairs. Android moment sounds go through a local notification on per-cue channels that expo-notifications plays as a ringtone (ring stream, muted on silent/vibrate) without posting anything.

**Tech Stack:** TypeScript, `@driver/i18n`, `@driver/design-tokens`, `@driver/ui`, Expo SDK 52 (expo-router, expo-notifications 0.29, expo-av), vitest.

Spec: `docs/specs/2026-10-05-customer-joy.md` §2 (J-D4, J-D9) and §5.1 J1 "System" / "Copy and bugs"; findings `docs/research/ui-ux-audit/2026-10-05-joy/` D-06, D-12, D-17, F-24, L-09, L-24, R-06, R-07, R-08, R-10, R-11, W-03, W-05, A-02, A-06, S2-02 and the older C-26, C-28, C-29, C-36, C-38.

**Status at plan time (`9077233`):** J1a–J1d merged. Already done, so skipped: h6 honest welcome (the welcome is now `WelcomeMap` with `welcome_map.*` lines that list only live services; the old `onboarding.welcome_body` is unused — its text is still made honest so no stale promise lingers); `ThemeProvider theme="light"` is already forced in the customer root layout (only `app.json` still says `automatic`).

---

## Decisions taken in this plan (inside the approved scope)

| Topic | Choice | Why |
|---|---|---|
| Where minute agreement lives | Inside `t()`: an Arabic template's `{p} دقيقة` agrees with the value of `{p}` (1 → «دقيقة», 2 → «دقيقتين», 3–10 → «{p} دقايق», else unchanged; a range "6–9" agrees with its high end). Helpers `formatMinuteCount(n)` and `formatMinutesRange(lo, hi)` are built on it. | One rule covers ~60 strings, the API's pushes and future copy with no call-site changes — the same way `t()` already picks plural forms. Keys keep `{minutes} دقيقة`; a new voice rule bans `{x} دقايق` so no string hard-codes the 3–10 form. |
| Ranges | «6–9 دقايق», «10–15 دقيقة», digits in a left-to-right isolate | J-D9; matches the map pill's existing range. |
| Part of day | 0–3 «بالليل», 4–11 «الصبح», 12–14 «الظهر», 15–17 «العصر», 18–19 «المسا», 20–23 «بالليل». A window's end is judged one minute before it ends. Same part → «بين 8 و 10 بالليل», «4–6 العصر»; different → «بين 5:50 العصر و 6:55 المسا». | R-06. Judging the end at end − 1 min makes 4–6 pm read «4–6 العصر». English uses AM/PM. |
| Pass hero | `DepartureTime` gains `alwaysDay` (sub line starts «اليوم») and `partOfDay` (the period reads «المسا» not «م»); the pass uses both | R-06 / R-10: «اليوم · بعد 38 دقيقة» under «6:15 المسا». |
| Amount rule | Voice rule: outside `console.*`, `{amount}` is followed by « دينار» (or `%`). Signed chips use `iqd(…, { sign: true })` | C-29 / R-11. |
| Approvals | «طلب من {name}: {amount} دينار» (no verb). The merchant name needs a server field (W-03, M) — not in this copy-only pass | C-28 / W-03 copy only. |
| Toast over the pass | `ToastData.placement: 'top'` (top safe inset); the pass's own toasts use it with 3 s | R-10 quick win / C-38. Bottom toasts still sit at 96 px over the tab bar. |
| Late banner | Inverse banner: `inverse` background, `onInverse` text, `onInverseCaution` (saffron) clock and bar, `onInverseSuccess` when credited | S2-02 / f17. |
| Warning hue | light `warning #B07F00`, `warningTint #FAF0C8`, `warningText #7A5A00`; dark `#E5B53A` / `#3A3010` / `#F2CF68` | Moves caution from orange (hue of the brand) to mustard; every existing pair still passes AA. |
| Android silent mode | Moments on Android go through `scheduleNotificationAsync` on a per-cue channel (`moment_<cue>`, sound bundled by the expo-notifications plugin) with the handler answering `shouldShowAlert: false, shouldPlaySound: true`. expo-notifications then plays the channel sound with `RingtoneManager.getRingtone(...).play()` (verified in `ExpoPresentationDelegate.kt`) — the ring stream, which Android mutes on silent and vibrate and under DND. Nothing is posted to the shade. No permission or no channel → no sound (never fall back to the media stream). iOS and web keep expo-av (iOS already honours the silent switch). | L-24 without a new native module. **Limitation:** needs a new native build (plugin `sounds`), so it can only be heard on a dev/EAS build; it follows the ring volume, not the media volume; Android 13+ users who refused notifications get no moment sounds (haptics and visuals still play). |
| Force light | `apps/customer/app.json` `userInterfaceStyle: "light"` | J-D4. Partner stays `automatic`, merchant is already `light` — untouched. |

---

## File map

| File | Change |
|---|---|
| `packages/i18n/src/time.ts`, `time.test.ts` | `minuteNoun`, `agreeMinutes`, `formatMinuteCount`, `formatMinutesRange`, `dayPart`, `formatHourPart`, `hourWindow` |
| `packages/i18n/src/translate.ts` | `t()` runs `agreeMinutes` on Arabic templates |
| `packages/i18n/src/voice.ts`, `voice.test.ts` | rules: no `{x} دقايق`; `{amount}` + دينار |
| `packages/i18n/src/locales/ar-IQ.json`, `en.json` | wording sweep, `time.part_*`, `time.minutes_range`, new keys |
| `docs/specs/2026-10-02-voice-and-microcopy.md` | §5 minutes and parts of day; §10 checklist |
| `packages/ui/src/logic/departure.ts`, `components/DepartureTime.tsx` + tests | `alwaysDay`, `partOfDay` |
| `packages/ui/src/components/Toast.tsx` | `placement: 'top'` |
| `packages/ui/src/icons/paths.ts` | `briefcase` |
| `packages/design-tokens/src/tokens.ts`, tests, `tokens.json` | inverse roles, warning hue |
| `apps/customer/src/features/places/place-icon.ts` (+ test) | one place → icon map |
| `apps/customer/src/features/food/RestaurantRow.tsx` | two fixed meta lines |
| `apps/customer/app/places/index.tsx`, `(tabs)/account.tsx`, `PlaceForm.tsx`, `PlaceEditor.tsx` | icon helper, no trailing check |
| `apps/customer/src/features/rajaa/DepartureTile.tsx`, `labels.ts`, `logic.ts`, `app/rajaa/*` | 360 layout, windows with part of day, «منو مسافر؟», pass day, top toasts, share text |
| `apps/customer/app/_layout.tsx`, `household/_layout.tsx`, `profile/_layout.tsx`, `places/_layout.tsx` | `HeaderBack` everywhere with fallbacks |
| `apps/customer/src/features/track/LatePromise.tsx` | inverse banner |
| `apps/customer/src/features/track/arrival-copy.ts` (+ test), `Arrival.tsx`, `app/order/[id].tsx` | ride arrived line and CTA |
| `apps/customer/src/lib/sound.ts`, `src/lib/moment-sound.ts` (+ test), `push.native.ts`, `app.json` | Android moments through the ring stream |
| amount call sites (`ItemSheet`, `ChangeCredited`, `SheetParts`, `Arrival`, `ride/choose`, `rajaa/departure/[id]`) | `iqd(…, { sign: true })` |

---

### Task 1: J-D9 minute forms in `@driver/i18n`

- [ ] **Step 1 (tests first):** in `time.test.ts`:
  ```ts
  describe('minutes, natural Iraqi forms (J-D9)', () => {
    it('one, two, few, many', () => {
      expect(formatMinuteCount(1)).toBe('دقيقة');
      expect(formatMinuteCount(2)).toBe('دقيقتين');
      expect(formatMinuteCount(3)).toBe('3 دقايق');
      expect(formatMinuteCount(10)).toBe('10 دقايق');
      expect(formatMinuteCount(11)).toBe('11 دقيقة');
      expect(formatMinuteCount(45)).toBe('45 دقيقة');
      expect(formatMinuteCount(5, { locale: 'en' })).toBe('5 min');
    });
    it('ranges agree with their high end, digits isolated', () => {
      expect(formatMinutesRange(6, 9)).toBe('⁦6–9⁩ دقايق');
      expect(formatMinutesRange(10, 15)).toBe('⁦10–15⁩ دقيقة');
    });
    it('every Arabic "{p} دقيقة" agrees through t()', () => {
      expect(t('track.running_late', { minutes: 1 })).toBe('متأخرين دقيقة');
      expect(t('track.running_late', { minutes: 2 })).toBe('متأخرين دقيقتين');
      expect(t('track.running_late', { minutes: 8 })).toBe('متأخرين 8 دقايق');
      expect(t('track.running_late', { minutes: 25 })).toBe('متأخرين 25 دقيقة');
      expect(t('list.minutes', { range: '⁦25–35⁩' })).toBe('⁦25–35⁩ دقيقة');
      expect(t('list.minutes', { range: '⁦5–10⁩' })).toBe('⁦5–10⁩ دقايق');
      expect(t('track.running_late', { minutes: 8 }, 'en')).toBe('8 min late');
    });
  });
  ```
  and update the old «دقيقة for every count» case: `formatMinutes(1)` → «دقيقة», `formatMinutes(125)` → «ساعتين و5 دقايق», `formatDuration(61_000)` → «دقيقتين». Run `pnpm --filter @driver/i18n test` → FAIL.
- [ ] **Step 2:** in `time.ts`:
  ```ts
  /** J-D9: «دقيقة» (1), «دقيقتين» (2), «{n} دقايق» (3–10), «{n} دقيقة» (11+ and 0). */
  export function minuteNoun(n: number): 'one' | 'two' | 'few' | 'many' { … }
  const RANGE = /^[⁦-⁩\s]*(\d+)\s*[–-]\s*(\d+)[⁦-⁩\s]*$/;
  /** An Arabic template's "{p} دقيقة" agrees with the value of {p} (a count, or a range by its high end). */
  export function agreeMinutes(template: string, params?: Params): string {
    if (!params || !template.includes('دقيقة')) return template;
    return template.replace(/\{(\w+)\}(\s+)دقيقة(?![ء-ي])/g, (whole, name: string, sp: string) => {
      const v = params[name];
      const count = asCount(v);
      const range = count === null && typeof v === 'string' ? RANGE.exec(v) : null;
      const n = count ?? (range ? Number(range[2]) : null);
      if (n === null) return whole;
      const form = range ? (n >= 3 && n <= 10 ? 'few' : 'many') : minuteNoun(n);
      if (form === 'one') return 'دقيقة';
      if (form === 'two') return 'دقيقتين';
      if (form === 'few') return `{${name}}${sp}دقايق`;
      return whole;
    });
  }
  export function formatMinuteCount(n: number, opts: { locale?: Locale } = {}) { return t('time.minutes', { n }, opts.locale); }
  export function formatMinutesRange(low: number, high: number, opts: { locale?: Locale } = {}) {
    return t('time.minutes_range', { range: `⁦${low}–${high}⁩` }, opts.locale);
  }
  ```
  `translate.ts` `t()`: `interpolate(agreeMinutes(template, params), params)` (only Arabic templates contain «دقيقة»). `agreeMinutes` lives in `translate.ts` to avoid an import cycle (time.ts already imports translate); `time.ts` re-exports. New keys `time.minutes_range` ("{range} دقيقة" / "{range} min"). Export the helpers from `index.ts`.
- [ ] **Step 3:** voice rule in `voice.ts` (`'{x} دقايق'`: pattern `/\{\w+\} دقايق/`, use `{x} دقيقة — t() picks the form`) + a `voice.test.ts` case; fix the strings it flags (`unreachable.customer_body`, `track.map_minutes_range_few` removed, `net.ago_minutes_few`, `track.signal_lost_n` …). Simplify the customer call sites that hand-picked forms (`eta-range.ts` → `formatMinutesRange`; `order/[id].tsx` signal-lost line → one key).
- [ ] **Step 4:** voice spec §5: the minute rule, ranges, never the bare «د»; glossary test still bans `{minutes} د`.
- [ ] **Step 5:** `pnpm --filter @driver/i18n test`, then the customer, partner and API suites; fix expectations that asserted «1 دقيقة»/«5 دقيقة». Commit "i18n: natural minute forms (J-D9) — دقيقة, دقيقتين, 5 دقايق, 15 دقيقة — through t() everywhere".

### Task 2: the part of day on الرجعة times (R-06) and the day on the pass

- [ ] **Step 1 (tests):** `time.test.ts`:
  ```ts
  expect(formatHourPart(at('2026-10-01T13:00:00Z'))).toBe('4 العصر');      // 16:00 Baghdad
  expect(formatHourPart(at('2026-10-01T15:15:00Z'))).toBe('6:15 المسا');
  expect(hourWindow(at('2026-10-01T17:00:00Z'), at('2026-10-01T19:00:00Z'))).toEqual({ from: '8', to: '10 بالليل' });
  expect(hourWindow(at('2026-10-01T13:00:00Z'), at('2026-10-01T15:00:00Z'))).toEqual({ from: '4', to: '6 العصر' });
  expect(hourWindow(at('2026-10-01T14:50:00Z'), at('2026-10-01T15:55:00Z'))).toEqual({ from: '5:50 العصر', to: '6:55 المسا' });
  ```
  `departure.test.ts` / `DepartureTime.test.tsx`: `alwaysDay` → sub «اليوم · بعد 38 دقيقة»; `partOfDay` → period «المسا».
- [ ] **Step 2:** implement `dayPart`, `formatHourPart`, `hourWindow` in `time.ts` (keys `time.part_late|morning|noon|afternoon|evening|night`; English AM/PM); `departureParts(…, { alwaysDay, partOfDay })`; `DepartureTime` props.
- [ ] **Step 3:** customer: `windowLabel` uses `hourWindow`; the demand chip «4–6 العصر» (`rajaa.window_range` "{from}–{to}"); the pass hero passes `alwaysDay partOfDay`; tests in `rajaa/logic.test.ts` / labels.
- [ ] **Step 4:** commit "الرجعة: every time says the part of day («4–6 العصر», «بين 8 و 10 بالليل»); the pass says «اليوم · 6:15 المسا» (R-06)".

### Task 3: wording sweep (f16) and «دينار» after every amount

- [ ] **Step 1 (test):** voice rule `{amount}` without « دينار» (skip `console.*`, allow `{amount}%`) + case in `voice.test.ts` → FAIL on the current table.
- [ ] **Step 2:** locale edits (ar + en parity):
  `home.service_food` «أكل»; `cart.empty`, `empty.cart` «سلتك فاضية»; `household.limit_hint` «خليه فاضي = بلا حد»; `cart.line_saving` «توفّر {amount} دينار»; `rajaa.front_free` «القدام فاضي +{amount} دينار»; `rajaa.line_seats*` «… × {amount} دينار»; `ride.cheaper_by` «أرخص بـ {amount} دينار»; `errand.actual_total`; partner `{amount}` strings the rule flags; `intercity.travelling_as` «منو مسافر؟» + `rajaa.pick_traveller_first` «گلنا منو مسافر» for the hold hint; `rajaa.share_message` «رحلتي {route} الساعة {time}، السيارة {plate}. تابع الطريق ويّاي: {link}»; `wallet.top_up_agent` «اشحن عند وكيل الشحن», `wallet.top_up_via_driver` «اشحن كاش ويا الدليفري أو السايق بطلبك الجاي», `topup.where_agent` «وكيل الشحن», `topup.where_courier` «الدليفري أو السايق بطلبك الجاي»; `reorder.total_note` «نحسب المجموع النهائي بالسلة بأسعار اليوم»; `household.approval_request` «طلب من {name}: {amount} دينار»; `onboarding.welcome_body` (honest, unused); `net.offline` «النت مقطوع. نحاول نرجع…».
- [ ] **Step 3:** signed chips: `ItemSheet` option chips, `ChangeCredited`, `SheetParts` credit line, `Arrival` change line, `ride/choose` door extra, `rajaa/departure/[id]` meeting points and door, `DepartureTile` way chip → `iqd(x, { locale, sign: true })`.
- [ ] **Step 4:** test + commit "Copy: «أكل», «سلتك فاضية», دينار after every amount, «منو مسافر؟», gender-free share and approval, one word for top-up agents, no «السيرفر» (f16)".

### Task 4: ride arrived copy (L-09)

- [ ] **Step 1 (test):** `arrival-copy.test.ts`: `rideArrivedLine(view)` → `{ name: 'عباس', minutes: 12 }` from the pickup stop's `completedAt` to the trip's `completedAt`; null minutes without times; null name falls back.
- [ ] **Step 2:** keys `track.arrived_ride_with` «ويا {name} · {minutes} دقيقة», `track.arrived_ride_with_name` «ويا {name}», `track.rate_driver_cta` «قيّم {name}»; `Arrival.tsx` and the receipt button on `order/[id].tsx` use them for rides; food keeps «قيّم بلمستين».
- [ ] **Step 3:** commit "Customer ride arrived: «ويا عباس · 12 دقيقة» and «قيّم عباس» (L-09)".

### Task 5: small bugs (f15)

- [ ] **RestaurantRow (D-12):** line 1 `★ 4.7 · 30–40 دقيقة` (no wrap), line 2 the fee alone; no `Dot` can end a line.
- [ ] **Places (D-17, A-06):** `briefcase` icon in `paths.ts`; `placeIcon(label)` (`home` → home, `work` → briefcase, `family` → user, else map-pin) with a test, used by the picker, account, PlaceForm, PlaceEditor; picker drops its trailing check (`ListRow selected` draws it).
- [ ] **Toast over the pass (C-38):** `ToastData.placement?: 'bottom' | 'top'`; top = `insets.top + space[2]`; the pass's toasts use `placement: 'top'`, 3 s.
- [ ] **Plate at 360 (R-08):** `DepartureTile`: `useWindowDimensions().width < 380` → seat map under the driver block; driver column `minWidth: 0`.
- [ ] **Back everywhere (C-26, A-02):** root `rajaa/index` (fallback `/`), `rajaa/departure|booking|pass|request` (fallback `/rajaa`); `household`, `profile`, `places` layouts `headerLeft: () => <HeaderBack fallback=… />`.
- [ ] Commits per item group.

### Task 6: the late banner is an inverse banner (f17, S2-02)

- [ ] **Step 1 (test):** add roles `inverse`, `onInverse`, `onInverseMuted`, `onInverseCaution`, `onInverseSuccess` to both themes, pairs in `contrastPairs` (onInverse, onInverseMuted, onInverseSuccess on inverse) and `nonTextPairs` (onInverseCaution, onInverseSuccess on inverse); update the brand-hex test for the new warning hue → run → FAIL until tokens exist.
- [ ] **Step 2:** tokens (light: ink `#1F1A14`, cream `#FBF6EE`, `#D6C8B4`, saffron `#F2C14E`, `#7ACF9D`; dark: cream `#F6EFE4`, ink, `#4A4239`, `#8A5300`, `#23744A`); warning hue as in the decisions table; regenerate `tokens.json`; brand spec note.
- [ ] **Step 3:** `LateBanner`: inverse background, saffron clock, cream title (bold), muted cream note, bar track `withAlpha(onInverseCaution, .25)`, fill saffron / success.
- [ ] **Step 4:** screenshots of the late banner and screens with warning pills; commit.

### Task 7: no moment sounds on a silent Android (f7, L-24)

- [ ] **Step 1 (test):** `moment-sound.test.ts`: `momentChannelId('near')` → `moment_near`; `MOMENT_CHANNELS` lists the four cues with their bundled files; `momentBehavior({ moment: 'near' })` → `{ shouldShowAlert: false, shouldPlaySound: true, shouldSetBadge: false }`, other data → `null` (default handling); `cueRoute('android')` → `'ring'`, ios/web → `'media'`.
- [ ] **Step 2:** `push.native.ts` handler uses `momentBehavior`; `sound.ts` on Android: create the cue's channel once (`setNotificationChannelAsync`, importance DEFAULT, no vibration, sound file) and `scheduleNotificationAsync({ content: { data: { moment }, sound: file }, trigger: { channelId } })`; errors → no sound. `app.json` plugin `sounds` with the four wavs. Locale keys for the channel names.
- [ ] **Step 3:** commit "Customer: moment sounds on Android ride the ring stream, so silent and vibrate stay silent (f7, L-24)".

### Task 8: force light (J-D4)

- [ ] `apps/customer/app.json` `"userInterfaceStyle": "light"`; commit.

### Task 9: gate and screenshots

- [ ] `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] Web export before/after, demo API on 3314, Playwright: home (service tile, restaurant cards), late banner, الرجعة board at 360, pass; saved to the scratchpad `j1f/` folder.
