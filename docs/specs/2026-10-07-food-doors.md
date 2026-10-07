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

## Step 3 (2026-10-07, built overnight on Ali's go)

- **«شنو بخاطرك؟»** on every door: dish pictures (كباب، تكة، كنافة، بقلاوة، لاتيه مثلج…) with how many open
  shops have it. One tap shows the best three for that dish, each card naming the dish and its price (the kilo
  price for sweets by weight). The API's `catalog.cravings` returns one best dish per open shop per craving;
  a craving no shop has is not shown. The order follows the hour and season (iced coffee first on a summer
  noon, ice cream first on a summer night, kleicha and zalabia first in Ramadan and Eid).
- **Compare** ranks prices only like for like: the same dish, or every one by the kilo. Different dishes (a
  kebab wrap against a kebab plate) show their name and price with no «الأحسن».
- **«ليش هالترتيب؟»** under the best three: four lines on how the order is made (no paid ranking, g3/r5).
- **«ضيوف جايين؟»** (sweet door): how many guests → a tray from one shop: 2 kinds from 4 guests, 3 from 10,
  sweets by weight first, ice cream only when a shop has nothing else. «بدّل» per line, «محل ثاني», then
  «حطها بالسلة». Prices are the menu's; the server prices the cart again.
- **«اختارلي سفرة»** (meal door): people, a rough budget per person and a mood (مشاوي، دجاج، أكل بيت، شي سريع)
  → mains, a side for every 3 people and a drink each, from one shop (g4).
- **Coffee usual** (café door): «طلبك المعتاد» from the person's own history, one tap to order it again.
- **Remembered taste** (q2): sugar, cardamom and ice choices are remembered on the phone and filled in next
  time («مثل آخر مرة»); only optional choices, never sent to the server, cleared on sign-out.
- **Menus:** ربع · نص · كيلو pills on dishes sold by weight (the price follows the pick); a «بارد» or «ساخن»
  mark only on the fewer kind in a menu that has both; cafés and juice bars open on a picture grid of six
  drinks; one «details» line for delivery fee and small-order fee; «مشهور بـ» under the name.
- **After a main** (s7): «وياها كنافة؟» once per visit, only at a meal shop that sells a sweet. The demo meal
  shops sell no sweets, so it does not show in the demo.
- **This hour's pick** (d7) under the four doors: one real dish from a shop open now.
- **Joy:** the door's drawing steps forward when pressed (nothing moves with reduce motion); hot drinks
  already draw their steam. Ten new drawings: baklava, zalabia, kleicha, cake, dallah, iced coffee,
  pomegranate, lemonade, banana milk, cocktail.
- Demo menus gained sugar / cardamom / ice choices. Screenshots: `/mnt/project-files/food-doors/step3/`.

## Step 4 (2026-10-07)

- **«سوق العزيزية»** (p3): كل المحلات opens as a street of shopfronts, a striped awning in each shop's door
  colour, its dish in an arched window, a lamp lit while open, the shutter down with when it opens while
  closed. «السوق | قائمة» switches to the plain rows; the choice is kept while the app runs.
- **The ice cream door melts** (p4): June to September, chocolate runs over the sweet door's arch and the
  middle drip slowly lets a drop go. Still when the phone asks for less motion.
- Ali's locked dish pictures draw every dish (`packages/ui/src/art/dish-pictures.tsx`, generated by
  `packages/ui/scripts/import-dish-pictures.mjs`); 15 new ones in the same style wait for his look.
- Demo: مطعم خالد bakes a كنافة (demo API only) so «وياها كنافة؟» shows after a meal.

## Waiting

- Home: the food tile opens `/food` (d1/g2), one line changed here with the home thread's OK.
- Not built, owned elsewhere: gift and occasion pre-order (s3, s4) wait for the checkout redesign; Console shop
  kind and signature dish (o1, o2); merchant per-kilo and hot/cold setup (o3).
- Needs Ali: two-shop orders (k11) need a second-pickup fee decision; distance limits for hot food (g5)
  beyond the ice cream melt guard.
