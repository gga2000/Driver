# Food doors (أبواب الأكل), step 1 and 2 — as built

Ali, 2026-10-07: "i love your ideas please make their execution state of the art and world class", after
voting Yes/No on 85 ideas in the food discovery artifact (votes in its database, collection `choices`).
No on q3, i2, i3, i4, j4, j5, m4; everything else Yes. g4: one shop per order at launch (two-shop trays,
k11, wait for a fee decision). g3/r5: no paid ranking, ever.

## What a customer sees

- **Food home** (`/food`): one line for this hour («وقت الغدا», «الجو حار. شي بارد؟», «ليلة صيف. آيس كريم؟»,
  «سهرانين؟»), the search bar, and four arch-topped doors — مطاعم، قهوة وچاي، عصير وبارد، حلو وآيس كريم — each
  with a live fact («4 فاتحين هسة», «يفتح 9:00»). The order follows the hour and the season (d4, j1, i5:
  `doorOrder` in `@driver/contracts`). «محلاتك» only when the person has really ordered somewhere. Public.
- **A door** (`/food/[door]`): the door's colour washes the top; «أحسن 3 هسة» with one true reason per
  shop (طلبت منه قبل، أعلى تقييم هنا، الأسرع لبابك، توصيله مجاني، أكثر محل قيّموه الناس، جديد بالعزيزية،
  تقييمه 4.7) and «مو إعلانات» under the title; «قارن بيناتهم» opens the three side by side (rating, door
  time, delivery, minimum order; the single best of each row marked). With three shops or fewer there is
  no «أحسن 3», just the list. Sorting and the one question appear only past 8 open shops (k5, k6).
- **Closed shops** sit behind a rolled-down shutter with a padlock (p1), still openable for the menu.
- **Melt guard** (i1): a shop selling only ice cream is not listed in the sweets door when its door time
  is over 20 minutes; one line says it is too far for ice cream to arrive frozen.
- **Search**: «قهوة», «عصير», «حلويات», «آيس كريم» (and spellings) open their door's best shops (f1; bug
  b1); a dish served by several shops shows «أحسن 3 لـ «كباب»» first (f4); shop and dish lists are short with
  a way to the rest; nothing found → a plain message and «نگول للمحلات؟», no unrelated chips (f2); the start
  screen is only recent searches and the four doors (f3).
- **Pictures**: coffee is a café cup, ice cream a cone (new drawings in `@driver/ui`); a shop is drawn by
  what it is (never the rice fallback, b3); «مشويات» is the mixed-grill tray so the two grill kitchens differ
  (b4).
- **Words**: «مطاعم» → «محلات» where it means any shop (r10/b7: list title and counts, search, the unmet
  ask). Order-flow «المطعم» strings stay until an order knows its shop kind.

## How it works

- A shop's door comes from its existing tags (`doorOf` in `packages/contracts/src/food-doors.ts`), no new
  column: any meal tag → مطاعم; else the first café / cold / sweet tag. One shop, one door.
- Door colours come from the home redesign's tokens (`theme.services`, `theme.decor`); no new tokens.
  `apps/customer/src/features/doors/palette.test.ts` checks contrast on every theme.
- Demo only: كافيه دجلة، عصائر الربيع، حلويات الزهراء، آيس كريم الفرات (`@driver/contracts/demo-shops`),
  seeded by `apps/customer/scripts/demo-api.mjs`, never by `pnpm db:seed`. The db taxonomy gains `coffee`
  and `ice_cream`.

## Waiting

- Home: the food tile should open `/food` (d1/g2). Home belongs to the home redesign thread; asked there.
- Later steps from the votes: weights and «ضيوف جايين» (s1, s2, m2), the coffee usual (q1), door and steam
  animations (p2, q6), the street view (p3), Console shop kind and signature dish (o1), merchant per-kilo and
  hot/cold (o3).
- Needs Ali: two-shop orders (k11) need a second-pickup fee decision; distance limits for hot food (g5)
  beyond the ice cream melt guard.
