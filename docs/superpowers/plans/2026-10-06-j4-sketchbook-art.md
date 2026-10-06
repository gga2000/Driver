# J4 — Aziziyah sketchbook illustration set: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interim dish motifs and the icon-in-a-circle status screens of the customer app with one consistent, hand-built vector illustration set: ~27 dish archetypes and 10 arch-topped scenes in the "Aziziyah sketchbook" style.

**Architecture:** All drawings live in `@driver/ui` under `packages/ui/src/art/` (shared: the UI gallery shows them, the partner and merchant apps can reuse the scenes later). A small style kit (`kit.tsx`) holds the fixed pigments, the ink line and the arch frame. `DishDrawing` draws one dish in a 200 × 200 box; `SketchScene` draws one scene in a 320 × 200 arch frame. The customer app's `FoodArt` keeps its API (`motif`, `look`, `photoUrl`, `variant`, `style`) and draws through `DishDrawing`; `food-art.ts` keeps choosing the motif per dish, now from a wider set. `EmptyState` and `RetryState` take an optional `art` node that replaces the icon tile.

**Tech Stack:** react-native-svg 15.8 (static paths), Reanimated 3.16 (steam loop: opacity and translate of a View only), vitest + react-native-web (tests and the gallery), Playwright (contact sheet and screenshots).

**Source docs:** `docs/specs/2026-10-05-customer-joy.md` §4 (art pipeline), §5.4 (J4), §6 (performance, motion); `docs/research/ui-ux-audit/2026-10-05-joy/5-design-system.md` S2-07, S2-08, S2-12, §5 Direction A; `2-food-funnel.md` S-3.

**Honesty rule (J-D3):** drawings only, never photoreal, no faces, no logos or real shop signs. A merchant photo always wins over a drawing.

---

## Style guide (the "one page")

- **Shapes:** flat gouache fills, no gradients. Light falls from the top start side; one darker shade shape per object at most.
- **Line:** one date-brown ink line `art.line` `#3A2414`. The outline is drawn as a separate stroke shifted 1.5 units off the fill (a slight misregistration, like a hand-inked print), with round caps. Width: 4 units in the 200 box (≈ 2 px at a 96 px thumbnail), 2.4 units in heroes and scenes.
- **Frame:** scenes sit in an arch-topped window (shanasheel arch: straight sides, a pointed round top). Dish thumbnails get a faint arch "window" behind the plate in a deeper paper tone.
- **Pigments (fixed in both themes, decoration only, no text on them):** the `art.*` tokens (meat, char, chicken, tomato, herb, onion, bread, rice, tea, water, laban, can, juice, metal, steam, plate, rim, paper, line) plus scene pigments kept in `kit.tsx` until the token owner adopts them: kashi `#0B6577`, saffron `#F2C14E`, palm `#2F7D4E`, pomegranate `#B23A2E`, door green `#2F6B4F`, sky `#F3E2C3`, river `#7FB2BE`, night `#24170E`.
- **Budget:** each dish ≤ 40 SVG elements, each scene ≤ 90; no per-frame path changes; paper grain is one static layer of dots.
- **Motion:** only the waiting-kitchen steam loops (opacity 0.3 ↔ 0.7, translateY 0 ↔ −4 over 2.4 s), static under reduce motion.

## File structure

