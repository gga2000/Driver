# Driver (درايفر) — Hostile edge-case review before build

Date: 2026-10-03 · Reviewer stance: senior product engineer + ops lead who has run cash-on-delivery fleets in Iraq and wants this to fail on paper, not in Aziziyah. Sources: every file in `docs/specs/` and `docs/plans/` as of this date.

Format per item: **Case** → *Spec today* → *Rule*. "Silent" means no spec file mentions it. Amounts IQD.

---

## The 10 most dangerous

| # | Danger | Why it is first-order |
|---|---|---|
| 1 | **Referral pays 2,000 points per side = 20,000 IQD credit each (100 pts = 1,000 IQD)**, unlocked by one completed order that can be a 5,000 cash order. A driver with six family SIMs mints 240,000 IQD of liability in an afternoon; the 10M launch budget is 250 pairs. | Money §5, Domain §10 — the two numbers were set in different plans and never multiplied. |
| 2 | **Points are ~10% cashback on GMV while platform revenue is ~18% of GMV**, and points are "applied to delivery fees first", which pass 100% to the courier, so the platform pays the courier in cash for a liability it created. 1,500 points liability per 2,750 revenue on the worked 15,000 order (55% of revenue). | Domain §10, Money §2. Break-even math in Money §6 ignores it. |
| 3 | **Who pays the restaurant at pickup is unspecified.** Ledger says restaurant receives 12,750 on Sunday; on a cash order the courier holds all 15,000. No Aziziyah restaurant fronts a week of food to an unknown startup, and if the courier pays at the counter the cash cap, settlement, and merchant payout logic all change. | Money §2 worked example, §4. Nothing says which model is live. |
| 4 | **Cash-on-delivery with "customer owes cost" as the enforcement.** A rejected cash order (unreachable, no-show, refused at the door) is a loss booked as a debt no one can collect; a competitor or a bored teenager can bankrupt a restaurant's evening with prank orders from a fresh SIM. "Prepay after 2" is per phone number. | Domain §2 unreachable protocol, §9 defaults. |
| 5 | **Khat has no per-child handover proof.** "Arrived" is a driver tap inside a 60 m geofence; the guardian gets "{child} وصل بالسلامة" whether or not the child left the car or anyone received them. A substitute driver appears with 30 min notice and no right of refusal. | Domain §2 Trip, Dispatch §3 substitute auction, Scoring §3. |
| 6 | **Rebroadcast +500 is platform-funded and triggered by 60 s of silence.** Every driver in wave 1 learns in a day that ignoring the first offer earns 500 more. Acceptance is measured on "offers seen", which the app can avoid seeing. | Dispatch §3, Scoring §1. |
| 7 | **Recycled and shared phone numbers inherit everything**: wallet, saved home with gate photo, children's guardian link, driver cash position. Iraqi operators recycle inactive numbers; one identity per phone with no re-verification makes the new owner the guardian of someone else's child. | Core §2 principle 1; Scoring §2; silent on recycling, number change, SIM swap. |
| 8 | **Late-meter and forfeiture at the garage are driver-triggered and GPS-unverifiable**; 100% of the meter goes to the driver and boarded riders, so the car has a collective incentive to declare the last rider late. The 20-min forfeit strands a prepaid woman student at النهضة at night. | Domain §2 Seat lateness, Money §3. |
| 9 | **Front/back-middle seat sales ignore gender adjacency.** A lone woman can be sold back_middle between two strangers, or a man the seat beside her; "عائلة" exists only for city rides. In Wasit this is the difference between a product women use and one they do not. | Customer app §2 seat map; Scoring §4 family option is city-only. |
| 10 | **Clock and GPS are trusted as evidence while the skew policy only flags forward skew > 60 s.** Backdating a device by 4 minutes is accepted; GPS spoofers are free on Android; "delivered in geofence + photo stands" and "on-time arrival" both ride on it. Combined with offline replay after dispatcher reassignment, the ledger will settle the same order twice. | Plan M2 Step 3 `timestamps.ts`; Domain §2 arrival; §9 dispute table. |

---

## A. Food orders

1. **Friday prayer / adhan: every kitchen empties for 20–30 min, and the 90 s auto-reject fires on the whole city at once.**
   Spec: 90 s accept or auto-reject with dispatch alert; busy mode +10 min; merchant scored on acceptance time.
   Rule: per-merchant scheduled pause windows (prayer defaults seeded by city, Friday 11:45–13:15) with "مغلق مؤقتاً" on the card; auto-rejects inside a declared pause do not score; one-tap "pause 30 min" on the board.

2. **Merchant accepts, then the phone dies (power cut, dead battery) — order sits in `preparing` with a courier assigned.**
   Spec: silent after acceptance; auto-assign times courier to `ready − 2 min`.
   Rule: merchant heartbeat; no `ready` by promised time + 10 min and no app presence → dispatcher card with call; courier released after 15 min with 500 compensation charged to the merchant's weekly statement.

3. **Courier-waiting meter charged to merchant when the courier arrived early or waited outside the geofence.**
   Spec: 250 per 5 min to courier beyond promised ready time, charged to merchant.
   Rule: meter starts at max(promised_ready, courier `arrived_pickup` inside pickup geofence); cap 1,000 per order; live meter visible on the merchant board; merchant can contest once with "courier wasn't here".

4. **Item unavailable after acceptance ("the kebab finished").**
   Spec: no post-acceptance edit; re-quote only for stops; "merchant rejects after accepting" = scoring hit + 500 credit.
   Rule: partial-accept flow: merchant marks lines unavailable → customer 60 s to approve the reduced order or cancel free → new quote lines; full reject keeps the 500 penalty.

5. **Customer hands a 25,000 note for a 15,750 order; courier has no change.**
   Spec: silent; totals rounded to 250.
   Rule: checkout asks "تدفع بالضبط؟" and shows the note the customer will hand; courier float requirement (10,000 in small notes) at shift start; unresolved difference ≤ 1,000 may be credited to the customer's wallet on a both-tap confirm, logged as `cash_rounding_credit`.

6. **Merchant inflates in-app prices 15% to cover commission; "price parity" is a condition with no check.**
   Spec: lower tiers conditional on parity; nothing enforces it.
   Rule: field-ops photographs the printed menu at onboarding and each quarter; customer "السعر غير بالمحل" report with photo; two verified reports → tier moves up with a dated notice.

