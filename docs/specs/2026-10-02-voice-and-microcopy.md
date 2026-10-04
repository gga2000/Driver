# Driver (درايفر) — Voice & Microcopy Spec

Date: 2026-10-02 · Status: approved — Plan 6 (microcopy library) complete. Strings live in `packages/i18n/src/locales/ar-IQ.json` (source of truth) and `en.json` (matching keys). ~830 keys, dotted and grouped by screen.

## 1. Who we are talking to

Four audiences, one voice:

| App | Audience | How we sound |
|---|---|---|
| Driver (customer) | people in Aziziyah ordering food, a tuktuk, a seat to Baghdad, a parcel | a friend who knows the town, quick and reassuring |
| Driver Partner | couriers, taxi/tuktuk drivers, intercity and khat drivers | a fair boss: direct, numbers up front, never preachy |
| Driver Merchant | restaurant and grocer staff on a phone or tablet | a clear kitchen ticket: short, imperative, loud when it matters |
| Console | our own dispatch, support, finance | terse, operational; Arabic labels, no slogans |

## 2. Tone rules

1. **Warm, short, specific.** Say what happened, what happens next, and what the person can do. One idea per string.
2. **Iraqi dialect, not MSA.** We write the way people in Wasit and Baghdad talk. MSA reads like a government form; nobody feels looked after by a government form. Formal legal copy (terms, privacy) is the single exception.
3. **Honest before polite.** If we are late, we say "تأخرنا وهذا غلطنا". If the fare is locked, we say so. A delay message always carries a new time.
4. **Numbers up front for drivers.** Every driver string that involves money names the amount, who it goes to, and when. Take rates are shown, never hidden.
5. **Every fee has a reason.** Each pricing component has a label (`quote.*`) and a one-line reason (`quote.reason.*`). Receipts show both.
6. **Calm in danger.** SOS and unreachable flows never shout at the user; they state the fact and the next step ("وصلنا تنبيهك. الديسباتشر يشوف موقعك هسة").
7. **No blame on the customer, no blame on the driver.** Disputes state outcomes, not verdicts about character.
8. **No marketing voice in product copy.** Exclamation marks only on "طلب جديد!" for merchants and "مبروك" for tier-ups.

## 3. Addressing the user

- Second person singular masculine by default (`تگدر`, `طلبك`, `عندك`). This is how Iraqi apps and shops address everyone and is read as neutral. Avoid the feminine/masculine split in UI strings; where a name is known we use it (`هلا {name}`).
- Guardians are addressed as parents, with the child's name in the string (`{child} وصل {place} بالسلامة`).
- Participants (someone ordered for) get their own name and the orderer's name: `{name}: طلبك مع {orderer} {status}`.
- We say "احنا" / "منا" for the company ("هذا غلطنا", "من طرفنا"), "درايفر" when naming the brand as a funder or sender.
- Couriers are "الدليفري" (food, parcels, errands); taxi, intercity and khat drivers are "السايق"; the shop-for-me role is "الشاري".
- We never call the user "عزيزي العميل".

## 4. Dialect choices (use these, not the MSA form)

| Meaning | Use | Avoid |
|---|---|---|
| now | هسة | الآن |
| where | وين | أين |
| what | شنو / شـ | ماذا |
| how | شلون | كيف |
| there is / isn't | أكو / ماكو | يوجد / لا يوجد |
| you can | تگدر | يمكنك |
| go, come on | يلا | هيا |
| tomorrow | باچر | غداً |
| a lot | هواي | كثيراً |
| wait | انتظر / انتظرني | يرجى الانتظار |
| get it to me | جيبلي | أحضر لي |
| take off / remove | شيل | أزل |
| being prepared | دا يتحضّر | قيد التحضير |
| okay / fine | تمام | حسناً |
| yes | إي | نعم |
| taxi driver | سايق | سائق |
| the road / on the way | بالطريق | في الطريق |
| in the car | بالسيارة | في السيارة |
| ring the bell | دگ الجرس | اقرع الجرس |
| hello | هلا / يا هلا بيك | مرحباً |
| sold out | خلص | نفد |

- The letters **گ** and **چ** are written as Iraqis write them in chat (`تگدر`, `لگينا`, `باچر`). Do not substitute ق/ك or ج/ك.
- Prefix `بـ` for "in/at" (`بالشارع`, `بالطريق`), `لـ` for "for/to" (`لـ {name}`).
- Hamza and shadda are written where they disambiguate (`أكّد`, `تحضّر`, `مثبّت`) and dropped where they are noise.
- Keep vocatives short: `هلا {name}`, never `أهلاً وسهلاً بك يا {name}`.