| File | Responsibility |
|---|---|
| `packages/ui/src/art/kit.tsx` | Pigments (`SKETCH`), `Ink` outline helper, `archPath()`, `Steam`, `Grain`, `Shadow` |
| `packages/ui/src/art/dishes.tsx` | `DISH_KINDS`, `type DishKind`, `DishDrawing({ kind, look, line })` |
| `packages/ui/src/art/scenes-food.tsx` | kitchen, rejected, emptyCart, emptyOrders, door, doorbell |
| `packages/ui/src/art/scenes-town.tsx` | offline, night, safeArrival (minibus / tuktuk / car), welcome |
| `packages/ui/src/art/SketchScene.tsx` | `SCENE_NAMES`, `type SceneName`, `SketchScene({ name, label, vehicle, animate, style })` with arch frame and the steam loop |
| `packages/ui/src/art/art.test.tsx` | renders every dish and scene; element budget; decorative vs labelled a11y |
| `packages/ui/src/index.ts` | exports |
| `packages/ui/src/components/EmptyState.tsx`, `RetryState.tsx` | optional `art?: ReactNode` replacing the icon tile |
| `packages/ui/gallery/Gallery.tsx` | "Sketchbook" section: every dish (3 looks) and every scene |
| `packages/i18n/src/locales/{ar-IQ,en}.json` | `art.scene.*` labels |
| `apps/customer/src/features/food/food-art.ts` | wider `Motif` union (= `DishKind`), new name rules |
| `apps/customer/src/features/food/food-art.test.ts` | rules for the new archetypes |
| `apps/customer/src/features/food/FoodArt.tsx` | draws through `DishDrawing`, same props |
| `apps/customer/app/kitchen/[id].tsx` | waiting: kitchen scene inside the ring area; rejected: the empty-chairs scene |
| `apps/customer/src/features/track/Arrival.tsx` | hero only: door scene (food) / safe-arrival scene (rides), glow removed; quiet-day and once-per-order logic untouched |
| `apps/customer/src/features/notify/PrePrompt.tsx` | doorbell scene strip instead of the bell circle |
| `apps/customer/app/cart.tsx`, `app/(tabs)/orders.tsx` | empty states with scenes |
| `apps/customer/app/restaurant/[id].tsx` | offline/unreachable `RetryState` with the offline scene; the closed card at night with the night scene |
| `docs/specs/2026-10-06-sketchbook-style.md` | the style guide above, the set list, where each drawing is used |

Welcome: the newer welcome (`5a7153c`) already has `WelcomeMap`, a map of home. It stays; the welcome scene is drawn and shown in the gallery only.

## Tasks

### Task 1: Style kit and dish set in `@driver/ui`

**Files:** create `packages/ui/src/art/kit.tsx`, `packages/ui/src/art/dishes.tsx`, `packages/ui/src/art/art.test.tsx`; modify `packages/ui/src/index.ts`.

- [ ] **Step 1: failing test** (`art.test.tsx`):

```tsx
import { describe, expect, it } from 'vitest';
import Svg from 'react-native-svg';
import { renderUI } from '../test/render';
import { DISH_KINDS, DishDrawing } from './dishes';

describe('sketchbook dishes', () => {
  it('has the S-3 archetypes', () => {
    for (const k of ['kebab', 'tikka', 'liver', 'chicken', 'shawarma', 'falafel', 'plate', 'tray', 'rice', 'okra', 'beans', 'soup', 'pacha', 'dolma', 'fish', 'kubba', 'bread', 'salad', 'pickles', 'hummus', 'sweet', 'tea', 'laban', 'water', 'can'] as const) expect(DISH_KINDS).toContain(k);
  });
  it.each(DISH_KINDS)('%s draws within the element budget', (kind) => {
    for (const look of [0, 1, 2]) {
      const { container } = renderUI(<Svg viewBox="0 0 200 200"><DishDrawing kind={kind} look={look} /></Svg>);
      const n = container.querySelectorAll('path,circle,ellipse,rect,line,polygon').length;
      expect(n).toBeGreaterThan(3);
      expect(n).toBeLessThanOrEqual(40);
    }
  });
});
```