7. **Merchant always picks 10 min prep to get the courier assigned early; couriers idle in front of the shop.**
   Spec: prep-time honesty on the merchant scorecard; waiting charged to merchant.
   Rule: learned prep time per item × hour overrides the merchant's choice when the merchant deviates > 30% over the last 20 orders; the customer always sees the learned ETA; the merchant sees why.

8. **Batched order: first customer unreachable for 5 min while the second customer's hot food cools in the box.**
   Spec: unreachable protocol 5 min; hot items never wait > 10 min from `ready`.
   Rule: after 3 min unreachable the courier may proceed to the second dropoff if it is within 1 km and come back; timeline records the re-sequence; the 10-min hot rule is measured per order and the first order's cooling is attributed to the customer.

9. **Order placed for a participant (food to a sister at the hospital): participant doesn't answer, orderer does.**
   Spec: unreachable → automatic call/WhatsApp, party unspecified.
   Rule: call participant, then orderer; orderer may approve "leave at gate/reception" with photo; cost of a failed order falls on the orderer.

10. **New customer's first pin is 200 m wrong; courier is "in geofence + photo" at the wrong house.**
    Spec: dispute default: in geofence + photo stands.
    Rule: a place with confidence below threshold requires a customer "أني هنا" confirmation on the arriving push or a completed call before `delivered`; failing that, the dispute default is 50/50 and the pin gets flagged.

11. **Two restaurants in one cart.**
    Spec: implies single kitchen ("finding your kitchen"); TripOrder is many-to-many but order creation is silent.
    Rule: one merchant per order, explicitly; a second merchant starts a second order; the dispatcher may batch the two trips later.

12. **Scheduled order for tomorrow 13:00 is sent to the merchant at placement and auto-rejects in 90 s.**
    Spec: "when: now/schedule" exists; auto-assign on merchant acceptance; no scheduled handling.
    Rule: scheduled orders are offered to the merchant at T − prep − 10 min; next-day orders get an evening-before merchant pre-confirmation; customer cancel free until the offer is sent.

13. **Ramadan: zero daytime demand, the whole day's orders land in a 25-minute window before iftar.**
    Spec: silent.
    Rule: Ramadan mode per city: iftar delivery slots with per-merchant slot capacity, honest "yصل قبل الأذان بـ {n} دقيقة" promise, shift guarantee moved to the iftar and suhoor windows, support hours shifted.

14. **Cancellation fee owed by a cash customer who has no wallet.**
    Spec: fee component on the order; refunds default to wallet; nothing says how a cash customer pays a fee.
    Rule: unpaid fees become wallet debt; the next order must settle the debt (cash to courier, ledger `debt_settled`) or be prepaid; two unpaid debts → cash orders blocked, agent-shop top-up required.

15. **Customer cancels at `preparing` and owes "food cost"; the courier already en route earns nothing.**
    Spec: cancellation at preparing = food cost to merchant; courier silent.
    Rule: courier en route receives 500 from the cancellation fee; merchant receives the food cost; dispatcher may flip the meal to a flash deal (phase 2).

16. **40-meal office order on a bike.**
    Spec: silent; batching limits exist, order-size limits do not.
    Rule: per-vehicle-class order caps (bike 25,000 / 6 items, tuktuk 60,000); above cap the order routes to a car and the merchant pre-confirms a prep time; above 100,000 it becomes a dispatcher-handled catering request.

17. **Printer out of paper or Bluetooth dropped; staff assume "no orders tonight".**
    Spec: accepted orders print automatically.
    Rule: print failure shows a red banner, repeats the alert, and marks the merchant pin "printer offline" on the dispatch map after 2 min.

18. **Staff member leaves the restaurant with the logged-in phone.**
    Spec: owner invites staff; roles gate money views.
    Rule: owner sees and can revoke every session per org; staff sessions expire daily; merchant login shows the org name and branch so a stale session is obvious.

19. **Restaurant closes early (ran out of gas) but the card shows open.**
    Spec: hours are config; busy mode only adds time.
    Rule: one-tap "إغلاق مبكر" with reason (كهرباء / غاز / خلص الأكل) that auto-reopens at next scheduled open; three early closes in a week → ops call.

## B. City rides

20. **Tuktuk offered an edge-zone ride, accepts, cancels on seeing the road.**
    Spec: "edge 2,000 (tuktuk may refuse; car default)"; zones visible on the offer.
    Rule: edge destinations are never offered to tuktuks unless the driver opted in; a mid-ride destination change into an edge zone can be declined by the driver without penalty and the ride ends at the original dropoff.

21. **"Night" component has no window; "peak" and "weather" have no trigger.**
    Spec: components listed, values 250, no definitions.
    Rule: city config: night 22:00–06:00; peak windows 13:00–15:00 and 19:30–22:30 plus a demand trigger with a cap; weather is an ops toggle with reason (مطر / عجاج), logged, auto-expiring after 3 h.

22. **Street-point pickup saves 250 but the customer never walks to the point; the driver waits.**
    Spec: −250 for street point; 3 min free then 250 per 5 min.
    Rule: at a street point the wait meter starts at arrival with no free minutes beyond 2; at 5 min the driver may cancel for 1,000 to the driver; the −250 is not refunded.

23. **Four adults plus bags try to board a tuktuk.**
    Spec: silent; vehicle fit is 10% of ranking.
    Rule: passenger count and luggage chips at request; vehicle class capacities in config; the driver may refuse at pickup with a reason code and no penalty, customer re-quoted for a car.

24. **Driver's phone dies at `in_transit`; the customer cannot end the ride and the fare never settles.**
    Spec: offline queue; no customer-side completion.
    Rule: customer "وصلت" tap completes the trip at the locked quote; server auto-completes when the last driver position was inside the dropoff geofence and no update for 10 min; dispatcher can close with the quote.

25. **"Pass by the grocer on the way" — mid-ride stops are the norm, not the exception.**
    Spec: `wait` 500 per 10 min; extra dropoff as a new leg; re-quote > 1 km.
    Rule: driver must accept the added leg on-screen before it is priced; the added leg uses the zone table; a declined leg ends the ride at the original dropoff; the wait meter is visible to both.

26. **Driver demands more cash than the locked quote at dropoff.**
    Spec: locked quote stands in disputes; take rates shown to drivers.
    Rule: customer receives a WhatsApp receipt with the amount at `completed`; one-tap "دفعت أكثر" report; two confirmed reports → tier drop and cash cap halved; mirror report for drivers ("دفع أقل").

27. **Haversine ranking picks the driver across the river (جسر حواس / جسر خماس / جسر برينج are the only crossings).**
    Spec: ETA = haversine × 1.4 until OSRM.
    Rule: zone-pair travel-time matrix seeded by drivers at verification time; bridge crossings add a penalty; OSRM before Kut.