## 5. Numerals, money, time

- **Western-Arabic digits (0–9)** everywhere, including inside Arabic strings. Thousands separator is a comma: `1,000 دينار`. No Eastern-Arabic digits (٠–٩).
- Currency is always `دينار` after the number; never "د.ع" or "IQD" in customer-facing Arabic. English uses `IQD`.
- Amounts are inserted via `{amount}` placeholders already formatted by the client. Cash totals are rounded up to 250 and the remainder is shown as "الباقي رصيد" (change to the wallet), never as a "تقريب +" line.
- Time: 12-hour, `الساعة {time}` with the client formatting `7:30`. Durations: `{n} دقيقة` for singular/plural alike (Iraqi speech uses `دقيقة` after numbers above 10 and `دقايق` for 3–10; we use `دقايق` only in fixed phrases such as "5 دقايق", "أول 3 دقايق").
- Countdowns use `{minutes}:{seconds}`.
- Distances: `{n} كم`.

## 6. Placeholders

- App strings use single braces `{name}`, resolved by the `t()` helper. Unknown params stay visible (`{minutes}`) so a missing value is caught in QA rather than rendered blank.
- WhatsApp templates (`wa.*`) use Meta's numbered form `{{1}}`, `{{2}}` … in both languages, in the same order, so one template registration serves both locales. The order of variables is part of the key's contract; do not reorder without a new key.
- `push.*.title` and `push.*.body` are paired; the body may be a bare `{nudge}` or `{outcome}` placeholder when the content comes from another key.

## 7. What to avoid

- MSA verb forms and particles: `يرجى`, `قم بـ`, `سوف`, `لقد`, `حيث`, `إن`, `لا يوجد`.
- Passive bureaucratic phrasing (`تم رفض الطلب` → `المطعم ما گدر يستلم طلبك`).
- Apologising without a next step. Every "نعتذر" is followed by a time, a credit, or an action.
- Threats. Consequences are stated as facts with a date ("التغيير يصير يوم الأحد الجاي").
- Emojis in strings. The only symbol is `✓` on the verified badge.
- Religious formulas as filler. "الحمد لله على السلامة" is fine on arrival; do not sprinkle "إن شاء الله" into ETAs, which read as doubt.
- Gendered guesswork, honorifics (`أستاذ`, `حجي`), and "عزيزي".
- English loanwords where an Iraqi word exists. Accepted loanwords because that is what people say: `دليفري`, `منيو`, `كاش`, `واتساب`, `زين كاش`, `ديسباتشر`, `GPS`, `PDF`.

## 8. Key naming

`<screen>.<thing>` and `<screen>.<thing>_<qualifier>`; state machines use `order.status.<state>` and `trip.status.<state>` matching the spec state names exactly. Push pairs are `push.<event>.title` / `push.<event>.body`. WhatsApp templates are `wa.<event>`. Pricing labels `quote.<component>` with reasons `quote.reason.<component>`. Driver scorecard nudges `partner.nudge_<component>` mirror the eight index components in the scoring spec.

## 9. Example pairs