- [ ] **Step 2:** `pnpm --filter @driver/ui test -- art` → FAIL (module not found).
- [ ] **Step 3: kit** — `SKETCH` = `{ ...art, kashi, saffron, palm, pomegranate, door, sky, river, night }`; `Ink({ d, w })` = `<Path d stroke={SKETCH.line} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(1.5 -1.2)" />`; `archPath(x, y, w, h)` = straight sides, a two-arc pointed top whose rise is 0.42·w; `Steam({ x, y, h })` = two S-curves in `art.steam`; `Grain({ w, h, n, seed })` = n tiny dots in `art.char` at opacity 0.08 placed by a fixed multiplicative sequence (deterministic); `Shadow({ cx, cy, rx })` = ellipse in `art.rim`.
- [ ] **Step 4: dishes** — `DishDrawing({ kind, look = 0, line = 4 })` returns a `<G>` in a 200 × 200 box. `look` picks the plate tint (`art.plateTints[look]`), the garnish (looks 0 and 2) and nothing else (FoodArt applies the tilt). Each dish: faint arch window behind (`SKETCH.rim` at 0.35), a shadow, gouache fills, then one `Ink` path for the main silhouette. Silhouettes, chosen to differ at 64 px:
  - kebab: two long minced-meat logs on a skewer with a grilled tomato and onion rings, on an oval plate;
  - tikka: one skewer of square cubes alternating meat / onion / tomato, slanted;
  - liver: small dark irregular cubes heaped with a lemon wedge;
  - chicken: two pale-gold skewers of round pieces crossing;
  - shawarma: a wrap in paper, upright cone, meat strips at the top;
  - falafel: a samoon split open with brown balls and herb;
  - wrap (لفة): flat tannour bread rolled diagonally, kebab end and herb peeking;
  - plate: rice mound + one skewer + small salad heap on a round plate;
  - tray: a big round tray, tannour bread under it, kebab logs fanned, tomato and onion;
  - rice (تمن ومرق): rice mound left, a small bowl of red marag right;
  - okra (باميا) / beans (فاصوليا): the same deep bowl; okra = tomato-red stew with green ringed pods, beans = orange-red stew with pale oval beans; a rice dome behind;
  - soup: wide bowl of lentil yellow with a lemon wedge and cumin dots;
  - pacha: a tall metal pot with a lid ajar and bread at its foot;
  - dolma: a pan of rolled vine leaves (green ovals with vein lines) and stuffed onion/pepper;
  - fish (مسگوف): an opened butterflied fish, grilled stripes, on tannour bread, lemon;
  - kubba: three spindle-shaped kubba (pointed ends) with a lemon;
  - bread (صمون): two diamond samoon loaves with a centre slash;
  - salad: a bowl of chopped tomato, cucumber and parsley;
  - pickles (طرشي): a jar with pink turnip slices and green chillies, red lid;
  - hummus: a shallow bowl, swirl, oil pool and three chickpeas;
  - sweet: a round kunafa tray wedge with pistachio on top, plus two zalabia rings;
  - tea: istikan on its saucer, amber tea, sugar spoon;
  - laban: a tall glass of white laban with a froth line;
  - water: a ribbed plastic bottle with a blue cap and blank label;
  - can: a soft-drink can with a plain band (no brand), pull tab;
  - juice: a glass of orange juice with a straw and a slice.
- [ ] **Step 5:** export `DishDrawing`, `DISH_KINDS`, `type DishKind`, `SKETCH` from `src/index.ts`; run the test → PASS; `pnpm --filter @driver/ui typecheck lint`.
- [ ] **Step 6: commit** "Sketchbook art kit and the dish set in @driver/ui (J4)".

### Task 2: Scenes

**Files:** create `scenes-food.tsx`, `scenes-town.tsx`, `SketchScene.tsx`; extend `art.test.tsx`; add `art.scene.*` keys to both locales.

- [ ] **Step 1: failing tests**:

```tsx
import { SCENE_NAMES, SketchScene } from './SketchScene';
it.each(SCENE_NAMES)('scene %s renders within budget and is decorative by default', (name) => {
  const { container } = renderUI(<SketchScene name={name} />);
  expect(container.querySelectorAll('path,circle,ellipse,rect,line,polygon').length).toBeLessThanOrEqual(90);
  expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
});
it('a labelled scene is an image with its label', () => {
  const { getByLabelText } = renderUI(<SketchScene name="offline" label="ماكو إنترنت" />);
  expect(getByLabelText('ماكو إنترنت')).toBeTruthy();
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: scenes** (viewBox 320 × 200, arch frame clip, paper inside, ground line): kitchen (a pot on a gas ring, tiled kashi wall, ladle, samoon basket; steam drawn separately so `SketchScene` can animate it); rejected (a table with a cloth, two empty chairs, an empty plate and a folded napkin); emptyCart (an empty woven market basket on the floor tiles); emptyOrders (an empty plate and an istikan on a tray by a window); door (the green Iraqi double door ajar, warm light in the gap, a food bag on the step, a potted plant); doorbell (a gate pillar with a bell button and sound arcs, the green door edge); offline (Tigris curve, two palms, a phone mast with a crossed-out signal); night (crescent and stars over the market rooftops with closed shutters, one lit window); safeArrival (`vehicle`: garage minibus, tuktuk with canopy fringe, or car, on the road home between palms, sun low); welcome (the Tigris curve, palms, the market, a tuktuk and the minibus).
- [ ] **Step 4: `SketchScene`** — `View` with `aspectRatio: 1.6`, `Svg` 320 × 200, decorative by default (`accessible={false}`, `importantForAccessibility="no-hide-descendants"`, `accessibilityElementsHidden`, `aria-hidden`), or `accessibilityRole="image"` + `accessibilityLabel={label}` when `label` is given. Kitchen: an absolutely positioned `Animated.View` holding the steam `Svg`, `withRepeat(withTiming)` on opacity and translateY; skipped when `theme.reduceMotion` or `animate === false`.
- [ ] **Step 5:** locale keys `art.scene.kitchen|rejected|empty_cart|empty_orders|door|doorbell|offline|night|safe_arrival|welcome` in `ar-IQ.json` and `en.json` (parity test). Run `pnpm --filter @driver/ui test` and `pnpm --filter @driver/i18n test` → PASS.
- [ ] **Step 6: commit** "Sketchbook scenes: kitchen, door, doorbell, empty, offline, night, safe arrival, welcome (J4)".

### Task 3: `FoodArt` draws the new set

**Files:** `apps/customer/src/features/food/food-art.ts`, `food-art.test.ts`, `FoodArt.tsx`.

- [ ] **Step 1: failing tests** in `food-art.test.ts`:

```ts
it('J4 archetypes', () => {
  expect(motifForDish('باچة')).toBe('pacha');
  expect(motifForDish('دولمة')).toBe('dolma');
  expect(motifForDish('مسگوف')).toBe('fish');
  expect(motifForDish('سمچ مسكوف')).toBe('fish');
  expect(motifForDish('كبة حلب')).toBe('kubba');
  expect(motifForDish('تمن وباميا')).toBe('okra');
  expect(motifForDish('فاصوليا يابسة')).toBe('beans');
  expect(motifForDish('حمص')).toBe('hummus');
  expect(motifForDish('كيلو كباب')).toBe('tray');
  expect(motifForDish('صينية مشكل')).toBe('tray');
  expect(motifForDish('وجبة كباب')).toBe('plate');
  expect(motifForDish('شوربة عدس')).toBe('soup');
  expect(motifForDish('صمون حجري')).toBe('bread');
});
```

and update the two existing expectations that change meaning (`وجبة كباب` is now the plate meal, `تمن ومرق` stays `rice`). Every `Motif` must be a `DishKind`: `type Motif = DishKind`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** new `BY_NAME` rules, before the general ones: `باچة|باجة|پاچة → pacha`, `دولمة|محشي|يبرق → dolma`, `مسگوف|مسكوف|سمچ|سمك → fish`, `كبة|كبه → kubba`, `باميا → okra`, `فاصوليا|لوبيا → beans`, `حمص → hummus` (before salad), `كيلو|صينية|سفرة → tray`, `وجبة … (كباب|تكة|مشكل) → plate` via `/وجبة (كباب|مشكل|مشكّل)/`, `مرق → rice`; keep the existing ones. The same no-same-neighbour rule and the hash look are unchanged.
- [ ] **Step 4:** `FoodArt.tsx` keeps its props and photo/lite behaviour; the drawing becomes `<DishDrawing kind={motif} look={look} line={hero ? 2.6 : 4} />` inside the existing thumb/hero transforms; hero keeps the sesame scatter on paper. Remove the old local motif functions.
- [ ] **Step 5:** `pnpm --filter @driver/customer test typecheck lint` → PASS (including "adjacent rows never share a drawing on every launch menu").
- [ ] **Step 6: commit** "Menus draw the sketchbook dish set: باچة, دولمة, مسگوف, كبة, باميا, فاصوليا, حمص, trays and plate meals (J4)".

### Task 4: Screens use the scenes

**Files:** `packages/ui/src/components/EmptyState.tsx`, `RetryState.tsx`; customer `kitchen/[id].tsx`, `Arrival.tsx`, `PrePrompt.tsx`, `cart.tsx`, `(tabs)/orders.tsx`, `restaurant/[id].tsx`.

- [ ] **Step 1: failing test** (`packages/ui/src/art/art.test.tsx`): `EmptyState` with `art={<View testID="a" />}` renders the art and no icon tile; `RetryState kind="offline" art={…}` the same.
- [ ] **Step 2:** add `art?: ReactNode` (replaces the tilted tile when given; width capped at 280).
- [ ] **Step 3:** kitchen waiting: the bobbing bag in a circle becomes the kitchen scene (steam loop, max 300 wide). The 90 s accept ring stays as the time signal, shrunk to a 72 px medallion (seconds inside, on a surface disc) overlapping the bottom centre of the scene. Rejected: the warning circle becomes the empty-chairs scene; the "no suggestions" empty state keeps its clock icon.
- [ ] **Step 4:** Arrival (contained to the hero block, per coordinator): food → door scene, ride → safe-arrival scene with the vehicle from `view.courier.vehicleClass` (tuktuk → tuktuk, van/intercity → minibus, else car). The orange check circle, its glow and the multi-colour burst go; the scene fades/zooms in only when `celebrate`, else fades (or nothing under reduce motion). `useArrivalOnce`, `arrivalPlays`, the quiet-day haptic and `CashAtDoor` are untouched.
- [ ] **Step 5:** `PushAskCard`: a 72 px-high doorbell scene band at the top of the card instead of the bell circle; copy and buttons unchanged.
- [ ] **Step 6:** cart empty → `emptyCart`; orders empty → `emptyOrders`; restaurant offline/unreachable `RetryState` → `offline`; restaurant closed card (not paused) → a 64 px night scene thumbnail instead of the clock icon.
- [ ] **Step 7:** full gate `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 8: commit** "Customer screens: kitchen, rejected, arrival door, doorbell ask, empty cart and orders, offline and night drawings (J4)".

### Task 5: Gallery, style doc, contact sheet, screenshots

- [ ] Gallery "Sketchbook" section (every dish × 3 looks at 96 px; every scene at 320 px; safe arrival × 3 vehicles).
- [ ] `docs/specs/2026-10-06-sketchbook-style.md` (style guide, set, usage map, the welcome decision).
- [ ] Build the gallery, render a contact sheet with Playwright, look at it, iterate on any drawing that doesn't read at 64 px.
- [ ] Customer web export + demo API on port 3316: before (main export) and after screenshots of kitchen waiting, rejected, arrival, empty cart, empty orders, push ask.
- [ ] Commit "Gallery: the sketchbook page; style guide doc (J4)".