28. **Ride scheduled for 05:00 to the garage; nobody is online at 05:00.**
    Spec: schedule chip exists; dispatch is silent on scheduled rides.
    Rule: scheduled rides are offered the evening before as pre-assigned jobs; the driver confirms by 22:00; fallback broadcast at T−30 with pickup compensation; customer told at booking whether a driver is confirmed.

29. **Driver and customer agree to go off-app next time.**
    Spec: silent.
    Rule: accept it: masked numbers where possible, points and share-trip as reasons to stay; measure repeat-pair drop-off, do not build a detection system.

30. **Minor booked a city ride "for someone else".**
    Spec: minors are participants, never account holders; ride-for-someone-else exists.
    Rule: allowed only with the orderer as guardian in the household; driver told the rider is a minor; routed to family-class drivers; orderer gets live view and a dropoff confirmation.

## C. الرجعة — intercity seats

31. **"Leaves when full" never fills; riders sit at البوابة ١ for two hours.**
    Spec: "leaves at X or when full"; low-fill cancel at T−30.
    Rule: every announcement carries a hard latest departure; the driver's lateness meter runs from that time; riders see live fill; dispatcher can merge two half-full cars and the driver who loses riders gets priority on the next window.

32. **Driver gives a booked seat to a walk-up who pays 2,000 more in cash.**
    Spec: "a booked seat can never be given to a walk-up" — enforced by the driver's own tap.
    Rule: `departed` requires every booked seat to be checked in (PIN) or marked no-show with the rider's GPS absence from the garage geofence; rider "أني بالكراج" tap inside the geofence blocks no-show; violation → rider paid 2× seat price from the driver plus a seat on the next car, incident.

33. **Walk-ups are free and count toward fill: driver books nobody, marks everything walk-up, never pays commission, triggers departures.**
    Spec: no commission on walk-ups at launch; walk-ups count toward fill.
    Rule: walk-ups count toward fill only after the driver's per-run selfie; walk-up share > 60% over five departures flags for a field-ops garage check; commission on walk-ups revisited at month 3 and said so in the driver terms.

34. **Demand post phantom: rider posts "أريد أرجع 17:00", takes a different car, drivers announce against ghosts.**
    Spec: demand board; "car confirmed when enough seats claimed".
    Rule: a post expires at the end of its window; claiming converts it into a held seat with the normal 10-min prepay or cash-reservation rules; drivers see claimed vs posted; unclaimed-post no-shows count toward reservation rights.

35. **"Prepay to own the seat" with no digital rail: a student in Baghdad cannot top up a wallet from النهضة.**
    Spec: cash reservation 3-min grace, no meter, rights lost after two no-shows; prepay channels undefined for riders outside Aziziyah.
    Rule: define launch prepay: wallet balance, ZainCash to the company with a reference code generated in-app, or "trusted rider" status after three completed seats; the boarding pass states which the rider has.

36. **Rider waits at جسر حواس; the driver's pickup list says جسر خماس.**
    Spec: meeting points with photos; ordered pickup route in Partner.
    Rule: rider's live position is compared with the chosen meeting point 10 min before pickup; > 300 m mismatch warns rider and driver; photo of the point on the boarding pass.

37. **Four door pickups across Aziziyah add 40 minutes while garage riders wait.**
    Spec: door pickup +fee by distance, driver accepts; no cap.
    Rule: max two door pickups per departure and 15 min total detour; door pickups scheduled before the garage time; garage riders see "boarding at X" derived from the route; the driver sees the detour before accepting.

38. **Late meter started by the driver's tap, at a garage where GPS bounces under the bridge.**
    Spec: 5-min grace then 1,000 / 10 min to driver and 500 / 10 min to each boarded rider; reference time unspecified.
    Rule: reference = announced departure time; meter is server-side; it runs only if the driver is checked in inside a 150 m garage geofence and at least one other rider has checked in; disputes default to the rule, which is now checkable.

39. **Driver lateness "mirrors" the rider rule, but drivers are late because of checkpoints and Baghdad traffic.**
    Spec: driver lateness paid from the driver's balance.
    Rule: driver meter applies at the garage departure only; for on-the-way pickups riders get ETA updates instead of a meter; the meter is waived when the trail shows a stop inside a known checkpoint geofence (seed the Baghdad-road checkpoints).

40. **20-minute forfeit leaves a prepaid woman rider alone at النهضة at 21:30.**
    Spec: after 20 min the driver may leave and the seat is forfeited.
    Rule: forfeit converts into an automatic hold on the next departure within 2 h at no extra charge (driver keeps the meter); if none exists, dispatcher is paged with the rider's location and the private-car board is opened for her at the seat price.