| # | Key | ar-IQ | en |
|---|---|---|---|
| 1 | `home.where_to` | وين أوصلك؟ | Where to? |
| 2 | `onboarding.send_otp` | دزلي الرمز | Send code |
| 3 | `onboarding.name_title` | شنو نسميك؟ | What should we call you? |
| 4 | `item.for_whom` | هذا الطلب لمنو؟ | Who is this for? |
| 5 | `item.points_go_to` | نقاط هذا الصنف تروح لـ {name} | Points for this item go to {name} |
| 6 | `cart.organizer_bonus` | إنت المنظّم: تكسب +10% نقاط على كل الطلب | You’re the organizer: +10% points on the whole order |
| 7 | `checkout.pickup_street_hint` | تلاقيه بنقطة قريبة وتوفّر {amount} دينار | Meet at a nearby point and save {amount} IQD |
| 8 | `quote.small_order_fee` | رسوم الطلب الصغير | Small-order fee |
| 9 | `quote.reason.rain` | الجو مطر، الدليفري يستاهل | It’s raining; the courier earns a bit more |
| 10 | `quote.quote_locked` | السعر مثبّت، ما يتغير | Price locked. It won’t change |
| 11 | `order.status.preparing` | دا يتحضّر | Being prepared |
| 12 | `order.status.delivered` | وصل طلبك، صحة وعافية | Delivered. Enjoy |
| 13 | `order.status.merchant_rejected_hint` | ما انخصم عليك شي. تحب تختار مطعم ثاني؟ | You weren’t charged. Want to pick another restaurant? |
| 14 | `trip.status.arrived_pickup` | السايق وصل، اطلع | Driver’s here. Head out |
| 15 | `trip.rebroadcast` | زدنا {amount} دينار للسايق حتى يجيك أسرع، ما يتغير سعرك | We added {amount} IQD for the driver so one comes faster. Your price doesn’t change |
| 16 | `unreachable.customer_body` | رد على الاتصال أو اطلع له. عندك {minutes} دقايق | Answer the call or step out. You have {minutes} min |
| 17 | `unreachable.driver_mark_failed` | الزبون ما رد، أنهي الطلب | No answer. End the order |
| 18 | `dispute.resolved_q` | هل انحلت مشكلتك؟ | Was your problem solved? |
| 19 | `intercity.late_meter_rider` | تأخرت: {amount} دينار كل 10 دقايق للسايق والركاب. بعد 20 دقيقة السيارة تمشي ويروح مقعدك | You’re late: {amount} IQD per 10 min to the driver and riders. After 20 min the car leaves and your seat is forfeited |
| 20 | `intercity.cancelled_low_fill` | انلغت الرحلة لقلة الركاب. نقلناك لأقرب رحلة بنفس المقعد، والفرق يرجعلك | Cancelled for low fill. We moved you to the next departure, same seat class, difference refunded |
| 21 | `khat.guardian_dropped_school` | {child} وصل {place} بالسلامة الساعة {time} | {child} arrived at {place} safely at {time} |
| 22 | `khat.substitute_intro` | اليوم السايق البديل {name} بدل {regular}. متحقق من درايفر، نفس الخط ونفس التوقيت | Today substitute driver {name} covers for {regular}. Verified by Driver, same route and times |
| 23 | `parcel.pin_recipient_body` | رمز استلام طردك من {sender}: {pin}. گوله للدليفري بس | Your PIN for the parcel from {sender}: {pin}. Tell it to the courier only |
| 24 | `errand.substitution_prompt` | {item} ماكو. أكو {alternative} بـ {amount} دينار. يصير؟ | {item} isn’t available. There’s {alternative} for {amount} IQD. OK? |
| 25 | `household.approval_request` | {name} يريد يطلب بـ {amount} دينار، أكثر من حده. توافق؟ | {name} wants to order for {amount} IQD, above their limit. Approve? |
| 26 | `safety.sos_sent` | وصلنا تنبيهك. الديسباتشر يشوف موقعك هسة ويتصل بيك | Alert received. Dispatch sees your location and is calling you |
| 27 | `partner.cap_warning` | اقتربت من سقف الكاش ({percent}%). سوّي تسوية حتى ما تتوقف الطلبات | You’re at {percent}% of your cash cap. Settle soon so offers don’t stop |
| 28 | `partner.nudge_acceptance` | قبولك هالأسبوع {value}%. من تقبل 85% وأكثر تصير أول واحد يوصله الطلب | Your acceptance this week is {value}%. At 85%+ you’re first to get offers |
| 29 | `merchant.accept_timer` | باقي {seconds} ثانية وإلا ينلغي الطلب | {seconds}s left or the order auto-rejects |
| 30 | `support.proactive_delay_credit` | نعتذر، طلبك تأخر والسبب منا. ضفنالك {amount} دينار رصيد والوقت الجديد الساعة {time} | Sorry, your order is late and it’s our fault. We added {amount} IQD credit; new time {time} |

## 10. Review checklist for new strings

- [ ] Reads aloud like something said in a Wasit shop, not a ministry letter.
- [ ] One idea; under ~12 words unless it is a WhatsApp template or a reason line.
- [ ] Money: amount, recipient, timing all present.
- [ ] Apology → next step.
- [ ] Digits 0–9, `دينار` after the number.
- [ ] Placeholders identical between `ar-IQ` and `en` (the i18n test enforces key parity; a script in review checks placeholder parity).
- [ ] Key follows `<screen>.<thing>` and the `push.*` / `wa.*` / `quote.reason.*` conventions.
