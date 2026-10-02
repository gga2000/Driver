# Competitor Teardown: Iraqi Delivery and Ride-Hailing Apps

**Date:** 2026-10-02
**Scope:** Baly, Toters, Tabat (طبطب), Talabaty (طلباتي), plus Talabat (طلبات), Careem, inDrive, and the local Wasit app "Okay". Written for the Driver / درايفر project (hyperlocal super-app launching in Aziziyah, Wasit).
**Method:** Web search (English and Arabic) and direct fetches of app-store listings, company sites, press, investor disclosures and investigative reporting. Every fact links to the page that was actually fetched. Where sources disagree (ratings, counts), both figures are shown with their source.

---

## 0. Headline findings

1. **Nobody serves Aziziyah or Kut.** None of the national players publish Wasit coverage. Talabat's Iraq sitemap lists Erbil, Baghdad, Duhok, Sulaymaniyah, Basra, Zakho, Kirkuk, Najaf, Karbala and Mosul, with no Kut or Wasit section ([talabat.com sitemap](https://www.talabat.com/ar/iraq/sitemap)). Baly Food lists Baghdad, Karbala, Basra and Mosul only ([food.baly.iq](https://food.baly.iq/)). Lezzoo's 19 cities are all Kurdistan plus Mosul/Kirkuk/Karbala/Najaf/Khanaqin ([lezzoo.com](https://www.lezzoo.com/)). The only app found that names Aziziyah is a small local one, **Okay / أوكي**, covering Kut, Aziziyah, Al-Salam, Al-Shikri and a handful of other Wasit areas, food and grocery only, cash on delivery ([ok-iq.com](https://ok-iq.com/)).
2. **"Tabat / طبطب" could not be found as a product.** Dozens of English and Arabic queries ("طبطب توصيل", "Tabat Iraq app", "طب طب") returned only Talabat (طلبات), Talabatey (طلباتي), Tabit (an Israeli POS), Tabby, and tabata timers. The most likely explanation is that "Tabat" is a colloquial rendering of **Talabat**, which this document covers in full. If Ali means a specific local app by this name, it needs a store link to verify.
3. **Baly is the ride-hailing incumbent** (claims 80% share, profitable within year one, 10M+ downloads) and has a cheap subscription (Baly Pro, 3,000 IQD/month, free delivery from 500+ restaurants, taxi coupons) ([Dealroom](https://app.dealroom.co/news/note/baly-how-iraq-s-first-super-app-ignited-a-digital-economy), [baly.iq](https://baly.iq/), [food.baly.iq](https://food.baly.iq/)). Its weak spots are driver trust (misleading pay, unexplained bans) and ride reliability (cancellations, no plate numbers).
4. **Toters is the food/grocery leader** by web traffic (number one restaurants-and-delivery site in Iraq in Aug 2026) and has the richest feature set (scheduling, rewards, Butler errands, 15-minute dark-store grocery, VoIP) ([Similarweb](https://www.similarweb.com/top-websites/iraq/category/food-and-drink/restaurants-and-delivery/), [APKMirror](https://www.apkmirror.com/apk/toterapp-llc/toters-food-delivery-more)). Its Android rating is a weak 3.2 and reviews centre on late dispatch and cold food ([grand-screen.com](https://grand-screen.com/apps/toters-food-delivery-more/)).
5. **Restaurant commissions are ~25% and restaurants are revolting.** In April 2026 the Iraqi Restaurant Association called a boycott of delivery apps over 25% commissions and unexplained fees; owners said a 5,000 IQD shawarma is listed at 7,000 IQD on apps ([Shafaq News](https://shafaq.com/ar/مجتـمع/عمولات-مرتفعة-المطاعم-العراقية-توقف-العمل-مع-شركات-التوصيل)).
6. **Drivers are gig contractors with no insurance.** An ARIJ investigation found every company uses contractor terms, no social security, Toters pays 2,000 IQD per delivery up to 4 km with tier bonuses, and payouts are delayed 5-7 days ([ARIJ](https://en.arij.net/investigation/deadly-deliveries-in-iraq-the-hidden-face-of-delivery-companies-in-iraq/)).
7. **Cash dominates.** Iraq is "still cash-based"; ZainCash handles ~95% of mobile payments; under 20% of the population is banked ([AGBI](https://www.agbi.com/banking-finance/2026/06/zaincash-ceo-iraq-is-5-years-behind-in-digital-payments/), [Endeavor](https://endeavor.org/stories/why-we-selected-baly/)). Every competitor takes cash; Baly and Toters add an in-app wallet.
8. **Careem is legacy, inDrive is nominally present.** Careem launched Baghdad in Jan 2018 and expanded to Najaf, Erbil and Basra by 2019; no post-2021 Iraq news was found ([The National](https://www.thenationalnews.com/business/technology/careem-s-strategy-in-iraq-is-a-bit-of-tech-tutoring-and-a-lot-of-map-building-1.865027), [Iraq Business News](https://www.iraq-businessnews.com/?p=144581)). inDrive lists Iraq among its 48 countries but publishes no Iraqi city list ([inDrive help](https://indrive.com/ar-eg/help/about-indrive/where-is-indrive-available)).
9. **Nobody does خطوط (fixed-route subscription commuting) or tuktuk in-app.** Baly runs intercity taxi in 9-14 governorates, inDrive has an intercity product, OBR advertises inter-provincial travel; none offer monthly route subscriptions, seat selection, or tuktuk tiers ([baly.iq/taxi](https://baly.iq/taxi/), [inDrive Play](https://play.google.com/store/apps/details?id=sinet.startup.inDriver&hl=en_US), [OBR Play](https://play.google.com/store/apps/details?id=com.obr.passenger&hl=en_US)). Standalone tuktuk apps (Gubal, تُك تُك الكابتن) exist but are tiny ([APKCombo](https://apkcombo.com/gubal-captain-for-drivers/com.guball.captain/), [App Store](https://apps.apple.com/us/app/-/id6749203906)).
10. **Universal complaint themes:** slow or absent driver dispatch, cold/incomplete orders, unresponsive support, fee opacity, and (for drivers) opaque pay and arbitrary bans. These are the gaps a small, well-run hyperlocal operator can own.

---

## 1. Baly (بلي)

### Owner and funding
- Founded late 2021 in Baghdad by Munqith Alazzawi and Matteo Mantovani, backed by Rocket Internet; closed a $10.5M seed in January 2022 from Kingsway Capital, MSA Capital, Global Founders Capital, Vostok Ventures, Majid Al Futtaim and March Holding, "the largest seed round in the tech history of Iraq" ([Wamda](https://wamda.com/2022/01/rocket-internet-backed-iraqi-super-app-baly-raises-105-million), [Arabian Business](https://www.arabianbusiness.com/startup/three-month-old-start-up-scores-largest-funding-in-iraqs-history)).
- Endeavor's profile names German entrepreneur Martin Rohland as founder/CEO and says Baly was profitable for over a year, holds ~80% ride-hailing share, tripled the market in two years and recruits drivers at 5-10x competitor rates ([Endeavor](https://endeavor.org/stories/why-we-selected-baly/)). Dealroom repeats the 80% share and first-year profitability ([Dealroom](https://app.dealroom.co/news/note/baly-how-iraq-s-first-super-app-ignited-a-digital-economy)).
- CB Insights shows total funding of $10.5M, seed only, HQ Karada Kharij Street 42, Mercedes Building, Baghdad ([CB Insights](https://www.cbinsights.com/company/baly)). Datanyze estimates ~70 employees and $22.9M revenue ([Datanyze](https://www.datanyze.com/companies/baly/563636037)). StartupBlink lists "$77M" funding and 101-250 employees but its description is visibly mismatched, so treat it as unreliable ([StartupBlink](https://startupblink.com/top-startups/baghdad-iq)).
- App Store developer entity: BAREEQ AL-NAHRAIN FOR DELIVERY AND PASSENGER TRANSPORTATION SERVICES ([mwm.ai](https://mwm.ai/apps/baly/1590560595)).

### Cities
- App listing lists Baghdad, Basra, Karbala, Najaf, Hilla, Diyala, Kirkuk, Mosul and Nasiriyah ([mwm.ai](https://mwm.ai/apps/baly/1590560595)). Endeavor adds Erbil and Sulaymaniyah ([Endeavor](https://endeavor.org/stories/why-we-selected-baly/)).
- Taxi page: Baghdad, Basra, Karbala, Najaf, and intercity across "14 governorates" ([baly.iq/taxi](https://baly.iq/taxi/)); homepage says intercity in "9+ governorates" and "available throughout Iraq" with no Wasit or Kut named ([baly.iq](https://baly.iq/)).
- Baly Food is live only in Baghdad (13 neighbourhoods), Karbala (5 areas), Basra and Mosul; **no Kut, Wasit or Aziziyah** ([food.baly.iq](https://food.baly.iq/)).
- A 2025 Arabic roundup lists "limited coverage outside major urban areas; driver shortages" as Baly's cons ([osoustech](https://www.osoustech.com/ar/%D8%A3%D9%81%D8%B6%D9%84-%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA-%D8%AA%D9%83%D8%B3%D9%8A-%D9%81%D9%8A-%D8%A7%D9%84%D8%B9%D8%B1%D8%A7%D9%82/)).

### Verticals
- Ride-hailing tiers: Saver, Super, Plus, Airport Taxi (24/7), Intercity ([baly.iq/taxi](https://baly.iq/taxi/)). CB Insights also notes an economical bicycle/bike-taxi option ([CB Insights](https://www.cbinsights.com/company/baly)); Endeavor confirms bike taxi ([Endeavor](https://endeavor.org/stories/why-we-selected-baly/)). A "Baly Biker" app ranks in Iraq's top-10 food apps, implying a separate rider app ([Appfigures](https://app.appfigures.com/top-apps/google-play/iraq/food-and-drink)).
- Baly Food: 1,000+ restaurants, 20+ categories, "delivery within 27 minutes" claim ([baly.iq](https://baly.iq/)); food page says 20-35 min average ([food.baly.iq](https://food.baly.iq/)).
- Baly Box: door-to-door parcel delivery ([baly.iq](https://baly.iq/)).
- Baly Digital: 50+ digital goods (gift cards, game credits, top-ups) ([baly.iq](https://baly.iq/)).
- No grocery vertical found on the site; grocery was "planned" in 2022 ([Wamda](https://wamda.com/2022/01/rocket-internet-backed-iraqi-super-app-baly-raises-105-million)). No tuktuk or خطوط product.

### Pricing and fees
- Upfront fixed pricing was Baly's original differentiator ("first company in Iraq to offer upfront pricing") ([Endeavor](https://endeavor.org/stories/why-we-selected-baly/)). Site claims "cheapest taxi in Iraq" ([baly.iq/taxi](https://baly.iq/taxi/)); App Store copy claims "50% of market prices" ([App Store](https://apps.apple.com/app/id1590560595)).
- Third-party fare range: 4,000-9,000 IQD per in-city ride, "distance + service fees" ([osoustech](https://www.osoustech.com/ar/%D8%A3%D9%81%D8%B6%D9%84-%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA-%D8%AA%D9%83%D8%B3%D9%8A-%D9%81%D9%8A-%D8%A7%D9%84%D8%B9%D8%B1%D8%A7%D9%82/), [Appicial](https://www.appicial.com/blog/top-taxi-apps-in-iraq-revolutionizing-transportation.html)).
- Food delivery fee varies by distance and is shown in cart; no stated minimum order ([food.baly.iq](https://food.baly.iq/)).
- **Baly Pro:** 3,000 IQD/month, first 14 days free, free delivery from 500+ restaurants, up to 5,000 IQD/month taxi coupons ([food.baly.iq](https://food.baly.iq/)).
- Restaurant commission not published. Sector norm per restaurant association is 25% ([Shafaq](https://shafaq.com/ar/مجتـمع/عمولات-مرتفعة-المطاعم-العراقية-توقف-العمل-مع-شركات-التوصيل)).

### Payment methods
- Cash to driver, online card, Baly Wallet ([baly.iq/taxi](https://baly.iq/taxi/)). No ZainCash/Qi/FIB integration found on the site or listings.

### Driver model
- Gig: drivers bring own or family-registered car; registration free; activation within 24h; earnings "received directly after the trip"; maintenance discounts and "continuous rewards"; commission percentage not disclosed ([baly.iq/ride-with-us](https://baly.iq/ride-with-us/)).
- Driver app (بلي كابتن) rated 3.8/5 on 18K ratings. Driver complaints: pay and commission calculations described as misleading, promised earnings not matching payouts, suspensions without explanation (v2.3 added a "ban reason display") ([App Store, Baly Captain](https://apps.apple.com/app/id1605807171)).
- Baly provides SIM cards and mobile-wallet tutorials to drivers and runs in-house support ([Endeavor](https://endeavor.org/stories/why-we-selected-baly/)).

### Ratings and complaints
- Google Play: 4.4 stars, ~508K reviews, 10M+ downloads, updated 13 Sep 2026 ([Google Play](https://play.google.com/store/apps/details?id=app.baly.passenger)). App Store: 4.4 with 97K-133K ratings depending on storefront; written-review average only 2.5/5 ([App Store](https://apps.apple.com/app/id1590560595), [mwm.ai](https://mwm.ai/apps/baly/1590560595)). Site claims "4.8 stars, 470,000+ reviews, 2M+ users" ([baly.iq](https://baly.iq/)).
- Rider complaints: orders cancelled after 30+ minute waits, missing plate numbers, "20+ attempts without pickup", "poorly designed" ([App Store](https://apps.apple.com/app/id1590560595)); incomplete food orders and glitchy photo-evidence flow, inaccurate ETAs, drivers not returning change, slow support ([Google Play](https://play.google.com/store/apps/details?id=app.baly.passenger)); ad-spam notifications with no toggle, weak location search in food ([mwm.ai](https://mwm.ai/apps/baly/1590560595)).

### UX features
- Live GPS tracking, driver ratings, vehicle tier selection, in-app support chat, trip reference numbers, promo codes, wallet, Baly Pro subscription ([baly.iq/taxi](https://baly.iq/taxi/), [mwm.ai](https://mwm.ai/apps/baly/1590560595)). No scheduling, group orders, referral or loyalty points found in listings.

### Known weaknesses
- Thin coverage outside big cities; driver supply gaps; driver distrust over pay; cancellations; no scheduling; no grocery; ad spam; no Wasit presence.

---

## 2. Toters (توترز)

### Owner and funding
- Beirut-based, founded 2017 by Tamim Khalfa and Nael Halwani; in Iraq since 2019 ([Rest of World](https://restofworld.org/2022/how-to-build-a-startup-for-volatile-markets/), [Wamda](https://www.wamda.com/2022/06/lebanese-delivery-app-toters-raises-18-million-series-b-round)).
- $18M Series B (June 2022) led by IFC with March Holding and B&Y Ventures; IFC's $5M equity was earmarked "to fund the Group's expansion in Iraq" ([Wamda](https://www.wamda.com/2022/06/lebanese-delivery-app-toters-raises-18-million-series-b-round), [IFC disclosure](https://disclosures.ifc.org/project-detail/SII/45171/toters)). Total funding $24M per Forbes ([Forbes ME](https://www.forbesmiddleeast.com/lists/50-most-funded-startups-2022/toters/)).
- 500+ staff, 250+ in Iraq, 4,000+ SME partners, 500,000+ customers, 50 engineers ([IFC press release](https://www.ifc.org/ar/pressroom/2022/27070)). Baghdad office in Mansour with ~101 staff covering fleet, account management and order processing ([The Org](https://theorg.com/org/toters/offices/baghdad)).

### Cities
- "10 cities in Lebanon and Iraq" ([Forbes ME](https://www.forbesmiddleeast.com/lists/the-middle-easts-50-most-funded-startups/toters/)). Iraqi hiring is in Baghdad, Basra and Najaf governorates ([Hirebase](https://www.hirebase.org/company/toters-delivery)); the Android listing says "Lebanon, Iraq, and Kurdistan" ([APKMirror](https://www.apkmirror.com/apk/toterapp-llc/toters-food-delivery-more)). **No Wasit/Kut presence found.**
- totersapp.com was the most-visited restaurants-and-delivery site in Iraq in August 2026, ahead of talabat.com ([Similarweb](https://www.similarweb.com/top-websites/iraq/category/food-and-drink/restaurants-and-delivery/)).

### Verticals
- Food, grocery (Toters Fresh dark stores, 15-minute delivery), pharmacy, electronics, flowers, and "Butler" on-demand courier for anything that fits on a bike; also Delivery-as-a-Service for merchants ([IFC disclosure](https://disclosures.ifc.org/project-detail/SII/45171/toters), [App Store](https://apps.apple.com/app/id1015006220), [IFC press release](https://www.ifc.org/ar/pressroom/2022/27070)). No taxi.

### Pricing and fees
- Delivery fees are a top complaint: "excessively high relative to distance" and "hidden fees and pricing higher than restaurant menus" ([App Store](https://apps.apple.com/app/id1015006220), [mwm.ai](https://mwm.ai/apps/toters/1015006220)). Optional premium version removes ads ([grand-screen.com](https://grand-screen.com/apps/toters-food-delivery-more/)). Commission not published; sector norm 25% ([Shafaq](https://shafaq.com/ar/مجتـمع/عمولات-مرتفعة-المطاعم-العراقية-توقف-العمل-مع-شركات-التوصيل)).

### Payment methods
- Cash on delivery in Iraq; saved cards; a "Toters Cash" wallet with Iraq-specific terms exists ([Rest of World](https://restofworld.org/2022/how-to-build-a-startup-for-volatile-markets/), [App Store](https://apps.apple.com/app/id1015006220); the Toters Cash terms page is linked from search results but blocked to fetch).

### Driver model
- Gig contractors supplying their own vehicles, "thousands of couriers"; company says it offers workman's insurance, safety incentives and inflation-linked pay adjustments ([IFC disclosure](https://disclosures.ifc.org/project-detail/SII/45171/toters), [Rest of World](https://restofworld.org/2022/how-to-build-a-startup-for-volatile-markets/)).
- ARIJ investigation: Toters pays 2,000 IQD per delivery up to 4 km, Silver/Gold/Diamond tiers; Diamond needs 150 deliveries/week for +1,200 IQD each; payouts delayed 5-7 days; contracts waive compensation; no social security; documented rider injuries in 2024 ([ARIJ](https://en.arij.net/investigation/deadly-deliveries-in-iraq-the-hidden-face-of-delivery-companies-in-iraq/)).

### Ratings and complaints
- App Store 4.7/5 (50K-91K ratings) but written reviews average 2.4/5 ([App Store](https://apps.apple.com/app/id1015006220), [mwm.ai](https://mwm.ai/apps/toters/1015006220)). Google Play 3.2/5 on ~19K reviews, 6.6M+ downloads ([grand-screen.com](https://grand-screen.com/apps/toters-food-delivery-more/)).
- Complaints: driver "doesn't get dispatched until way later, if at all"; cold food; high delivery fees; weak product descriptions; rewards points expire unless orders are consecutive; slow restocking; support unreachable at peak; intrusive ads ([App Store](https://apps.apple.com/app/id1015006220), [grand-screen.com](https://grand-screen.com/apps/toters-food-delivery-more/)).

### UX features
- Scheduled deliveries, favourites and one-tap reorder, live tracking "from prep to delivery", rewards points, Butler errands, VoIP calling with shopper, multi-item search, OTP via SMS or WhatsApp; version 5.08 released June 2026 ([APKMirror](https://www.apkmirror.com/apk/toterapp-llc/toters-food-delivery-more), [App Store](https://apps.apple.com/app/id1015006220)).

### Known weaknesses
- Dispatch latency, fee opacity, weak Android rating, rider welfare exposure, Baghdad/Basra/Najaf-only in federal Iraq, no mobility vertical.

---

## 3. Talabat (طلبات) — likely what "Tabat / طبطب" refers to

### Owner and funding
- Kuwait-founded 2004, owned by Delivery Hero since 2015; announced Iraq entry Oct 2020, launched Erbil early 2021 ([Iraq Business News](https://www.iraq-businessnews.com/?p=165228)).

### Cities
- Erbil HQ, 146 staff in Iraq, expanded to Baghdad, Sulaimaniyah, Basra, Duhok, Zakho and Najaf ([Great Place to Work](https://greatplacetowork.me/certified-organization/talabat-iraq/)). Sitemap adds Kirkuk, Karbala, Mosul; **no Kut or Wasit** ([talabat.com sitemap](https://www.talabat.com/ar/iraq/sitemap)). 3,000+ restaurant partners in Iraq ([KRG Invest](https://invest.gov.krd/insights/success-stories/talabat/)). Preloaded on Xiaomi phones in Iraq since May 2024 ([Iraq Business News](https://www.iraq-businessnews.com/?p=219157)).

### Verticals
- Food, grocery, q-commerce; no taxi ([Iraq Business News](https://www.iraq-businessnews.com/?p=165228)).

### Pricing and fees
- Iraq FAQ: the only extra charge is the restaurant's delivery fee; cancel within 5 minutes or if delivery is 20+ minutes late ([talabat.com Iraq FAQ](https://www.talabat.com/iraq/faq?f=1)). Talabat Pro subscription exists regionally ([App Store](https://apps.apple.com/us/app/%D8%B7%D9%84%D8%A8%D8%A7%D8%AA-%D8%A7%D9%84%D8%B7%D8%B9%D8%A7%D9%85-%D9%88%D8%A7%D9%84%D8%A8%D9%82%D8%A7%D9%84%D8%A9-%D9%88%D8%BA%D9%8A%D8%B1%D9%87/id451001072?l=ar)). Regional commission 15-35% ([Menuviel](https://blog.menuviel.com/talabat-fees-and-commissions-for-restaurants/)).

### Payment methods
- Visa/Mastercard online and cash on delivery ([talabat.com Iraq FAQ](https://www.talabat.com/iraq/faq?f=1), [App Store](https://apps.apple.com/us/app/%D8%B7%D9%84%D8%A8%D8%A7%D8%AA-%D8%A7%D9%84%D8%B7%D8%B9%D8%A7%D9%85-%D9%88%D8%A7%D9%84%D8%A8%D9%82%D8%A7%D9%84%D8%A9-%D9%88%D8%BA%D9%8A%D8%B1%D9%87/id451001072?l=ar)).

### Driver model
- "Daily earning opportunities for thousands of riders" (gig) ([KRG Invest](https://invest.gov.krd/insights/success-stories/talabat/)). Talabat did not respond to ARIJ's questions ([ARIJ](https://en.arij.net/investigation/deadly-deliveries-in-iraq-the-hidden-face-of-delivery-companies-in-iraq/)).

### Ratings and complaints
- App Store 4.5/5 on 353K ratings (all markets); Google Play 3.6/5 on 485K reviews, 10M installs ([App Store](https://apps.apple.com/us/app/%D8%B7%D9%84%D8%A8%D8%A7%D8%AA-%D8%A7%D9%84%D8%B7%D8%B9%D8%A7%D9%85-%D9%88%D8%A7%D9%84%D8%A8%D9%82%D8%A7%D9%84%D8%A9-%D9%88%D8%BA%D9%8A%D8%B1%D9%87/id451001072?l=ar), [AppPricingLab](https://apppricinglab.com/app/google_play/com.talabat)). Complaints: late deliveries, unresolved credit errors, slow support, no ingredient info.

### UX features
- Live tracking with push, scheduled ordering, saved addresses/cards, smart filters, Talabat Pro ([App Store](https://apps.apple.com/us/app/%D8%B7%D9%84%D8%A8%D8%A7%D8%AA-%D8%A7%D9%84%D8%B7%D8%B9%D8%A7%D9%85-%D9%88%D8%A7%D9%84%D8%A8%D9%82%D8%A7%D9%84%D8%A9-%D9%88%D8%BA%D9%8A%D8%B1%D9%87/id451001072?l=ar)).

### Known weaknesses
- Kurdistan-centred, no mobility, generic regional app with little Iraqi localisation, no Wasit.

---

## 4. Talabatey (طلباتي)

### Owner and funding
- Baghdad-based, founded July 2016, developer SMART DELIVERY GENERAL TRADING; CEO Omar Al-Banna, COO Uday Adel; ~204 employees per Caplight ([mwm.ai](https://mwm.ai/apps/talabatey/1125131115), [Caplight](https://www.caplight.com/company/talabatey)). Says it is bootstrapped and profitable, 20% net margin and 200% YoY order growth in Q1 2022, 500+ non-driver staff, 30+ hubs ([IraqTech](https://iraqtech.io/talabatey-an-iraqi-success-story/)).
- Do not confuse with طلباتي بلس (UNIQUE APPS, Saudi market) ([mwm.ai](https://mwm.ai/apps/tlbty-bls/1596505868)).

### Cities
- Claims all 18 governorates plus 10+ districts and sub-districts ([IraqTech](https://iraqtech.io/talabatey-an-iraqi-success-story/)). Also Sudan, Syria and Kenya ([Google Play](https://play.google.com/store/apps/details?id=com.talabatey&hl=en_US)). No Wasit/Kut listing could be verified; coverage in small districts is unproven.

### Verticals
- Food (5,000+ restaurants), a recently added supermarket section, marketplaces, cloud kitchens, B2B transport ([Google Play](https://play.google.com/store/apps/details?id=com.talabatey&hl=en_US), [App Store](https://apps.apple.com/app/id1125131115), [IraqTech](https://iraqtech.io/talabatey-an-iraqi-success-story/)). No taxi.

### Pricing and fees
- Shows meal cost plus delivery cost per order; users complain of "high service fees combined with delivery charges" ([mwm.ai](https://mwm.ai/apps/talabatey/1125131115)). Commission not disclosed.

### Payment methods
- Wallet and card e-payment added; cash implied; billing disputes and double charges are a recurring complaint ([App Store](https://apps.apple.com/us/app/talabatey-%D8%B7%D9%84%D8%A8%D8%A7%D8%AA%D9%8A/id1125131115), [mwm.ai](https://mwm.ai/apps/talabatey/1125131115)).

### Driver model
- Hub-based driver network ("30+ headquarters") ([IraqTech](https://iraqtech.io/talabatey-an-iraqi-success-story/)). Two rider deaths in 2022 attributed to "Talabati" in ARIJ's investigation, with families paid ~200,000 IQD ([ARIJ](https://en.arij.net/investigation/deadly-deliveries-in-iraq-the-hidden-face-of-delivery-companies-in-iraq/)).

### Ratings and complaints
- Google Play 4.5/5, 105K reviews, 5M+ downloads, updated June 2026 ([Google Play](https://play.google.com/store/apps/details?id=com.talabatey&hl=en_US)). App Store 4.3/5 on 42K-57K ratings; written reviews 2.9/5 ([App Store](https://apps.apple.com/app/id1125131115), [mwm.ai](https://mwm.ai/apps/talabatey/1125131115)).
- Complaints: app calls customers "repeatedly" from multiple numbers; must reselect location every launch; 2+ hour deliveries; status not updated; all restaurants rated "very good"; drivers asking for tips; promo credits lost; double charging ([Google Play](https://play.google.com/store/apps/details?id=com.talabatey&hl=en_US), [App Store](https://apps.apple.com/app/id1125131115)).

### UX features
- Location-based browsing, open/closed status, trending meals, offers; no verified live map tracking, scheduling, group order, loyalty or referral ([App Store](https://apps.apple.com/us/app/talabatey-%D8%B7%D9%84%D8%A8%D8%A7%D8%AA%D9%8A/id1125131115)).

### Known weaknesses
- Phone-call-heavy ops, weak tracking, dated UX, fee opacity, rider safety record, unverified rural coverage.

---

## 5. Short notes: Careem, inDrive, and other relevant players

**Careem (Uber-owned).** Launched Baghdad Jan 2018, then Najaf, Erbil and Basra (June 2019); mapped 15,000 locations by hand, took phone bookings during internet outages, captains earned 30-50% more than as street taxis ([MENAbytes](https://www.menabytes.com/careem-iraq/), [Iraq Business News](https://www.iraq-businessnews.com/?p=144581), [The National](https://www.thenationalnews.com/business/technology/careem-s-strategy-in-iraq-is-a-bit-of-tech-tutoring-and-a-lot-of-map-building-1.865027)). Third-party fare range 4,500-10,000 IQD ([osoustech](https://www.osoustech.com/ar/%D8%A3%D9%81%D8%B6%D9%84-%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%D8%A7%D8%AA-%D8%AA%D9%83%D8%B3%D9%8A-%D9%81%D9%8A-%D8%A7%D9%84%D8%B9%D8%B1%D8%A7%D9%82/)). No Careem Iraq news after 2021 was found and Careem's 2023 Qatar exit note does not mention Iraq ([AGBI](https://www.agbi.com/article/careem-to-cease-ride-hailing-operations-in-qatar/)); treat Careem as a dormant/legacy competitor with no Wasit presence.

**inDrive.** Lists Iraq among its 48 countries ([inDrive help](https://indrive.com/ar-eg/help/about-indrive/where-is-indrive-available)). Model: passenger proposes a fare, drivers accept or counter, payment is direct to driver in cash or digital, commission 10-12.99%; products are City, Intercity, Courier (up to 20 kg) and Freight ([Google Play](https://play.google.com/store/apps/details?id=sinet.startup.inDriver&hl=en_US), [Wikipedia](https://en.wikipedia.org/wiki/InDrive)). No Iraqi city list or local news found; unofficial "inDrive Iraq" Facebook pages exist but could not be fetched. Its fare-negotiation model is culturally close to how Iraqis already haggle with street taxis and is worth studying for Driver's intercity product.

**Okay / أوكي (Wasit local).** The only app found that explicitly serves Aziziyah: Kut hub plus Aziziyah, Al-Salam, Al-Shikri, Al-Bawaba, Kut College, Nahr Uwaid, Khamas; restaurants, grocery, fresh produce, bakeries, sweets; delivery fee by area shown before confirm; cash on delivery plus in-app wallet; commission-based motorbike/car contractors; 11+ listed merchants ([ok-iq.com](https://ok-iq.com/)). Store links exist on Google Play and the App Store (ratings could not be fetched). This is Driver's direct hyperlocal rival for food.

**Other regional players for context.** OBR Taxi: 4.7/5 on 12.6K Play reviews, scheduling, family route-sharing, ride health insurance, 2,500 IQD cancellation fee, phone booking via 6188, 8 cities, none in Wasit ([Google Play](https://play.google.com/store/apps/details?id=com.obr.passenger&hl=en_US)). Amin: 4.6/5, Baghdad/Najaf/Babylon/Karbala, taxi plus food, cash or wallet ([Google Play](https://play.google.com/store/apps/details?id=iq.com.amin.karbala.client&hl=en_US)). Lezzoo (Kurdistan super-app, YC W19): 19 cities, 3,000+ riders, Lezzoo Pay wallet, $200M+ GMV ([lezzoo.com](https://www.lezzoo.com/)). Alsaree3 (Baghdad/Basra): 37-minute delivery claim, dark stores, Al Zajel parcels partnered with ZainCash ([Wamda](https://www.wamda.com/2022/01/alsaree3-group-raises-3-2-million-bridge-round)). 3talab (Hilla): 4,037 active drivers, 6,289 stores, 1.5M deliveries, a proof that a single-city app can reach scale ([3talab.com](https://3talab.com/)). Ajik (Samawah): small local taxi app with intercity, cash on arrival ([mwm.ai](https://mwm.ai/apps/jyk-tksy/6737718859)).

---

## 6. Market context that shapes the opportunity

- Iraq is "still cash-based"; ZainCash handles ~95% of mobile payments with 10,000 cash agents; digital payments were projected to pass $26B in 2023 and grow 24%/yr ([AGBI](https://www.agbi.com/banking-finance/2026/06/zaincash-ceo-iraq-is-5-years-behind-in-digital-payments/)). Under 20% of Iraqis have bank accounts; 80% internet penetration; 50% under 25 ([Endeavor](https://endeavor.org/stories/why-we-selected-baly/)). Miswag reported only 2% of e-commerce transactions paid online ([IraqTech](https://iraqtech.io/an-overview-of-fintech-in-iraq/)).
- Restaurants: 25% commission is the contract norm; the Restaurant Association's April 2026 boycott shows merchant appetite for a lower-take platform ([Shafaq](https://shafaq.com/ar/مجتـمع/عمولات-مرتفعة-المطاعم-العراقية-توقف-العمل-مع-شركات-التوصيل)).
- Drivers: no company offers insurance or social security; the sector runs on 1973 postal law; a Delivery Workers' Union formed in 2024 with ~500 members ([ARIJ](https://en.arij.net/investigation/deadly-deliveries-in-iraq-the-hidden-face-of-delivery-companies-in-iraq/)).
- Aziziyah: district centre in Wasit, ~45,000 people (2009 estimate), ~80 km northwest of Kut on the Tigris, on the Baghdad road ([Wikipedia](https://en.wikipedia.org/wiki/Al-Aziziyah_(Iraq))). Small enough that the big players ignore it; large enough that a local app already exists.

---

## 7. What Driver must beat

| Gap in incumbents | Evidence | Driver opportunity in Aziziyah |
|---|---|---|
| **No national app covers Aziziyah/Kut** | Talabat sitemap, Baly Food city list, Lezzoo city list all omit Wasit ([talabat](https://www.talabat.com/ar/iraq/sitemap), [Baly](https://food.baly.iq/), [Lezzoo](https://www.lezzoo.com/)) | Be first with full-stack (food + grocery + taxi + tuktuk + خطوط). Only Okay competes, and only in food/grocery ([ok-iq.com](https://ok-iq.com/)). |
| **Dispatch latency / unassigned orders** | Toters "driver doesn't get dispatched until way later"; Baly "20+ attempts without pickup" ([Toters](https://apps.apple.com/app/id1015006220), [Baly](https://apps.apple.com/app/id1590560595)) | In a town this size, show real driver supply before order confirmation, auto-assign within seconds, and surface "no driver available" honestly instead of silently cancelling. |
| **Cold / incomplete food** | Toters and Talabatey reviews ([Toters](https://apps.apple.com/app/id1015006220), [Talabatey](https://play.google.com/store/apps/details?id=com.talabatey&hl=en_US)) | Short distances are an advantage: publish per-order prep-to-door timer, photo-at-pickup checklist, insulated bags as a driver standard. |
| **Fee opacity and surprise charges** | Restaurants report +1,000 IQD unexplained fees; Toters "hidden fees"; Talabatey "high service fees" ([Shafaq](https://shafaq.com/ar/مجتـمع/عمولات-مرتفعة-المطاعم-العراقية-توقف-العمل-مع-شركات-التوصيل), [mwm.ai Toters](https://mwm.ai/apps/toters/1015006220), [mwm.ai Talabatey](https://mwm.ai/apps/talabatey/1125131115)) | One flat, zone-based delivery fee shown on the restaurant card before the cart; no service fee at launch; menu prices identical to in-store (enforced in merchant contract). |
| **25% restaurant commission; merchant revolt** | April 2026 boycott ([Shafaq](https://shafaq.com/ar/مجتـمع/عمولات-مرتفعة-المطاعم-العراقية-توقف-العمل-مع-شركات-التوصيل)) | Launch at a materially lower take (e.g. 10-15%) or a flat monthly merchant fee; make "same price as the shop" a public promise. |
| **Driver pay opacity, arbitrary bans, 5-7 day payout delays, no insurance** | Baly Captain reviews; ARIJ on Toters/Talabatey ([Baly Captain](https://apps.apple.com/app/id1605807171), [ARIJ](https://en.arij.net/investigation/deadly-deliveries-in-iraq-the-hidden-face-of-delivery-companies-in-iraq/)) | Per-trip earnings breakdown on screen, same-day cash settlement, written ban reasons with appeal, group accident cover. Ali already has driver liquidity; retention comes from trust. |
| **No scheduling in Baly/Talabatey; Toters/OBR have it** | Baly and Talabatey listings lack it; Toters and OBR advertise it ([Baly](https://baly.iq/taxi/), [Talabatey](https://apps.apple.com/us/app/talabatey-%D8%B7%D9%84%D8%A8%D8%A7%D8%AA%D9%8A/id1125131115), [Toters](https://www.apkmirror.com/apk/toterapp-llc/toters-food-delivery-more), [OBR](https://play.google.com/store/apps/details?id=com.obr.passenger&hl=en_US)) | Scheduling is table stakes for intercity and خطوط; ship it for rides and food from day one. |
| **No خطوط / subscription commuting anywhere** | No competitor product found; Baly/inDrive/OBR do one-off intercity only ([Baly](https://baly.iq/taxi/), [inDrive](https://play.google.com/store/apps/details?id=sinet.startup.inDriver&hl=en_US), [OBR](https://play.google.com/store/apps/details?id=com.obr.passenger&hl=en_US)) | Monthly route passes, seat/front-seat upgrade, substitute-driver with parent tracking, rider transfer between Baghdad-bound cars: a category nobody owns. |
| **No tuktuk tier in any super-app** | Only tiny standalone apps ([Gubal](https://apkcombo.com/gubal-captain-for-drivers/com.guball.captain/), [تُك تُك الكابتن](https://apps.apple.com/us/app/-/id6749203906)) | Tuktuk as a first-class ride tier with its own pricing; also use tuktuks for grocery runs. |
| **Must-reselect-location, phone-call-driven ops** | Talabatey reviews ([Google Play](https://play.google.com/store/apps/details?id=com.talabatey&hl=en_US)) | Persist home/work addresses, in-app chat first, calls only as fallback. |
| **Ad-spam notifications, no toggle** | Baly reviews ([mwm.ai](https://mwm.ai/apps/baly/1590560595)) | Notification preferences on first run; transactional-only by default. |
| **Loyalty exists but is weak (Toters points expire)** | Toters reviews ([App Store](https://apps.apple.com/app/id1015006220)) | Simple cashback-to-wallet that never expires; referral credit for both sides; Baly Pro's 3,000 IQD price point is the benchmark for any subscription ([food.baly.iq](https://food.baly.iq/)). |
| **Cash-first reality** | ~95% of mobile payments via ZainCash; under 20% banked ([AGBI](https://www.agbi.com/banking-finance/2026/06/zaincash-ceo-iraq-is-5-years-behind-in-digital-payments/), [Endeavor](https://endeavor.org/stories/why-we-selected-baly/)) | Cash on delivery and cash-to-driver by default; wallet top-up via ZainCash agents (and later Qi/FIB); exact-change prompt to fix the "driver didn't return change" complaint seen on Baly. |
| **Phone/offline booking during internet cuts** | Careem took phone bookings; OBR has a 6188 short code ([The National](https://www.thenationalnews.com/business/technology/careem-s-strategy-in-iraq-is-a-bit-of-tech-tutoring-and-a-lot-of-map-building-1.865027), [OBR](https://play.google.com/store/apps/details?id=com.obr.passenger&hl=en_US)) | A WhatsApp/phone fallback line is cheap and matters in a small town. |
| **Safety basics missing** | Baly riders complain of no plate numbers ([App Store](https://apps.apple.com/app/id1590560595)); OBR offers ride insurance and route sharing ([OBR](https://play.google.com/store/apps/details?id=com.obr.passenger&hl=en_US)) | Always show plate, driver photo, share-trip link; parent tracking for خطوط. |

### Suggested launch wedge (from the evidence above)
1. **Food first in Aziziyah** with flat zone fees, menu-price parity, and sub-30-minute promise, directly against Okay.
2. **Taxi + tuktuk the same quarter**, cash-first, scheduled rides, plate/photo/share-trip from day one.
3. **خطوط and Baghdad/Kut intercity** as the differentiator no incumbent has, with monthly passes and seat upgrades.
4. **Driver trust as the moat**: transparent pay, same-day settlement, written bans, accident cover.
5. **Grocery/greens** once tuktuk supply is stable; avoid dark stores until volume justifies it.

---

## 8. Open questions and caveats
- "Tabat / طبطب" remains unidentified; confirm whether Ali means Talabat (طلبات) or a specific local app and share a store link.
- Okay's ratings, order volumes and driver count are unknown (store pages could not be fetched); worth installing and test-ordering.
- Baly's current city list for taxi beyond the four named cities, and whether its intercity product touches Kut, should be checked in-app from an Aziziyah location.
- No competitor publishes exact commission or driver take-rates; the 25% figure comes from the restaurant association, not the apps.
- inDrive's Iraqi footprint is unverified beyond its country list.