41. **Seat adjacency ignores gender (top 10 #9).**
    Spec: positions front, back_left, back_middle, back_right, no attributes.
    Rule: rider declares travelling-as (رجال / نساء / عائلة) at booking; back_middle is not sold to a lone woman between two male strangers and vice-versa; "book the row" and "book the car" options; family-only departures as a route attribute drivers can set.

42. **Seat map assumes a 4-passenger saloon; many Baghdad cars are 7-seat vans and Kia Carnivals.**
    Spec: `seat_map` on Route; four positions plus parcel.
    Rule: seat map per vehicle (saloon 4, SUV 6, van 7/11), Arabic position labels, front premium only where a front seat exists.

43. **Parcel slot vs student luggage in the trunk.**
    Spec: parcel seat slot; luggage silent.
    Rule: parcel slots per vehicle; riders declare large bags at booking; the driver may refuse an oversized parcel at pickup with a photo and no penalty; parcel fee refunded.

44. **Rider detained at the Wasit–Baghdad checkpoint (no ID).**
    Spec: silent.
    Rule: boarding pass reminds "لا تنسى البطاقة"; after 15 min the departure may continue with a dispatcher call; the rider's seat is treated as no-show without the meter; incident logged for the rider's safety.

45. **Live car position shown to all booked riders reveals door-pickup homes and the driver's own house.**
    Spec: live car position to all booked riders.
    Rule: position shared from boarding window to arrival only; other riders see the car, never the stop list; door-pickup riders see only their own stop.

46. **Driver cancels inside 2 h and "next departure" is tomorrow.**
    Spec: riders auto-offered next departures, difference refunded.
    Rule: no departure within 2 h → dispatcher "call a driver against demand" with the cancel fee funding 2,000 credit per rider; private-car board opened at seat price; cancel fee doubles when it strands riders after 18:00.

47. **Two brothers share the car and the account; the per-run selfie is taken by the registered one who then hands over.**
    Spec: per-run check-in selfie.
    Rule: random selfie prompt at a mid-route stop (meeting point or checkpoint); rider one-tap "هذا مو السايق بالصورة" opens the SOS flow; fleet accounts register both brothers legitimately.

48. **Cash rider "moved" to a pricier departure; prepaid rider moved to a cheaper one.**
    Spec: same seat class honoured, difference refunded.
    Rule: moved rider never pays more than the original seat; a cheaper destination refunds to wallet or is paid back in cash by the new driver at check-in (ledger line); cash riders pay the lower price.

49. **Baghdad is "a garage object" but door pickups and drop-offs in Baghdad need pricing, dispatchers, and support with no zones.**
    Spec: multi-city config; only النهضة is modelled.
    Rule: "corridor endpoint" city type: garage + per-km door pricing + checkpoint geofences, no zone table; support hours cover departures from both ends.

50. **Request board for private cars: negotiated price, wallet deposit, no deposit rules.**
    Spec: "post, driver offers, pick, wallet deposit, in-app chat".
    Rule: deposit 20% (min 5,000) locked at pick; driver no-show refunds 2× deposit from the driver's balance; rider no-show forfeits it; offers in multiples of 1,000; chat retained for disputes.

## D. Khat subscriptions and guardians

51. **Child not at the stop and no absence reported.**
    Spec: absence for tomorrow; same-day silent.
    Rule: 2-min wait, guardian auto-called, then `skipped` with a guardian push; no refund; three unreported absences in a month → nudge; the driver's punctuality is not penalised for skipped stops.

52. **No per-child handover (top 10 #5).**
    Spec: arrival = driver tap in geofence; guardian notified on arrival.
    Rule: driver taps each child in at pickup and out at dropoff by name (QR card on the bag in phase 2); "وصل بالسلامة" is sent only on the per-child tap; a child still "in" when the run ends pages the dispatcher.

53. **Guardian consent requires "the second person's OTP", but a 9-year-old has no phone.**
    Spec: GuardianLink targets a Person or a Participant; consent flow written for persons.
    Rule: a minor participant is created by the primary guardian without consent; a second guardian is added by the primary guardian's approval plus the second's OTP; only the primary can revoke.

54. **Separated parents: one revokes the other's live view; the other pays the subscription.**
    Spec: explicit, revocable grant in the audit log.
    Rule: revoking a guardian who is the subscription payer requires ops review; both parties are notified; the driver is never put in the middle (no "don't give the child to X" instructions in-app).

55. **Substitute appears with 30 min notice and the parent cannot say no.**
    Spec: parents notified with the sub's photo 30 min before pickup.
    Rule: the route shows its pre-approved substitute pool (up to three) at enrolment; a parent may decline a sub with one tap → child marked absent and the day credited; the primary driver's absence inside 12 h is scored.

56. **School calendar: Ashura, Arbaeen, mid-year break, exam half-days, ministry closures — the month is billed on "service days" nobody defined.**
    Spec: proration by remaining service days.
    Rule: a city school-calendar object maintained by ops (public holidays, religious closures, exam schedule); proration and renewal use it; closures announced after billing are credited at month end.

57. **`past_due`: does the driver still take the child?**
    Spec: state exists; consequence silent.
    Rule: 5-day grace with WhatsApp; after grace the seat pauses from the next morning pickup only, never from an afternoon return; the driver is told the seat is paused, not why.

58. **First week free, then a new phone every month.**
    Spec: trial for new riders.
    Rule: trial once per child (name + school + guardian fingerprint), not per phone.

59. **Families want girls-only khats for secondary school.**
    Spec: silent.
    Rule: route attribute (بنات / أولاد / مختلط ابتدائي) set by the driver and confirmed by ops; shown on the marketplace; female escort option is a later tier.

60. **Driver quits mid-month.**
    Spec: rider cancel: "driver keeps the month"; driver exit silent.
    Rule: driver paid for served days; the remainder funds a substitute; seven days' notice or a scoring hit; parents get the substitute pool, not a marketplace scramble.

61. **Route deviation alert during a khat run sends "I'm fine / help" to a guardian who is not in the car.**
    Spec: khat guardians get the same prompt as a ride customer.
    Rule: deviation goes to the dispatcher first; the driver gives a one-tap reason (الشارع مسدود / تفتيش); guardians get the reason and the new ETA; escalate only if no reason in 3 min.

62. **Khat runs at 06:45; support opens at 10:00.**
    Spec: support 10:00–24:00; SOS always escalates.
    Rule: an on-call phone line 06:00–09:00 and 13:00–15:00 on school days staffed by the field-ops person; khat incidents are the only thing it handles.

## E. Parcels

63. **"No PIN" fallback: courier sends a photo of a gate, the sender taps approve, parcel gone.**
    Spec: sender approves release with one tap on photo + location.
    Rule: the fallback photo must show the receiving person or the handed-over parcel in the recipient's hands; above 50,000 declared value the fallback is disabled and the parcel returns; courier liability unchanged.

64. **Cash, gold, medicines, documents — the first parcels people will send.**
    Spec: prohibited list acknowledged by sender; contents unspecified.
    Rule: explicit prohibited list in Iraqi Arabic (كاش، ذهب، أدوية بوصفة، مستمسكات رسمية، سلاح، كحول); courier may refuse at pickup with a photo; cash parcels are refused outright and the request is pointed to the wallet.

65. **Intercity parcel: nobody comes to النهضة; the driver has to go back.**
    Spec: same hand-over at the destination garage.
    Rule: driver holds 30 min; then the parcel moves to a garage agent or returns on the next car with a storage/return fee charged to the sender; after 48 h it returns to the sender; every step on the timeline.

66. **A 300,000 phone declared at 50,000 to save fee; lost.**
    Spec: courier liable up to tier cap.
    Rule: liability = min(declared, courier tier cap), stated on the confirm screen; above 50,000 requires a Gold courier and a photo of the contents; the fee scales with declared value so under-declaring is visible.

67. **Shop-to-customer parcels want cash on delivery for the goods, not just the fee.**
    Spec: parcel fee only.
    Rule: COD amount field; `cash_collected` on behalf of the sender; counts toward the courier cap; paid out to the sender via settlement; refusal at the door = return fee to sender.

68. **Parcel declared "fragile" on a bike in 48°C.**
    Spec: fragile flag, size class.
    Rule: fragile/perishable forces tuktuk or car class; the courier sees the flag on the offer; perishables (cake, medicine on ice) are time-capped at 45 min with a refund rule.

## F. Errands / shop-for-me

69. **Shopper buys 35,000 of groceries; the customer refuses at the door and pays nothing.**
    Spec: cancel after purchase pays receipt + fee — uncollectable for cash customers.
    Rule: errands above 20,000 require wallet balance, a deposit, or Gold customer tier; otherwise the shopper photographs the basket before paying and the customer approves with one tap; refusal after approval becomes debt and blocks cash errands.

70. **السوق has no receipts; "mandatory receipt photo" is impossible there.**
    Spec: mandatory receipt photo; learned prices.
    Rule: no-receipt shops use itemised entry against the learned price range; any line > 25% above range needs customer approval before purchase; random field-ops price checks.

71. **Prices exceed the ceiling mid-shop.**
    Spec: customer ceiling; no hard stop.
    Rule: hard stop: the shopper cannot mark purchase above the ceiling without a customer approval card; purchases above the ceiling without approval are the shopper's cost.

72. **The shopper fronts 40,000 of their own cash and is reimbursed at next settlement.**
    Spec: `errand_cost_actual` as a ledger line.
    Rule: say it plainly in Partner: the actual cost nets against cash owed immediately, so a shopper's cap exposure drops by the receipt; shoppers see their float position live.

73. **Voice list in dialect mis-transcribed.**
    Spec: voice input supported.
    Rule: transcript shown for confirmation before dispatch; the shopper hears the original audio; the customer is called for ambiguous lines before purchase, not after.

74. **Pharmacy errands.**
    Spec: silent.
    Rule: OTC only; prescription items need a prescription photo attached; the shopper is not liable for a wrong item when the photo matches what was bought.

## G. Money and ledger

75. **Referral liability (top 10 #1).**
    Spec: 2,000 points both sides; 100 points = 1,000 IQD.
    Rule: referral pays 2,000 IQD (200 points) per side, unlocked after the referee's second completed cash-paid order ≥ 10,000; monthly cap per referrer; device + phone + place fingerprint; the launch budget line re-computed.

76. **Points cashback vs margin (top 10 #2).**
    Spec: 1 point per 100 IQD GMV on food.
    Rule: points earn on platform revenue (service fee + commission), or 1 per 1,000 of GMV, capped per order; redeemable against the service fee first, delivery fee second; the finance page shows points liability as a % of margin.

77. **Who pays the restaurant at pickup (top 10 #3).**
    Spec: weekly payout 12,750; courier holds the cash.
    Rule: decide and write it: launch model is courier pays the merchant at pickup from float (ledger `merchant_paid_at_pickup`), platform collects commission from the merchant weekly; courier cap then covers fees + commission only; merchant payouts become commission invoices.

78. **Cash-on-delivery enforcement (top 10 #4).**
    Spec: customer owes cost; prepay required after two no-shows per phone.
    Rule: new accounts in their first three orders are capped at 15,000 and must confirm the arriving call; merchant-funded loss is capped by a platform "prank order" fund in month 1; "prepay required" keys on device + phone + place, not phone alone.

79. **Courier records `cash_collected` lower than the quote.**
    Spec: cash collection confirm writes the ledger; discrepancies adjusted after the fact.
    Rule: the amount defaults to the quote; a lower figure needs a reason code; the customer receives a WhatsApp "دفعت {amount}" receipt and one-tap dispute; three reason-coded shortfalls in 30 days → review.

80. **Cash cap of 75,000 vs a single Baghdad private fare or one large food order.**
    Spec: over cap after the current job; one cap for all drivers.
    Rule: caps by role (city courier 75k/150k/300k; intercity driver 300k with weekly settlement); prepaid trips do not count; a single job may exceed the cap if its value ≤ 50% of the cap.

81. **Field-ops cash round at 23:00 carrying 2–3 million through Aziziyah.**
    Spec: cash round with WhatsApp receipt.
    Rule: daytime collection at agent shops as default; evening rounds capped at 1M and two-person above that; receipt with photo of the counted stack in Ops mode; route randomised.

82. **ZainCash auto-match by amount + driver ID: two drivers send 75,000 the same hour, or one sends 74,500.**
    Spec: auto-matched by amount + driver ID.
    Rule: Partner generates a unique settlement reference the driver types into the ZainCash note; match on reference first, amount ± 500 second, manual queue third.

83. **Refund "to wallet credit" for a customer who only pays cash.**
    Spec: refunds default to wallet; cash refunds via support only.
    Rule: refunds above 10,000 default to cash via the next courier (ledger `refund_cash_delivered`) or an agent shop; wallet credit remains the default below that.

84. **Promo cap auto-stops between quote and payment.**
    Spec: budget caps auto-stop.
    Rule: a promotion is reserved at quote lock for 10 min and the cap counts reservations.

85. **Invariant fails at 02:00 and the fix is a hand-written `adjustment`.**
    Spec: adjustment event type; nightly incident.
    Rule: posting groups are validated to sum to zero at write time; `adjustment` needs a finance role, a reason, and a linked incident; above 25,000 a second approver.

86. **Driver balance goes negative (penalties, late meters, cancellations).**
    Spec: `driver_settlement` is driver → platform only.
    Rule: platform → driver payouts via ZainCash or the ops round when negative beyond 20,000 or weekly; shown on the morning WhatsApp.

87. **Commission base is undefined (before/after merchant deals, with modifiers?).**
    Spec: 12/15/18% "by what the merchant receives".
    Rule: commission on item subtotal after merchant-funded discounts, before the service fee and delivery; written into the merchant agreement and the statement header.

88. **Rounding: 10% of 1,750 is 175; customer totals are multiples of 250; nobody has 250 notes.**
    Spec: round to 250 per city; "round to 250/500".
    Rule: customer-facing totals in multiples of 500 (250 only where a 250 component exists and is config-enabled); internal splits stay as integers; rounding residue posts to a platform `rounding` account.

89. **Tips in cash vs in-app tips settled a week later.**
    Spec: `tip` ledger line; 0% take presumably.
    Rule: in-app tips are 0% take, shown as a separate line in the morning WhatsApp, netted against cash owed the same day.

90. **Household member under their limit orders cash anyway.**
    Spec: orders over a limit request payer approval.
    Rule: limits govern wallet-paid orders; members flagged as minors cannot pay cash at all; the payer sees every household order regardless of payment.

91. **Shift guarantee (10,000 per 4-hour peak at ≥ 85% acceptance) is gamed by accepting then cancelling or by sitting at the zone edge.**
    Spec: guarantee topped up by platform; switches off per zone by average earnings.
    Rule: guarantee requires ≥ 85% acceptance **and** ≤ 1 cancel after accept **and** ≥ 3 completed jobs in the shift; paid Sunday with the scorecard, not nightly.

## H. Identity

92. **One phone shared by a family (top 10 #7, part 1).**
    Spec: one identity per phone number.
    Rule: keep one Person; "saved people" and participants carry who the order is for; optional app PIN lock; history never shows home photos (already) and hides points balance behind the PIN.

93. **Recycled numbers (top 10 #7, part 2).**
    Spec: silent.
    Rule: after 120 days of inactivity a login requires name + last order or a support check; guardian links, wallet, and driver roles freeze until re-verified; a new device + long inactivity triggers the same.

94. **Customer or driver changes number; a driver loses a SIM with 60,000 cash held.**
    Spec: silent.
    Rule: change-number flow with OTP on both numbers; lost-SIM path via support with ID selfie; the old number is blocked for 30 days; driver cash position carries over.

95. **Dual-SIM reality: OTP lands on SIM 1, WhatsApp lives on SIM 2.**
    Spec: WhatsApp as a channel to the account phone.
    Rule: a separate "رقم الواتساب" field verified by a WhatsApp OTP; notifications route to it.

96. **Driver account used by a brother or a hired teenager.**
    Spec: daily selfie; per-run selfie for intercity/khat.
    Rule: one random in-shift selfie per day plus a selfie at every cash settlement; plate photo at check-in; fleet owners register additional drivers properly.

97. **Under-18 tuktuk drivers are common in Aziziyah.**
    Spec: ID review at onboarding.
    Rule: date of birth from the unified card is a hard gate at ≥ 18; ops cannot override; the rejection message says why.

98. **Documents vary: unified national card vs old civil ID + nationality certificate; many tuktuks have no plate.**
    Spec: ID both sides, licence for cars, plate photo.
    Rule: accept unified card or (civil ID + nationality certificate); plate is nullable for tuktuks with chassis photo and owner statement; the customer app shows "توك توك بدون لوحة — رقم {id}".

99. **Mother is the daily contact but has no phone of her own.**
    Spec: household/guardian links need the second person's OTP.
    Rule: more than one guardian per child; WhatsApp-only guardians (no account) receive arrival messages as participants; the father's approval adds them.

100. **Driver orders food to himself with the free-delivery promo; a dispatcher assigns their cousin.**
    Spec: fraud fingerprint for new-user offers.
    Rule: a driver is never offered their own or their household's order; referrals inside a household are void; dispatcher overrides to a driver in the same household as the agent are blocked.

101. **Support agent issues credits to friends.**
    Spec: support overrides are logged.
    Rule: per-agent daily credit cap (10,000) above which finance approves; weekly report of credits by agent vs disputes handled.

## I. Offline and timestamps

102. **Backdated device clock (top 10 #10).**
     Spec: flag if device time > server + 60 s or < server − 7 d.
     Rule: clients send monotonic uptime alongside wall time; any backward wall-clock jump within a session flags; evidence-grade events (arrival, delivery, check-in) use server `recorded_at` bounded below by the last good sync; scoring uses recorded time.

103. **Courier offline 40 min in الدير; dispatcher reassigns; both couriers "deliver"; both `cash_collected` replay.**
     Spec: contradictions emit `dispute_opened`.
     Rule: reassignment of an order whose courier is offline needs a dispatcher confirmation and a call attempt; replayed events after `detached_at` attach to the old TripOrder as `late_replay` and settle only via support; the customer is asked which courier delivered.

104. **Customer's queued order submits 30 minutes later.**
     Spec: customer app has an action queue.
     Rule: customer-side actions expire (place order 2 min, cancel 10 min, rating 24 h); expired placements ask "تريده بعد؟".

105. **Reinstalled app generates fresh idempotency keys for the same taps.**
     Spec: idempotency key per event.
     Rule: key derived from (person, aggregate, action, client sequence); the server also dedupes semantically on (trip, stop, type) inside a 10-min window.

106. **Presence TTL 90 s expires during a network blip on an active job.**
     Spec: Redis geo TTL 90 s; "recently offline" colour.
     Rule: on-job drivers keep presence for 10 min on last-known position; the customer sees "انقطعت الإشارة" with the last time; batching excludes them.

107. **Xiaomi/Tecno/Infinix kill the Partner app in the background; offers are "in-app only"; timeouts hurt the score.**
     Spec: job offer in-app only; timeout/ignore rate is 10% of the index.
     Rule: foreground service + high-priority FCM data message + battery-optimisation step in onboarding; an offer counts as "seen" only after 3 s of foreground; drivers with repeated unseen offers are auto-set offline, not scored.

108. **Nationwide internet cut on exam mornings (June–July, ministry policy) takes the platform down for hours.**
     Spec: silent.
     Rule: exam-shutdown calendar; SMS-only mode for khat and intercity (driver gets the stop list by SMS at 05:00); customers get a status banner; shift guarantee suspended, drivers told the day before.

## J. Dispatch

109. **Rebroadcast +500 exploit (top 10 #6).**
     Spec: +500 platform-funded after 60 s of no acceptance.
     Rule: the compensation is paid only to a driver who was not in waves 1–2; drivers who ignored wave 1 are excluded from the rebroadcast for that trip; compensation funded from the platform's monthly cap with a per-driver weekly limit.

110. **Driver accepts everything to protect acceptance, then crawls.**
     Spec: on-time arrival is scored; no auto-release.
     Rule: accepted and not moving toward pickup for 3 min → auto-release with a soft penalty; the trip re-enters wave 1.

111. **Batch accepted for +700, first delivered, second cancelled.**
     Spec: batched second order pays 70%; courier cancel after pickup pays food cost.
     Rule: the second order's fee is paid only on its delivery; cancelling it after the first delivery counts as cancel-after-pickup for scoring and cost.

112. **Fifteen tuktuks parked at مطعم خالد starve معمل سوس.**
     Spec: ranking distance 40 / tier 30 / load 20 / fit 10; pre-positioning suggestions.
     Rule: a fairness term penalises drivers offered in the last 10 min; demand-weighted pre-positioning nudges with a 250 bonus for moving, dispatcher-confirmed.

113. **Fleet owner with five driver accounts on one phone accepts everything and re-dispatches by phone.**
     Spec: fleet owner dashboard; nothing on concurrency.
     Rule: one active job per Person; a device is bound to one driver role at a time; fleet owners cannot accept on behalf of drivers.

114. **Auto-assign at `readyAt − 2 min` when the nearest courier is 8 min away.**
     Spec: fixed 2-min lead.
     Rule: lead time = estimated travel time to pickup + 1 min; if no courier is within that time at acceptance, assign immediately and tell the merchant the courier ETA.

115. **Suggest-only mode at peak makes the dispatcher the bottleneck.**
     Spec: "suggest only" routes every decision to the console.
     Rule: suggest-only per zone × vertical only, with a 60-s timeout that falls back to the configured auto policy and logs it.

116. **Dispatcher drags a card onto an over-cap or offline driver.**
     Spec: drag to assign; override logged.
     Rule: validation on drop (online, under cap, vehicle fit); forced assign needs a reason and the driver still gets accept/decline.

117. **Low-fill cancel at T−30 when a sixth rider is walking up at T−25.**
     Spec: ≥ 3 seats by T−30 or cancelled.
     Rule: at T−30 with 2 seats the departure goes to "عالحافة" for 10 min with the dispatcher pinged before cancelling; a demand post in the window counts as half a seat.

## K. Pricing

118. **Enabling metered components turns a 1,500 zone fare into 2,300; neighbours compare screenshots.**
     Spec: shadow components hidden until enabled.
     Rule: metered rollout per vertical with a ceiling at zone price + 25% and a floor at zone price − 25%; one price on the receipt; holdout measured in analytics before widening.

119. **Pin dragged 900 m at a time to cross into a cheaper zone.**
     Spec: re-quote only on > 1 km dropoff move.
     Rule: re-quote on any zone change or cumulative movement > 1 km; a saved place's zone is frozen at its first confirmed delivery.

120. **"Sanity check against the last 100 similar trips" in Kut on day 1.**
     Spec: as written.
     Rule: fall back to the vertical's floor/ceiling table until 100 trips exist; the console shows which check applied.

121. **Private intercity car on the request board has no components.**
     Spec: driver offers, rider picks.
     Rule: offer = one `negotiated` component, locked at pick; take 8% on it; deposit rules per item 50.

122. **Pickup compensation on food (> 2 km from courier) rewards couriers who idle far away.**
     Spec: paid when pickup > 2 km from the courier.
     Rule: paid only if no courier within 2 km was online and under cap; capped at 500 per job and 3 per shift.

123. **Dust storms, 50°C afternoons, and rain are the real weather, not "rain +250".**
     Spec: `weather` component labelled rain.
     Rule: weather reasons مطر / عجاج / حر with the same 250; heat applies 13:00–17:00 June–September for bikes only; ops toggle, logged.

## L. Safety and privacy

124. **SOS audio records the other party without their consent.**
     Spec: consent at signup on the pressing device.
     Rule: both drivers and customers consent at signup to being recorded when either presses SOS; recording stated in the SOS screen; 30-day retention or incident.

125. **Courier screenshots a gate photo of a women-headed household.**
     Spec: visible from `accepted` to `completed` + 1 h.
     Rule: visible from `en_route_to_pickup` only; in-app viewer with screenshot block where the OS allows and a courier-ID watermark everywhere; access logged per view.

126. **Share-trip link forwarded into a WhatsApp group.**
     Spec: trip sharing to an emergency contact.
     Rule: link expires at trip end + 15 min, shows viewer count, revocable by the rider; no name or phone on the shared page.

127. **"Masked calls only" with no masking provider in Iraq at launch.**
     Spec: outbound masked calls; masked call in the unreachable protocol.
     Rule: in-app VoIP (LiveKit/Agora) is the primary channel; where it falls back to GSM the app says the number will be visible; drivers see the customer number only from `accepted` to `completed`.

128. **Driver contacts a female rider after the ride.**
     Spec: silent beyond incidents.
     Rule: "تواصل بعد الرحلة" report from history; one verified report → review and the pair is never matched again; two → suspension; women can set "family class only" as a default.

129. **False SOS to punish a driver, or SOS misuse by drivers.**
     Spec: SOS always escalates.
     Rule: every SOS opens an incident on both parties; two SOS with no finding in 90 days → flag and a warning; never a fee.

130. **Accident on the Baghdad road with four riders aboard.**
     Spec: incident workflow; emergency contact per user.
     Rule: a departure incident notifies every booked rider's emergency contact with the car's last position; dispatcher script with hospital numbers for Wasit and Baghdad; Ali called.

131. **ID photos in the vault are kept forever; one leak doxxes every driver.**
     Spec: selfies dropped after 90 days; IDs kept.
     Rule: after approval keep the document number hash, expiry, and the ops attestation; drop the images at 90 days unless an incident is open; KMS encryption from M2, not "later".

132. **Route-deviation alerts fire at every checkpoint queue and road closure; dispatchers tune them out.**
     Spec: > 500 m or > 5 min unexplained stop.
     Rule: checkpoint and known-closure geofences suppress the alert; the driver's one-tap reason clears it; alerts without reason escalate; alert volume is a dashboard metric.

## M. Merchant operations

133. **Photo menu import drops a zero; a 7,000 dish is listed at 700.**
     Spec: photo-based import corrected by staff.
     Rule: price sanity against taxonomy medians; every imported item is confirmed by staff before publish; orders on an item priced < 30% of its median hold for merchant confirmation.

134. **"Sold-out-today" resets at midnight; the shop is open until 02:00.**
     Spec: auto-reset.
     Rule: reset at the merchant's configured day-start.

135. **Two branches, one menu; which branch cooks?**
     Spec: branch overrides exist.
     Rule: branch chosen by the delivery zone with a fallback order; the merchant board is per branch.

136. **Serial "missing item" claims from the same customers against the same merchant.**
     Spec: > 3 disputes in 30 days → manual review per customer.
     Rule: also per merchant-customer pair (2 in 30 days) and per merchant (dispute rate vs peers); merchant can attach a packing photo at `ready`.

137. **ESC/POS printers render Arabic reversed or as boxes.**
     Spec: Bluetooth printer prints accepted orders.
     Rule: tickets rendered as bitmaps from the app; tested printer list; a sample ticket is part of the onboarding visit.

138. **Power cut mid-peak; the tablet dies; the merchant is still "open".**
     Spec: silent.
     Rule: tablets supplied with a power bank; missed heartbeat for 2 min → auto-busy and a dispatcher call; the card shows "ممكن تأخير" honestly.

## N. Notifications

139. **Quiet hours 23:00–07:00 silence the 1-hour reminder for a 05:00 departure.**
     Spec: quiet hours except active trips.
     Rule: departure, khat, and settlement reminders are exempt; marketing never is.

140. **WhatsApp Business quality rating drops; templates are paused; money and safety messages stop.**
     Spec: WhatsApp for money and safety; marketing max 2/week.
     Rule: utility templates only on the main number; marketing on a second number; quality rating on the system panel with SMS auto-fallback when it drops.

141. **Merchant loud alert every 20 s "until seen" during prayer.**
     Spec: as written.
     Rule: cap at 3 min, then SMS to the owner and a dispatcher card; inside a declared pause no alert.

142. **OTP by SMS takes 4 minutes on a bad Asiacell route; expiry is 3 min.**
     Spec: 3-min expiry, 30-s resend.
     Rule: 5-min expiry; WhatsApp OTP first where the number has WhatsApp; voice-call OTP as the third fallback.

143. **Every notification deep-links; a family phone opens someone else's order.**
     Spec: deep links to the screen.
     Rule: sensitive screens (home photo, wallet) require the app PIN when set; notifications never carry the amount for shared devices (config per account).

## O. Support and disputes

144. **AI first line is talked into a refund ("ignore your rules").**
     Spec: AI resolves common cases, hands off above a money limit.
     Rule: the AI proposes; auto-apply only the default-outcome table up to 2,000; everything else is a one-tap for a human; prompts and tool scopes reviewed weekly with the ledger.

145. **"No photo → courier pays 50%" at night with a broken camera.**
     Spec: as written.
     Rule: a customer confirmation tap or a completed call substitutes for the photo; dark photos count; the courier app forces the flash.

146. **Escalation to Ali for money > 25,000 while Ali is in the lab.**
     Spec: as written.
     Rule: a named deputy with the same authority on a rota; the console shows who is on escalation duty.

147. **Dispute opened after `closed` (2 h) because the customer was asleep.**
     Spec: support only after 2 h.
     Rule: customer-facing dispute window 12 h for food and 24 h for rides; money settles on `closed` but refunds can still post as new lines.

148. **"هل انحلت مشكلتك؟" spam-tapped "no" to keep a ticket open for more credit.**
     Spec: one tap after every resolution.
     Rule: a "no" re-opens once; the second "no" goes to a human with the thread; credits per customer per month are capped and visible to agents.

## P. Scaling and multi-city

149. **Kut corridor is "second" but only Aziziyah has zones, dispatchers, and support hours.**
     Spec: multi-city from day one as data.
     Rule: a written city-onboarding checklist as data: zones verified, meeting points, checkpoint geofences, calendar, hours, support rota, ZainCash agent list; a city cannot be enabled without it.

150. **Frankfurt Postgres at 120–180 ms from Iraqi ISPs, with throttling on some routes.**
     Spec: Supabase Frankfurt.
     Rule: measure p95 from Zain/Asiacell/Korek before launch; CDN edge for tiles and images; aggressive client caching; a status banner on elevated latency.

151. **Simulator models geography but not 2G, clock skew, or app kills.**
     Spec: simulator on real geography with invariants.
     Rule: chaos knobs: packet loss, clock skew, background kills, duplicate replays; invariants must survive them.

152. **Expo + Skia + Rive + MapLibre on a 2 GB Tecno over 3G.**
     Spec: stack chosen for animation.
     Rule: APK size budget (≤ 40 MB), lite mode without Rive, tile pre-cache for the city, tested on the three cheapest phones sold in Aziziyah.

## Q. Iraq-specific realities

153. **National grid cuts and generator schedules shape when kitchens and chargers work.**
     Spec: silent.
     Rule: "كهرباء" as a one-tap merchant pause reason; courier power-bank in the kit; a demand model that expects the post-cut surge.

154. **Eid: three days of travel; drivers gone; intercity demand triples the day before.**
     Spec: silent.
     Rule: holiday calendar drives a pre-Eid intercity push and reduced food promises; shift guarantee suspended with notice.

155. **Muharram and Arbaeen: processions close central streets; مواكب feed people for free; the Baghdad road fills with pilgrims.**
     Spec: silent.
     Rule: event calendar with temporary closure polygons that re-route and re-tier; Arbaeen intercity mode (longer ETAs, no late meter on the road); food demand forecast adjusted.

156. **Small-note shortage makes 250 rounding unreal.**
     Spec: nearest 250.
     Rule: see item 88; customer totals in 500s; the courier float rule.

157. **SIM registration under a relative's name; a driver's "phone" is legally the father's.**
     Spec: one identity per phone.
     Rule: identity rests on the national ID, not the SIM; number change (item 94) is the recovery path; never block a driver because the SIM registrant differs.

158. **Women passengers (items 9, 40, 41, 128): no female drivers at launch is stated honestly, but nothing else is designed for them.**
     Spec: "vetted-driver promise".
     Rule: women can set family-class default, share-by-default on, hide name from drivers (initial only), book the row; female field-ops contact for support; measure female share of riders as a launch metric.

159. **School calendars (item 56) also move food demand: exam season evenings and summer break.**
     Spec: silent.
     Rule: the same calendar feeds demand forecasting and pre-positioning.

160. **Checkpoints on the Baghdad road (items 39, 44, 132) make every ETA a range.**
     Spec: ETAs as points.
     Rule: intercity ETAs are shown as ranges built from the last 20 trips at that hour; the boarding pass says "التفتيش ممكن يأخر 15–30 دقيقة".

161. **2G/EDGE pockets in الدير، برينج، بزل حلاته.**
     Spec: offline-first clients.
     Rule: a coverage map seeded by driver reports; offers to drivers in a 2G pocket get +10 s; `arrived` works on cached geofences.

162. **Fuel queues and price spikes change tuktuk economics overnight.**
     Spec: fares are config.
     Rule: a fuel index on the finance page; a 500 "fuel" component that ops can enable per vehicle class with a dated reason.

163. **USD handed for a Baghdad private car.**
     Spec: IQD only.
     Rule: IQD only, stated on the request board; drivers may refuse USD without penalty.

---

## Three things the specs get right that the review depends on

Keep them: append-only ledger with sum-to-zero (item 85 only tightens it); every actor action as an event with both timestamps (items 102–105 build on it); defaults in Iraqi Arabic with a next step (every rule above fits that voice).

## Suggested order of fixes before Milestone 2 Step 1

Items 75, 76, 77, 78 (money model) change the Prisma schema and the ledger postings; items 92–95 and 102 change identity and events; items 41 and 52 change Seat and Stop. Everything else is config, copy, or a later step.
