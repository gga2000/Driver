# 5 · Design system and visual language audit (customer app + `@driver/ui`)

Date: 2026-10-05 · Scope: the whole visual language of the customer app (colour, type, icons,
illustration, shape, elevation, motion, sound, haptics, dark mode, texture, data screens).
This is an audit only. No repo file was changed.

**Method.**
- **Skills applied:** `impeccable` (anti-pattern and AI-slop rules, font-selection procedure), `critique` (Assessment A as an LLM review, Assessment B with the deterministic detector), `high-end-visual-design` (adapted to native; what doesn't transfer is in §5.5), `colorize`, `polish`, `design:design-system`, `design:accessibility-review`, `marketing:brand-review`. `brand-guidelines` was loaded but holds Anthropic's own brand, so it was not used.
- **Evidence:** 35 of the 58 capture screenshots (all groups), plus new captures in `shots-extra/system/`:
  - a clean tracking screen with the push prompt dismissed;
  - a live dark-theme simulation that remaps every light token to its dark role;
  - 22 Arabic display faces rendered with real app strings;
  - Brand 2.0 mock screens.
- **Measurements:**
  - colour-family pixel share on 13 screens;
  - OKLab ΔE between roles;
  - WCAG ratios for every proposed pair;
  - font-file metrics with fontTools (vertical metrics, tabular digits, size).

Screenshot names below refer to `scratchpad/audit/shots/` unless prefixed `extra/`, which means
`scratchpad/audit/shots-extra/system/`.

---

## 1. Scores

| Area | Now | Target | Why this score |
|---|---|---|---|
| **System overall** | **5.0** | **8.5** | The engineering is excellent: tokens are disciplined, contrast is tested in CI, and the RTL Arabic metrics are right. But the brand has no soul. It is one colour, one typeface, no illustration language, generic sounds and no night mode. It reads as competent and calm, and anonymous. |
| Colour | 5 | 8.5 | Tokens pass AA and are tested. Measured share: 81% cream/white, 13% orange family, under 1% any other hue. One orange carries 7 meanings. Warning tint and accent tint differ by ΔE 0.9, so they are the same colour. Semantic green and blue are reused as restaurant and person identity. There is no food-appetite colour. |
| Typography | 5 | 8.5 | IBM Plex Sans Arabic is well tuned (line height ×1.65, tabular numerals, numeral tokens, a 12 px floor). But one family does everything, nothing is a display voice, and the wordmark is just Plex Bold. The scale's lower steps sit about 1.07× apart, and display is only 30 px. |
| Iconography | 6 | 8 | 45 custom glyphs on one 24 px grid with 1.75 strokes, round caps and correct RTL mirroring. The geometry is Lucide-generic: food is a shopping bag, الرجعة is a barn, men, women and family share one glyph, and there are no filled or active variants. |
| Illustration | 3 | 8 | FoodArt is a good idea drawn in primitives. One kebab plate appears on 9 different dishes, and three drinks share one red can. Elsewhere, monograms and tilted icon tiles stand in for art. The door on the arrival screen is the only real scene. |
| Shape and elevation | 5 | 8 | The token radii carry hierarchy and shadows are warm brown. But surface on background is 1.08:1, so cards exist only through a 7% shadow that disappears in sun. Cards mix borders and shadows. 47 files use raw radii (about 20 values). There is no signature shape. |
| Motion | 5 | 8.5 | A good base: press and select springs, pulse, count-up and reduce-motion support in `@driver/ui`. But there is no signature motion. Peak moments are hand-tuned (21 literal durations or springs in 7 files). There are no shared presets. Old item S-24 is still open. |
| Sound and haptics | 5 | 8 | 4 synthesized cues, silent switch respected, an in-app off switch, and a 7-kind haptic adapter. The chimes are generic major arpeggios, there is no sonic logo, the order push uses the system sound, and every button press buzzes. |
| Dark mode | 3 | 8 | `themes.dark` is complete and AA-tested, and the simulation shows the roles remap cleanly. But it is not wired up (`theme="light"` is hard-coded and `userInterfaceStyle: "automatic"`), the wallet uses `text` as a surface, FoodArt pigments invert, and dark mode drops shadows with nothing to replace them. |
| Accessibility (visual) | 7.5 | 9 | A real strength: `contrastPairs`/`nonTextPairs` in CI, an ink focus ring, a check icon on every selection, 44 px targets, a compact font-scale cap. Still open: 10 to 11 px text (maps, chat), star fill at 2.68:1, a disabled CTA whose label is about 1.7:1, and tints that carry meaning on their own. |

**Old IDs from `system-a11y-copy.md`.**
- **Still open:**
  - **S-10 (partial):** map attribution is still 10 px and chat meta 11 px.
  - **S-15:** raw radii in 47 customer and ui files.
  - **S-16:** `apps/merchant/src/components/MIcon.tsx` still exists.
  - **S-24:** motion literals.
  - **S-28:** `theme="light"` with `userInterfaceStyle: "automatic"`.
  - **S-29:** fonts swap in after first paint, with no splash hold.
- **Fixed since then:** S-04 (`borderStrong #8C7F6F`, `nonTextPairs`), S-07 (OfflineBanner), S-11 (compact cap), S-13 (focus ring), S-21 (toast timing). S-10's numeral tokens also landed.

---

## 2. The roast

1. The whole app is one colour. 81% cream, 13% orange, and every other hue rounds to zero. It's a paper bag with a stamp on it.
2. Orange means *buy*, *selected*, *live*, *link*, *rating*, *your order* and *we're late*. When everything shouts, the "اطلب هسة" button is just one more orange thing on a screen with six of them (item sheet).
3. "Warning" and "brand" are the same colour (ΔE 0.9). The *we're late* banner looks like a promo for your own order.
4. The menu shows the same kebab drawing 9 times. Water, Pepsi and شنينة are all the same red can. Appetite dies on the restaurant page, and that is exactly where it is decided.
5. Restaurants are letters in pastel squares. خ is green, so مطعم خالد looks like a success message.
6. IBM Plex Arabic is a fine typeface for a bank statement. Here it also sets the wordmark, the arrival celebration and the welcome hello. Nothing in the type says *Aziziyah*, or even *food*.
7. The status screens follow the default template: icon in a tinted circle, centred title, three bullet rows with icon tiles. The arrival, the app's peak moment, is an orange checkmark with an orange glow.
8. The sonic identity is a free-tier synthesizer playing C-E-G-C. Nobody will ever hum it.
9. A town that orders kebab at 1 a.m. in summer gets a full-white screen. The dark theme exists and nobody switched it on.
10. The bones are better than most funded startups': tested contrast, Iraqi voice, the seat map, the licence plate, the boarding pass, the door photo. The soul just hasn't been designed yet.

---

## 3. Automated detector (critique Assessment B)

| Scan | Command | Result |
|---|---|---|
| Source (required) | `npx impeccable --json --fast apps/customer/app apps/customer/src packages/ui/src` | **`[]`, 0 findings in 151 TSX files.** CLI note: `--fast is deprecated and ignored`. The explicit `impeccable detect --json …` also returns `[]`. |
| Sanity probe | a throwaway TSX in scratchpad with `borderLeft:'4px solid'` + `text-gray-500 on bg-purple-600` | Detector caught `side-tab` and `gray-on-color`. So it does parse TSX style objects, and the 0 is real. |
| Live URLs at 390×844 (`detect --json --viewport 390x844`) | `/`, `/restaurant/org_1`, `/restaurant/org_3`, `/search`, `/restaurants` | 33 findings, broken down in the next table. |

| Rule | Category | Count | Where | Verdict |
|---|---|---|---|---|
| `cream-palette` ("cream page background rgb(251,246,238)") | slop, warning | 5 (1 per route) | every page | **True positive as a tell.** Cream was chosen on purpose in the brand spec, but alone, with no counterweight, it reads as the reflex "tasteful" surface. Addressed in S2-04 and Brand 2.0. |
| `shape-assembled-illustration` ("inline svg scene: 18–38 primitive shapes") | slop, advisory | 13 (org_1: 10, org_3: 3) | FoodArt hero and dish thumbnails | **True positive.** These are ellipse-and-rect drawings (S2-07). |
| `layout-transition` ("transition: padding") | quality, warning | 15 (3 per route) | 2 unnamed framework `div`s with a 50 ms padding transition | **False positive.** Not in our source (`grep transition` finds 0 hits in app or ui code). It comes from react-native-web or expo-router internals, and 50 ms is invisible. |

**Detector blind spots.** These came from the LLM review alone. React Native composition is invisible to a CSS-pattern scanner:
- the icon-in-circle status template;
- monograms standing in for imagery;
- accent overload;
- the warning/brand collision;
- card-in-card nesting;
- semantic colours reused as identity;
- a single font family;
- template feature rows;
- the coloured glow on arrival.

The clean source scan is a credit to token discipline (no raw CSS, 6 stray colour literals in the whole app). It is not evidence of a distinctive design.

---

## 4. Findings

Severity: P0 blocks launch quality · P1 hurts the brand or users daily · P2 clear gap · P3 polish.
Effort: S ≤ 1 day · M ≤ 1 week · L multi-week or external.

| ID | Sev | Area | Evidence | Why it matters + benchmark | Recommendation (token values) | Effort |
|---|---|---|---|---|---|---|
| **S2-01** | P1 | Colour: one hue with 7 jobs | **Pixel share, 13 screens:** cream/white 81.1%, orange fill 4.1% + orange tint 8.9% + accentText 0.4%, ink 4.5%, green 0.6%, blue and red 0.0%. **Orange carries:** the CTA (`Button.tsx:39-42`), selected chip fill (`Chip.tsx:29`), stepper + (`Stepper.tsx:77`), active tab pill (`TabBar.tsx:84`), stars (`RestaurantRow.tsx:61`, `RestaurantRail.tsx:65,84`), the tint-card border (`Card.tsx:30`), links (ghost = `accentText`), live dots and welcome icons. **Per screen:** `food-item-sheet.png` has 6 orange elements, `rajaa-demand.png` 5, `food-checkout.png` 6. | 60-30-10 is about visual weight. Here the "30" layer (ink, secondary) is 4.5% and there is no second hue at all. An accent works because it is rare; with 7 meanings, nothing reads as *the* action. Airbnb keeps Rausch for the primary CTA and brand, and draws selection in ink. Uber Eats keeps green for CTA and promo. | Split the roles in `themes`:<br>• `action` (orange fill): at most 1 per viewport.<br>• new `selected`/`onSelected` = ink `#24170E` / `#FFFCF6`, plus the check, for chips, segment thumb, person chips and radios.<br>• stepper +: surface with a 1.5 px `borderStrong`.<br>• stars: ink outline + saffron `#F2C14E` fill.<br>• new `live`/`liveTint`/`liveText` = kashi `#0B6577` / `#D3EAF0` / `#0B5A6B`.<br>Re-measure: target ≤ 6% orange per screen and ≥ 15% ink + secondary. | M |
| **S2-02** | P1 | Colour: warning is the brand | `tokens.ts:138` `accentTint #FCEBD3` vs `:148` `warningTint #FBEBCC`: **ΔE 0.9**. `accent #E08A1E` (hue 64°) vs `warning #C77700` (hue 65°): ΔE 6.7. `accentText` vs `warningText`: ΔE 3.1. In `track-late.png` the "متأخرين 8 دقيقة" banner reads exactly like the active-order card on home. | A late or problem state that looks like a brand card isn't seen as a problem. A selected chip also looks like a warning. Material 3 and Apple HIG keep caution hues well away from the brand hue. Pale tints can't be separated by colour: the best warm-tint pair achievable here is ΔE ≈ 4.4 (computed). | Make warning **structural, not a tint**: an inverse banner (`inverse #24170E`, cream text, saffron `#F2C14E` clock/alert icon, bold first line). Move the warning tokens to hue ≈ 85–95: `warning #F2C14E`, `warningText #7A5A00` (5.5:1 on paper). Add a design rule: *a tint never carries meaning alone; it always pairs with an icon and a word.* | S |
| **S2-03** | P1 | Colour: semantic colours used as identity and decoration | `Avatar.tsx:10-15` hashes names into {accent, info, **success**, **warning**}. `RestaurantRail.tsx:27-32` does the same for restaurant tiles (green خ, blue ش in `app-home.png`). Deals use a **success** pill (`RestaurantRow.tsx:53`, `RestaurantRail.tsx:72`). Arrival confetti uses accent, success, info and warning (`Arrival.tsx:104`). FoodArt uses `tomato = danger`, `herb = success` (`FoodArt.tsx:60-62`). | Green means *done/OK* everywhere else (timeline ticks, "مفتوح", "متحقق اليوم"), and borrowing it for identity wears that meaning down. In `extra/dark-sim-home.png` the green and blue tiles turn into saturated status blocks. When dark mode or a semantic colour changes, the food changes colour too. | Add three palettes to tokens:<br>• `identity` (non-semantic, for monograms and avatars): date `#7A4A2A`, clay `#B8643A`, olive `#6B7B2E`, plum `#5E4B8B`, kashi `#0B6577`, pomegranate `#B23A2E`, each with a derived tint. All pass ≥ 4.17:1 with `#FFFCF6`.<br>• `deal`: a saffron sticker, `#F2C14E` fill with ink text.<br>• `art.*`: fixed illustration pigments (S2-07). | S |
| **S2-04** | P1 | Colour: cream monotony and sun legibility | `tokens.ts:130-131`: surface `#FFFFFF` on bg `#FBF6EE` is **1.08:1** (ΔE 2.8). Cards separate only by shadow opacity 0.07 (`tokens.ts:393-399`) or by the decorative border `#EADFCF`, which is 1.22:1. The detector flags `cream-palette` on all 5 routes. | At noon in Wasit, on a 400-nit Android, the app becomes one beige wash. Hierarchy that rests on 7% shadows disappears outdoors. Cream with no counterweight is also the most common "tasteful default". | Deepen the paper and warm the white: `bg #F6EEDF`, `surface #FFFCF6`, `sunken #EEE3CF` (1.13:1, ΔE 4.2). Every resting card gets 1 px `line #E4D5BE` + elevation 1, one recipe everywhere. Give cream a reason: paper grain (S2-15) plus ink and kashi counterweights (Brand 2.0 A). | S |
| **S2-05** | P1 | Type: no display voice | `tokens.ts:296-300` sets `display` to Plex. `Wordmark.tsx:8-26` is Plex Bold plus a dot. `app-welcome.png` and `track-arrival.png` set the hero moments in Plex 700. The specimen (`extra/type-specimen-1..3.png`) compares 22 faces with app strings. | Plex is on impeccable's reflex-font list and gives no sense of place or appetite. Careem, Talabat, Uber (Move) and Airbnb (Cereal) each own a display face. Type is the cheapest brand asset there is. | **Keep Plex Sans Arabic for UI and body.** It is the best multi-weight Arabic UI face: 252 Arabic glyphs, digits tabular by default. Add:<br>• **Alexandria 700** (`@expo-google-fonts/alexandria` 0.4.2, 168 KB, has `tnum` + `lnum`) for display, headings ≥ 22 px and hero numerals;<br>• **Marhey 700** (125 KB, hand-lettered) for brand moments of ≤ 6 words only.<br>Never use Marhey, Lalezar, Rakkas, Readex Pro or Playpen for prices or timers: **they have no tabular digits** (fontTools check). New tokens: `fontFamily.display`, `fontFamily.voice`, `fontFace.display700`, `fontFace.voice700`. Line height ≥ 1.6× for Alexandria (its hhea descent is only 251/1000, so ي and ج clip on iOS with tight leading). | M |
| **S2-06** | P2 | Type: flat lower scale, timid top | `tokens.ts:318-333`: caption/footnote/label/body/button are 12/13/14/15/16 (about 1.07× steps). title 18, heading 22, display 30. The wordmark's 40 px and numerals of 34–48 sit outside the ladder. `welcome.tsx:95` overrides with 17/28. | Five sizes inside 4 px give no hierarchy, and a 30 px celebration reads like a form title. Impeccable asks for at least 1.25× between used steps. | Collapse the scale to: caption 12/20 · body-sm 13/22 (merge footnote and label) · body 15/26 · title 18/30 · heading 22/36 (Alexandria) · display 32/48 (Alexandria) · **hero 40/60 (voice, Marhey)**. Keep the numeral tokens and render them in Alexandria. | S |
| **S2-07** | P1 | Illustration: FoodArt is primitive and repeats | `FoodArt.tsx:71-195` is built from ellipses and rects (detector: `shape-assembled-illustration` ×13). In `food-restaurant-full.png`, **9 dishes show the same kebab plate**. شنينة, بيبسي and ماي صحي share one red can (`FoodArt.tsx:16, 139-148`). Pigments are bound to UI roles (`:52-68`: char = `accentText`, plate = `surface`), so in `extra/dark-sim-restaurant.png` the kebab turns pale and looks raw. There are also 2 raw hexes (`#A0561C`, `#B5521B`). | People pick dishes by picture before name. Nine identical pictures say "placeholder" and slow scanning. Wolt and Deliveroo fall back to distinct per-dish or per-cuisine art, never one image. | 1. **Photos first.** Merchant upload, plus a one-day "Aziziyah plate" shoot for launch kitchens (same table, same 45° light). Use `expo-image ~2.0.7` for caching and blurhash.<br>2. Fallback: a **commissioned set of about 30 dishes** in one style (S2-08), each with its own silhouette. Examples: kebab, tikka, liver, shawarma, falafel, samoon, tannour bread, timman + marag, pacha, dolma, masgouf, kubba, tea, laban, shineena, water bottle, can, salad, torshi, hummus, kunafa, zalabia, gaymar.<br>3. Interim, in a day: choose the motif per dish rather than per kitchen, draw water as a bottle and laban as a glass, and move pigments to `art.*` (meat `#A0561C`, char `#5B2E12`, tomato `#C8432F`, herb `#4E8A3A`, bread `#E9C77B`, tea `#B5521B`, plate `#FFF8EC`, line `#3A2414`), fixed across themes. | S (interim) / L (set) |
| **S2-08** | P1 | Illustration: no spot-illustration language | Stand-ins for art:<br>• `welcome.tsx:13-20, 57-91`: six generic line icons in tilted white tiles (raw radius 22, raw shadow);<br>• `EmptyState.tsx:22-35`: a tilted tinted squircle;<br>• `food-waiting.png` and `food-rejected.png`: a bag in a circle;<br>• `app-orders.png`: one card, then empty paper.<br>The only real scene is the door on the arrival screen. | Illustration is the fastest route to "soul". Aziziyah has a rich visual vocabulary no competitor uses. | Build an **"Aziziyah sketchbook"** system:<br>• **Style:** flat gouache shapes, one 2 px date-brown line that slightly overshoots corners, paper grain, arch-topped frames.<br>• **Pigments:** tea, kashi, pomegranate, palm, saffron + ink.<br>• **Motifs:** istikan and saucer, samoon, tannour, tuktuk with canopy fringe, garage minibus, Tigris with palms, shanasheel window, the green door, the market, the sun.<br>• **Deliverables:** welcome hero, 8 empty/error states, 4 tracking scenes, arrival, rating thanks, offline.<br>• **Delivery:** static scenes as `react-native-svg` (already installed, 15.8.0); 4 animated moments as **Lottie** (`lottie-react-native` 7.1.0 is the SDK-52 version). Rive is not in Expo's bundled modules, so skip it. | L |
| **S2-09** | P2 | Icons: consistent but anonymous | `paths.ts`: 45 glyphs, consistent (good). But food = `bag` (`:41`, which reads as shopping), الرجعة = `garage` (`:86`, a barn or house), and `rajaa-demand.png` uses the same `user` glyph for رجال, نساء and عائلة. Only the tab bar has an active state (a pill, not a glyph change). Rating stars are outlined grey (`Arrival.tsx:188`). | Lucide-like geometry could belong to any app, and the service tiles are the first thing people tap. | Commission 8 **service glyphs** on the same grid:<br>• food = skewer over a plate;<br>• taxi = car with roof sign;<br>• tuktuk = side view with canopy fringe;<br>• رجعة = garage minibus;<br>• parcels = tied bundle;<br>• grocery = basket;<br>• خطوط = school bus with route dots.<br>Also add woman and family glyphs, plus **duotone active variants** (tint fill inside the stroke) for tabs and selected tiles. Use stroke 2.0 at ≤ 20 px for sun legibility and keep 1.75 at 24 px. Finish S-16: fold `MIcon` into `ICONS`. | M |
| **S2-10** | P2 | Shape: no signature, radii drift | Tokens define `sm 6 / md 10 / lg 14 / xl 20 / 2xl 28` (`tokens.ts:284-293`), yet 47 files use about 20 raw radii (e.g. `welcome.tsx:75` = 22, `EmptyState.tsx:27` = 24). Cards sometimes have a border and sometimes a shadow (`Card.tsx:28-36`; profile vs home). S-15 is still open. | Everything is a soft rounded rectangle, so the shape language could be anyone's. | Make the **arch (طاق, as in shanasheel windows)** the signature: arch-topped frames for food art and photos, the door photo and the illustration scenes (top corners = width/2). Everything else stays a soft rectangle. Define two card recipes, `rest` (1 px line + e1) and `lift` (e2), and lint raw radii (S-15). | M |
| **S2-11** | P2 | Composition: boxes in boxes | `acct-wallet.png`: a tint card holding a white card holding an orange button. `deals-restaurant.png`: deal badges inside the hero card. `app-profile.png`: every group is carded. `Card.tsx:30`: the tint tone always gets an orange border, so the active-order, demand, approval and cart-conflict cards are all the same orange box. | Impeccable: don't nest cards, not everything needs a container. Identical orange boxes mean different things on different screens. | Flatten. Sections sit on paper with headings and rows separated by hairlines. Keep containers for **objects** (order, seat, ticket, courier). The live order becomes an **inverse ink card** (see `extra/brand2-directions.png`). Drop the accent border from `Card tone="tint"`. | M |
| **S2-12** | P1 | Template tells on status screens | `PermissionPrompt.tsx:76-78` (icon in circle) + `:87-99` (three icon-tile bullet rows), on top of every tracking capture. `food-waiting.png`: bag in a tint circle inside a ring. `food-rejected.png`. `track-arrival.png`: orange check circle with an **orange glow** (`Arrival.tsx:50`, shadow opacity 0.45, radius 22). | This is the most recognisable template signature for status screens, and it turns the app's peak moments into system dialogs. Peak-end rule: the arrival should be the best moment. | Replace with **scenes and type**:<br>• waiting = the kitchen scene with a live steam loop;<br>• rejected = the same table with two empty chairs, plus alternatives;<br>• arrival = the door opening, an istikan clink and a "وصل طلبك، بالعافية" line in Marhey;<br>• push pre-prompt = a doorbell scene with one sentence.<br>Remove the coloured glow. | M |
| **S2-13** | P2 | Imagery: monograms instead of food | `RestaurantRow.tsx:34-46` puts a letter on a tinted 76 px tile (`app-home.png`). The restaurant page uses FoodArt. `motifForKitchen()` exists but home doesn't call it. | Two visual languages for one restaurant, and the home list, the most-seen screen, carries no appetite at all. | Use the same art tile or photo on home as on the menu hero. Keep monograms for people only, in `identity` colours. | S |
| **S2-14** | P1 | Dark mode not shipped | `_layout.tsx:53-62` hard-codes `theme="light"` and `StatusBar style="dark"`, while `app.json:10` sets `userInterfaceStyle: "automatic"` (system keyboard and alerts go dark over the light app; S-28). The simulation (`extra/dark-sim-home/restaurant/wallet.png`) remaps every role cleanly; the only unmapped colours are 71 FoodArt `#A0561C` fills. But:<br>• `wallet.tsx:84` uses `colors.text` as a card background, so it becomes a cream card in dark;<br>• `wallet.tsx:108` uses `rgba(255,255,255,0.10)`;<br>• `Card.tsx:32` zeroes shadows in dark with no surface step to replace them;<br>• FoodArt inverts. | Late-night ordering (summer nights, Ramadan suhoor) is when a white screen hurts most. The token work is 90% done, so this is cheap to finish. | Ship **"Istikan night"** (palette in §5) as a first-class theme:<br>• add `inverse`/`onInverse` roles;<br>• make `art.*` fixed;<br>• replace dark-mode elevation with surface steps (`surface #211912`, `raised #2C2219`);<br>• wire `useColorScheme()` plus an in-app override.<br>Until then, set `userInterfaceStyle: "light"`. | M |
| **S2-15** | P3 | Texture: flat digital paper | No texture anywhere. | A subtle grain makes the cream read as *paper* rather than *default*. It is the cheapest piece of "craft". | Use a 128 px tiled PNG (≤ 6 KB) at 4–5% multiply on `bg` only: one static layer behind the scroll view, never animated, no Skia or blur. Use 3% in dark. Check the frame rate on an A0x-class phone before shipping. | S |
| **S2-16** | P1 | Motion: utility only, no signature | `tokens.ts:346-388` has no `camera`, `celebrate`, `ambient`, stagger or distance tokens. There are 21 literal durations or springs in 7 files: e.g. `Arrival.tsx:41` FadeIn 220, `:338` delay 700 / 650, `:339` spring damping 6 (overshoots hardest of anything in the app), RideMap ×6, Panels ×3. There is no `motionPresets`. | Peak moments are improvised per screen. Strong systems use a small named set (Apple, Airbnb, Material 3 Expressive's spatial vs effects springs). | Adopt the **"Pour & settle" signature (صب وهدوء)** in §6. Tokens:<br>• `spring.settle {damping 14, stiffness 170, mass 0.9}`;<br>• `spring.celebrate {damping 10, stiffness 180, mass 0.8}`;<br>• `spring.hop {damping 16, stiffness 220, mass 0.7}`;<br>• `duration.camera 600`, `ambient 2000`, `celebrate 900` (cap), `digitRoll 220`;<br>• `distance.enter 12`, `distance.nudge 4`;<br>• `stagger 40` (max 3 items).<br>Plus a `motionPresets.ts` in `@driver/ui` (fadeIn, panelIn, sheetIn, pop, hop, digitRoll) wired to reduce-motion. | M |
| **S2-17** | P2 | Sound: generic chimes, no identity | `make-alert-sounds.mjs:102-125`: sine + odd harmonics, major arpeggios (accepted E5→A5; picked C-E-G; delivered C-E-G-C). `sound.ts:25-46` handles the silent switch and an off switch (good). The order push uses the default channel sound (`app.json:38`, `defaultChannel: "orders"`, no custom sound). | When the phone is in a pocket, sound *is* the brand. A synthesized major arpeggio sounds like every app and game. | Make a sonic logo, **the istikan clink**: record a real tea glass and spoon (2 strikes, about 350 ms) and derive the family in §6. Register it as the Android `orders` channel sound and the iOS push `sound`. Each file ≤ 30 KB, loudness about −16 LUFS, never played in silent mode. `expo-av 15.0.2` already plays it (SDK 52 also offers `expo-audio ~0.3.5` for a later migration). | S–M |
| **S2-18** | P2 | Haptics: no map, buzz on everything | `Button.tsx:67` fires `light` on **every** button, including ghost and secondary. Measured usage: selection ×16, success ×6, warning ×3, light ×3, error ×2, heavy ×2, medium ×2. There is no event map in tokens. | Cheap Android vibrators make constant light taps feel like buzzing. Haptics only mean something when they are rare. | Fire haptics only on primary and destructive buttons. Keep `success` for 4 events (order placed, arrival, seat booked, top-up confirmed). The customer app never uses `heavy` except SOS. Put the map in tokens as `haptic.events` (§6). | S |
| **S2-19** | P2 | Brand assets: no app icon or splash | `apps/customer/app.json` has no `icon`, `splash` or `android.adaptiveIcon`. `apps/customer/assets/` holds only `sounds/`. `Wordmark.tsx` is a placeholder (brand spec: symbol pending). | The home-screen icon is the most-seen brand surface, and the Expo default icon would ship. | Decide the symbol (brand spec A/B/C). Produce the icon (1024 px, adaptive foreground/background, Android 13 monochrome) and a splash (paper + mark) with `expo-splash-screen ~0.29.24`, holding it until fonts load (fixes S-29). | M |
| **S2-20** | P2 | Accessibility leftovers | • **Small text:** 10 px map attribution (`TrackMap.tsx:269`, `RideMap.tsx:110`, `ShareMap.tsx:81`) and 11 px chat meta (`ChatThread.tsx:406,413`) break `minFontSize` 12 (`tokens.ts:337`).<br>• **Stars:** orange fill on white is 2.68:1.<br>• **Disabled CTA:** 40% opacity orange with its label at about 1.7:1 (`rajaa-seat-sheet.png`).<br>• **Tints:** tea, warning and pomegranate tints sit within ΔE < 4.4 of each other. | Outdoor low vision. A disabled button should say *why* it is disabled, legibly. | • Attribution to 12 px.<br>• Stars: ink outline + saffron fill (ink alone is 17:1).<br>• Disabled state: `surfaceSunken` fill, `textMuted` label, a lock or clock icon, **no opacity**.<br>• Document the rule: tints never carry meaning alone. | S |
| **S2-21** | P3 | Data screens: numbers aren't a brand asset yet | `acct-wallet.png` follows the hero-metric template (a big amount, then the equation "2,500 نقطة = 25,000 دينار" as a headline). The ETA box (`extra/track-clean-expanded.png`) is good. **The boarding pass (`rajaa-pass.png`) is the best screen in the app.** | Numbers are what people check most. Each one is a chance for craft. | • Hero numerals in Alexandria 700 tabular.<br>• Ticket metaphor (half-circle perforation notches and a tear line) for the boarding pass, receipts and top-up codes.<br>• Digit-roll on ETA changes.<br>• Wallet: replace the equation with a plain sentence plus a filling-istikan progress for points. | S–M |
| **S2-22** | P3 | Map tone | `extra/track-clean.png`: an OSM raster under a scrim, with tier-tinted zone outlines that read like a hex game board. `packages/map/src/colors.ts` keeps its own palette outside the tokens (water `#c9dce6`). | The map takes 60% of the most-watched screen. | Brand the base map from tokens: Tigris in kashi tint `#CFE5EA`, land paper `#F1E8D8`, palm groves in palm tint. Show zone outlines to customers only for their own delivery area. Lower the scrim to 30% under sheets. (Coordinate with the maps audit.) | M |
| **S2-23** | P2 | Spacing rhythm | Home, profile and cart use the same gap between sections as between cards. Status screens are centred stacks (`food-waiting.png`, `track-rating.png`). | Impeccable: vary spacing for hierarchy, and don't centre everything. | Add rhythm tokens: `space.section 40`, `space.group 24`, `space.item 12`; heading top margin = 2× its bottom margin. Start-align status screens, with the scene on top. | S |

---

## 5. Brand 2.0: three directions

Rendered at phone width in `extra/brand2-directions.png`. Reading right to left, the panels are A light, A night, B, C. All four mock the same home screen, so colour weight and type can be compared directly. Every pair below was checked for WCAG contrast (all pass AA where text is involved).

Font selection followed impeccable's procedure:
- **Brand words:** *hospitable, sun-warmed, quick-witted*.
- **Reflex picks, rejected:** Plex (already in use), Cairo/Tajawal/Almarai (the regional defaults), Rubik.
- **Search:** a physical-object test, i.e. which face looks like a hand-painted chaikhana or garage sign, or a market price tag.

### Direction A · استكان **Istikan** (recommended)

**Three words:** hospitable, amber, handmade. The brand is the tea glass every Iraqi house offers a
guest: warm amber, a clink, steam, a saucer of sugar. Orange stays (continuity), but it becomes *tea*,
used rarely and only for action and food. A second pole, **kashi** (the turquoise-blue of Iraqi
mosque tiles and the Tigris), means *moving and live*.

| Role | Light | Night | Use (target weight) |
|---|---|---|---|
| Paper (bg) | `#F6EEDF` | `#15100B` | 60%: the page, with 4–5% grain |
| Surface / raised | `#FFFCF6` / `#FFFCF6` | `#211912` / `#2C2219` | cards, sheets |
| Sunken | `#EEE3CF` | `#0F0B08` | wells, fields |
| Ink (date brown) | `#24170E` | `#F5EBDC` | text, **selected state**, **inverse live cards**: part of the 30% |
| Muted / line / lineStrong | `#6A5745` / `#E4D5BE` / `#8A735C` | `#BBA78F` / `#3A2E23` / `#8A7A66` | secondary text, hairlines, field borders |
| **Tea** (action, food, brand) | `#E08A1E` · tint `#FBE6C6` · text `#8F4A00` | `#F0A043` · `#3A2812` · `#F6BC6E` | 10%: one primary CTA per view, the food service, the mark |
| **Kashi** (move, live, info) | `#0B6577` · tint `#D3EAF0` · text `#0B5A6B` | `#5BB5CC` · `#12303A` · `#7FCBDD` | courier, route, ETA, taxi/tuktuk/رجعة tiles, info (absorbs `info`) |
| **Saffron** (deals, rewards, stars, caution icon) | `#F2C14E` with ink text · text `#7A5A00` | `#F2C14E` · `#F5D27A` | deal stickers, points, star fill |
| **Palm** (success) | `#2F7D4E` · `#DCEEDF` · `#23653E` | `#5DB680` · `#17301F` · `#8ED3A8` | done ticks, "مفتوح" |
| **Pomegranate** (danger) | `#B23A2E` · `#F7DCD6` · `#9A2E23` | `#E06A58` · `#3C1C17` · `#F29A8B` | errors, destructive |
| `art.*` (fixed both themes) | meat `#A0561C`, char `#5B2E12`, tomato `#C8432F`, herb `#4E8A3A`, bread `#E9C77B`, tea `#B5521B`, plate `#FFF8EC`, line `#3A2414` | same | illustration only |
| `identity.*` | `#7A4A2A` `#B8643A` `#6B7B2E` `#5E4B8B` `#0B6577` `#B23A2E` | lightened +25 L | monograms, avatars |

**Key ratios.**
- Light: ink on paper 15.1 · muted on paper 5.95 · ink on tea 6.5 · `#FFFCF6` on kashi 6.53 · kashiText on paper 6.98 · saffronText on its tint 5.66.
- Night: muted on bg 8.1 · bg on tea 8.8 · bg on kashi 8.0.
- Distinctness: kashi vs palm ΔE 11.6 (no longer read as "success").
- Colour logic: **tea = act and eat, kashi = move and live, ink = choose and read, saffron = treat, palm = done, pomegranate = stop.**

**Type.**
- **Marhey 700:** the voice. Brand moments of ≤ 6 words at 28–40 px: welcome, arrival, empty states, home section titles. It looks like a hand-painted shop sign.
- **Alexandria 700:** display and numerals. Headings ≥ 22 px, ETAs, totals, PINs; it has `tnum`.
- **IBM Plex Sans Arabic 400/500/600:** all UI and body.
- **Cost:** about +0.3 MB of fonts.
- **Hold-back:** load all three before hiding the splash.

**Icons:** the current grid, plus 8 service glyphs and duotone active fills (tea tint inside the 2 px stroke for food, kashi tint for mobility).

**Illustration:** "Aziziyah sketchbook" (S2-08). Arch-topped frames are the shape signature.

**Motion:** "Pour & settle" (§6). Things rise 12 px, decelerate, and settle with a small overshoot, like
tea poured into a glass. Steam is the only ambient loop and appears only while waiting. One clink-and-steam
burst on arrival.

**Sound:** the istikan clink family.

**Sample screen: Home (light),** see `extra/brand2-directions.png`, rightmost panel. From the top:
1. **Header.** Greeting in muted 13 px and the address in Plex 600 17 px with a tea-text pin, on grained paper. The bell sits in a 44 px warm-white circle with a hairline.
2. **Headline.** "شتاكل اليوم؟" in Marhey 700 34/52.
3. **Search.** A pill on `#FFFCF6` with a 1.5 px `#8A735C` border.
4. **Service bento.** The tall tile on the start side is **أكل**: tea fill, a duotone ink bag, the label in Marhey 20. Two rows of smaller tiles: تكسي, تكتك, الرجعة in kashi tint with kashi-text glyphs; طرود in sunken neutral.
5. **Live order.** An **inverse ink card**: a tea-glow live dot, "مطعم خالد · دا يتحضّر" in tea text, "طلبك يوصل", and **6:15 م** in Alexandria 800 30 px tabular on the end side.
6. **Section title.** "مفتوح هسة" in Marhey 24, with "شوف الكل" in tea text.
7. **Chips.** Selected = **ink fill + cream text + check**; the rest are warm white with a 1.5 px line.
8. **Restaurant card.** An arch-topped food art tile on tea tint, with a **saffron "خصم 20%" sticker** rotated −4°. Name in Plex 600 17, then ink star · 4.7 · 30–40 دقيقة · توصيل 500 دينار.
9. **Orange count:** 2 (the food tile and one live dot).

**Night:** the same screen and the same tokens (second panel). Tea and kashi glow softly on warm black,
and the wordmark becomes tea text.

### Direction B · ظهر دجلة **Tigris Noon**

**Three words:** sunlit, bold, clear. Built for noon in Wasit: maximum contrast, white surfaces on
sand, and a **river-teal primary action** with white text. Orange is demoted to a *sun* highlight.

- **Palette:**
  - sand bg `#F2EDE4`, surface `#FFFFFF`, ink `#14110E`, muted `#5C5349`, line `#DCD3C5`, lineStrong `#7E7366`;
  - **river (action)** `#0B5E5A` (white text 7.6:1), tint `#D5EAE7`;
  - **sun (brand highlight, live, badges)** `#F5A524` with ink text (9.2:1), sunText `#8A4E00`;
  - date `#6B3A1E` (art), palm `#2B7A4B`, danger `#C23B2B`.
- **Type:** Alexandria 800/700 for display, headings and numerals, Plex for body. No voice face.
- **Icons:** 2 px geometric strokes, solid fill when active, 16 px-radius tiles.
- **Illustration:** bold flat geometry with no outlines: sun disc, river band, palm silhouettes, two tones per scene.
- **Motion "Clean cut":** critically damped springs (damping 26, stiffness 300), 180 ms decelerate, no overshoot, digit roll, an ETA bar that fills like a river.
- **Sound:** a two-note wooden marimba "da-dum".
- **Sample screen (Home, second panel from the left):**
  1. "شتاكل اليوم؟" in Alexandria 800 30 px, then a 2 px ink-bordered search field.
  2. Four equal tiles; the selected أكل has a river fill and a white glyph.
  3. The active order is a white card with a 2 px sun border and a 28 px ETA.
  4. Ink-selected chips, then a list card with a sun-orange art tile.
  5. A full-width river CTA, "كمّل الطلب · 17,750 دينار".
- **Trade-off:** the most legible in sun and the least joyful. It changes the CTA colour (everyone relearns), and teal CTAs are Deliveroo's territory.

### Direction C · تكتك **Tuktuk Pop**

**Three words:** playful, loud, street. Sticker energy taken from decorated tuktuks: every service gets
its own colour, everything has a 2 px ink outline and a 3 px offset ink shadow.

- **Palette:**
  - bg `#FFF6EA`, surface `#FFFFFF`, ink `#23160D`;
  - **food orange** `#F28C28` (ink 7.2:1), **taxi lemon** `#FFD23F` (ink 12.2:1);
  - **tuktuk magenta** `#D3346B` (white 4.69:1), **رجعة sky** `#2C8FD0` (ink 4.99:1), **parcels mint** `#22A884` (ink 5.87:1).
- **Type:** Baloo Bhaijaan 2 800 for display (it has `tnum`), Plex for body.
- **Icons:** thick 2.2 px, sitting in rotated sticker tiles.
- **Illustration:** sticker art with fat ink outlines: tuktuk decals, tassels, chilli, samoon.
- **Motion "Slap & wobble":** bouncy springs (damping 9, about 20% overshoot), stickers slap onto the screen (scale 1.15→1, ±4°), squash on add-to-cart.
- **Sound:** a toy tuktuk horn "bip-bip" for on-the-way.
- **Sample screen (Home, leftmost panel):**
  1. "شتاكل اليوم؟" in Baloo 34 px, then a search pill with an ink outline and offset shadow.
  2. Four rotated service stickers in four colours.
  3. A mint live-order slab.
  4. A lemon-backed restaurant card with a magenta "خصم 20%" sticker.
- **Trade-off:** the most memorable for young users. But it is childish for money, intercity, SOS and family flows. Five hues make colour semantics chaotic, dark mode is hard, and it tires the eye quickly.

### 5.4 Recommendation

**Go with A, Istikan.** Borrow B's sun rules (deeper paper/surface separation, 2 px ink field
borders, ink selected state) and use C's sticker only for deals and the arrival celebration.

Why A:
1. **It evolves what exists.** Orange and cream stay, so Phase 1 is token changes plus about 8
   components, shippable in a week, with no relearning.
2. **It is rooted in a daily ritual every customer shares** (tea), not in a generic "friendly" mood.
   That gives Driver a sonic logo, a motion metaphor and an illustration subject in one idea.
3. **Its two-pole colour logic** (tea = eat, kashi = move) scales to a super-app. Every new
   service already has a colour meaning.
4. **The night theme is natural**: a chaikhana at night.
5. **It leaves "orange food app" behind.** Orange becomes a tea accent inside an ink-and-paper system
   with a turquoise counterpart.

**Rollout.**
- **Phase 1, tokens (2–3 days):**
  - roles `selected`, `live`, `inverse`, `deal`, `identity.*`, `art.*`;
  - structural warning;
  - paper/surface values;
  - motion and haptic tokens;
  - font loading behind the splash.
- **Phase 2, components (1 week):**
  - Chip, Segmented, Stepper, Avatar, Card, StatusPill, EmptyState, PermissionPrompt;
  - Button haptics;
  - the home restaurant tile;
  - the FoodArt interim fixes.
- **Phase 3, assets (2–4 weeks, external):**
  - the illustration set and 8 service glyphs;
  - the istikan recording;
  - the app icon and splash once the symbol is chosen.
- **Phase 4:** ship Istikan night.

### 5.5 What `high-end-visual-design` does not transfer to native

Its web tactics don't carry over:
- the "double-bezel" nested shells;
- `backdrop-blur` glass;
- 800 ms scroll fade-ups;
- `py-24`-style macro whitespace;
- floating glass navigation;
- magnetic hover.

On mid/low-end Android these cost frames (blur is expensive with `expo-blur ~14.0.3`), hover doesn't
exist, and a delivery app needs density above the fold.

What does transfer:
- one distinctive display face paired with a refined body face;
- custom easing curves instead of defaults;
- grain on a fixed layer only;
- press-scale feedback (already there);
- "eyebrow" restraint. The current pill eyebrows above titles ("أكل · مطعم خالد", "وصل طلبك للمطعم") are the cheap version and should become plain muted text.

---

## 6. Motion, haptic and sound map (Istikan)

Signature: **Pour & settle (صب وهدوء).**
- **Enter:** rise `distance.enter` 12 px with `decelerate` (0,0,0,1) over `base` 220 ms (small things) or `slow` 360 ms (panels), then `spring.settle` (about 4% overshoot).
- **Exit:** 30% faster, with `accelerate`.
- **Ambient:** one loop only, steam, during waiting.
- **Celebrate:** one burst, ≤ 900 ms, never on a money-loss moment.

**Reduce motion:** transforms become ≤ 150 ms cross-fades, loops stop, the camera jumps and count-ups jump. Haptics and sound don't change.

| Event | Motion spec | Haptic | Sound |
|---|---|---|---|
| Primary button press | scale 0.97, `spring.press` (no wobble) | `light` (primary and destructive only) | none |
| Chip, segment, seat or radio selected | ink fill cross-fade `fast` 150; `spring.select` dip 0.92→1; check stroke draws in 150 | `selection` | none |
| Tab switch | glyph swaps to duotone + label weight 600, 150 cross-fade; content fades with no slide | `selection` | none |
| Sheet or modal open | slide up `spring.sheet` + scrim fade 150; exit 150 `accelerate` | none | none |
| Add to cart | dish art hops along an arc into the cart bar, 420 ms, `spring.hop`; cart count digit-roll 220; total count-up 500 | `light` on tap, `selection` on landing | none (optional soft wooden "tuk", off by default) |
| Order placed (اطلب هسة) | CTA morphs to a progress pill; a tea-fill wipe rises into the waiting scene, `deliberate` 600 | `success` | none (the kitchen hasn't confirmed yet) |
| Kitchen accepted | waiting ring completes; kitchen scene fades in with the steam loop (`ambient` 2000, stops off-screen) | `light` | **clink ×1** (about 0.3 s) |
| Courier picked up | marker pops at the restaurant pin (`spring.celebrate`, 0.6→1); route draws to the door over `camera` 600 | `medium` | **clink ×2, rising** |
| ETA changes | only changed digits roll, 220 `decelerate`, no layout shift | none | none |
| Running late (≥ 5 min) | inverse banner slides down 12 px, `base` 220; saffron clock icon ticks once | `warning` (once) | none |
| Almost there (about 2 min) | "قريب" card rises with `spring.settle`; the door glyph rocks once ±3° | `medium` | soft doorbell + clink (rework `near.wav`) |
| Delivered / arrival | full-screen door scene: the leaves open (perspective rotate, 600); 8 steam/sesame particles in `art.*` pigments; ≤ 900 total; no coloured glow | `success` | **sonic logo: clink + one low oud/qanun pluck** (about 0.7 s) |
| Rating star tap | stars up to the tapped one fill ink→saffron, 40 ms stagger, `spring.select` | `selection` | none |
| Points earned | date-shaped coins arc to the wallet tab over 650 `standard`, then the points count up | `success` (once) | tiny high clink |
| Seat booked (الرجعة) | seat fills ink + check; boarding pass slides up and "stamps" (1.06→1, −2°→0) | `success` | soft stamp thud (optional) |
| Error on a field | the field nudges 2× 4 px over 150 (no whole-screen shake); error text fades in | `error` | none |
| Toast | enters 12 px from the bottom, `base` 220 `decelerate`; exits `fast` 150 `accelerate` | `error` only for error toasts | none |
| Offline, then back online | banner slides in; on reconnect it turns palm for 1.5 s, then slides out | none, then `light` | none |
| Pull to refresh / loading | steam wisps rise from an istikan glyph; skeleton shimmer runs right to left over 1200 (existing) | none | none |
| SOS (ride / رجعة) | no playful motion; instant state change; a calm red-free confirmation | `heavy` pattern on long-press confirm | none (calm-in-danger rule) |

**New tokens.**

```
motion.duration: camera 600, ambient 2000, celebrate 900, digitRoll 220
motion.spring:   settle {14,170,0.9}, celebrate {10,180,0.8}, hop {16,220,0.7}
motion.distance: enter 12, nudge 4
motion.stagger:  40 (max 3)
haptic.events:   the haptic column above
sound.cues:      clink1, clink2, near, logo, coin
```

Each sound file is ≤ 30 KB at about −16 LUFS, plays only when the tracking screen is open or as the
push channel sound, and respects the silent switch.

---

## Appendix A · Persona red flags

- **Um Hussein, 52, Galaxy A05, ordering at 1 p.m. on her doorstep.**
  - White cards on cream (1.08:1) vanish in the sun.
  - The orange stars (2.68:1) disappear.
  - The "we're late" banner looks like her order card (ΔE 0.9), so she misses the new time.
- **Mustafa, 19, ordering at 1 a.m.**
  - A full-white app.
  - On iOS the keyboard and alerts come up dark over light screens (`automatic`).
  - Nothing feels made for night.
- **Zainab, first order, from Kut.**
  - On the menu, a wrap and a meal look identical (one kebab drawing ×9).
  - Water is drawn as a red can.
  - The home list shows letters, not food, so she has to read every name.

## Appendix B · Nielsen (visual-language lens)

The previous audit scored the system at 29/40. Through the visual-language lens:
- **#2 Match with the real world:** 3. The voice is great, but the visuals carry no sense of place.
- **#4 Consistency:** 2. One orange carries 7 meanings; restaurants appear as monograms on home and FoodArt on the menu.
- **#8 Aesthetic and minimalist design:** 2. Calm, but anonymous, with template status screens.

Everything else is as previously scored.

## Appendix C · Questions for Ali

1. Direction: **A Istikan** (recommended), B Tigris Noon, or C Tuktuk Pop? `extra/brand2-directions.png` shows all three.
2. Adding **Alexandria + Marhey** costs about +0.3 MB. OK?
3. Budget for **one illustrator** (about 30 dishes + 15 scenes + 8 service glyphs) and a **one-day food photo shoot** with launch kitchens?
4. Should **dark mode (Istikan night)** ship before public launch? Recommended, since night ordering is big.
5. Which **brand symbol** (A/B/C)? It blocks the app icon and splash (S2-19).

## Appendix D · Files produced (scratchpad only)

All in `scratchpad/audit/shots-extra/system/`:
- **Captures:** `track-clean.png`, `track-clean-expanded.png`.
- **Dark-theme simulation:** `dark-sim-home.png`, `dark-sim-restaurant.png`, `dark-sim-wallet.png`.
- **Type specimens:** `type-specimen-1.png`, `type-specimen-2.png`, `type-specimen-3.png`.
- **Brand 2.0 mocks:** `brand2-directions.png`.
- **Scripts:** `probe.mjs`, `specimen.mjs`, `directions.mjs`, `color.mjs`, `palettes.mjs`.

Detector JSON is in `scratchpad/audit/reports/`: `detector.json`, `detector2.json`, `det-url-*.json`.
