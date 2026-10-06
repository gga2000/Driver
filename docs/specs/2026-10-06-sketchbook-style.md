# Aziziyah sketchbook: the illustration style (joy J4)

Date: 2026-10-06. Program: `docs/specs/2026-10-05-customer-joy.md` §5.4. Sources: design-system report S2-07,
S2-08, S2-12 and §5 Direction A; food-funnel S-3. Plan: `docs/superpowers/plans/2026-10-06-j4-sketchbook-art.md`.

No AI image generator was available, so the set is hand-built vector art (`react-native-svg`), one style,
drawn in code. It is the interim Ali approved (J-D3) until a real illustrator and the menu photo day.

## Rules

- **Drawings, never photos.** A drawing must not pretend to be a restaurant's real food. No faces, no
  logos, no real shop signs. A merchant photo always replaces the drawing (and low-data mode shows the drawing).
- **Shapes:** flat gouache fills, no gradients. Light from the top start side; at most one shade shape per object.
- **Line:** one date-brown ink line (`art.line` `#3A2414`) drawn a little off its fill (1.6 units across,
  1.3 up), like a hand-inked print. Width 4 units in the 200 dish box (about 2 px at a 96 px thumbnail),
  2.6 in the restaurant hero, 2.4 in scenes (shown at about 1 unit per px).
- **Frame:** scenes sit in a shanasheel arch (straight sides, softly pointed top). Dishes have a faint arch
  window behind them. The tilt of a dish look turns the dish, never its window.
- **Pigments:** fixed in light and dark. Food uses the `art.*` tokens. Scenes add kashi `#0B6577`, saffron
  `#F2C14E`, palm `#2F7D4E`, pomegranate `#B23A2E`, the green door `#2F6B4F`, the Tigris `#86B7C0` and a
  night kashi sky `#163A44`. These live in `SKETCH` (`packages/ui/src/art/kit.tsx`) until the token owner
  adopts them as `art.*` roles. Decoration only: no text ever sits on them.
- **Budget (3 GB-RAM Android):** at most 40 SVG elements per dish and 90 per scene (a test enforces this);
  nothing redraws per frame.
- **Motion:** one loop only, the waiting kitchen's steam (opacity 0.35 to 0.8, a 4 px drift, 2.4 s),
  moved as a layer. It stays still under reduced motion.
- **Accessibility:** drawings are decorative by default (hidden from screen readers; the screen's own
  title says what it shows). Give `SketchScene` a `label` (locale keys `art.scene.*`, Arabic and English)
  when a drawing stands on its own.

## The set

Code: `packages/ui/src/art/` (`kit.tsx`, `dishes.tsx`, `props.tsx`, `scenes.tsx`, `SketchScene.tsx`),
exported from `@driver/ui` as `DishDrawing`, `DISH_KINDS`, `SketchScene`, `SCENE_NAMES`, `SKETCH`.
Gallery: `pnpm --filter @driver/ui gallery:dev`, section «دفتر رسم العزيزية»; open `#sketchbook` for the
contact sheet alone (`#sketchbook-180` draws the dishes at 180 px).

**Dishes (27):** kebab, tikka, liver, chicken, shawarma, falafel, wrap (لفة), plate (rice, a skewer,
salad), tray (kilo on tannour bread), rice (تمن ومرق), okra (باميا), beans (فاصوليا), soup (عدس),
pacha (باچة pot), dolma, fish (مسگوف), kubba, bread (صمون), salad, pickles (طرشي), hummus, sweet
(kunafa), tea (istikan), laban, water, can, juice. `apps/customer/src/features/food/food-art.ts` picks
one from the dish name, then its menu section, then the plate meal. Looks come from a hash of the
dish id, and adjacent rows never share a drawing.

**Scenes (10):** `kitchen`, `rejected`, `empty_cart`, `empty_orders`, `door`, `doorbell`, `offline`,
`night`, `safe_arrival` (vehicle: minibus, tuktuk or car), `welcome`.

## Where they are used (customer app)

| Screen | Drawing |
|---|---|
| Menus, cart upsell, search, item sheet, restaurant hero (`FoodArt`) | the dish set |
| Waiting for the kitchen (`app/kitchen/[id].tsx`) | `kitchen` with steam; the 90 s ring becomes a medallion on its sill |
| Kitchen said no | `rejected` (two empty chairs) |
| Arrival (`features/track/Arrival.tsx`) | `door` for food; `safe_arrival` with the ride's vehicle; no glow, no confetti |
| Notification ask (`features/notify/PrePrompt.tsx`) | `doorbell` |
| Empty cart / empty orders | `empty_cart` / `empty_orders` (through `EmptyState`'s new `art` prop) |
| Menu can't load, offline or unreachable | `offline` (through `RetryState`'s new `art` prop) |
| Kitchen closed, between 19:00 and 06:00 | `night` thumbnail in the closed card (by day, or paused, the clock stays) |

Not used yet: `welcome` (the welcome screen already has the map of home, `features/welcome/WelcomeMap`,
so it stays) and the home night card (home is being redone in J3a; the `night` scene is ready for it).
`safe_arrival` with the minibus is ready for a الرجعة trip ending, which has no screen yet.
