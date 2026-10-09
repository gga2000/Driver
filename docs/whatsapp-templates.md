# WhatsApp Business templates (to submit for approval)

Generated from `NOTIFY_TEMPLATES` in `packages/contracts/src/notify-io.ts` (name, Meta category,
parameter order, samples) and the `wa.*` strings in `packages/i18n/src/locales/{ar-IQ,en}.json` (text)
by `apps/api/src/modules/notify/whatsapp-templates.doc.test.ts`, which fails when this page is out of
date. To refresh it after changing a template: `UPDATE_DOCS=1 pnpm --filter @driver/api exec vitest run whatsapp-templates.doc`.
A text or parameter order that changes after approval is submitted again under a **new name** (the
order of `{{n}}` is part of the contract, voice spec §6).

How to submit (WhatsApp Manager → Message templates → Create):

- One template per name below, with **two languages**: Arabic (`ar`) and English (`en`). The API sends
  `ar` unless the person chose English.
- Body only (no header, no buttons). Paste the text exactly, including Western digits and `دينار`.
  Fill the samples with the values given (Meta needs one sample per variable).
- Category as listed. Receipts and safety are UTILITY; never mark them MARKETING (they must reach
  people who did not opt in to offers).
- `otp_login` is the sign-in code («ما وصلك؟ دزلي على واتساب», `docs/api/otp-guard.md`). It is
  AUTHENTICATION with a copy-code button: Meta writes its body, so only the name and languages matter.

Runtime (`apps/api/src/modules/notify`): `WHATSAPP_PROVIDER=meta` (or just `WHATSAPP_TOKEN` set) sends
through the Cloud API (`POST graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages`,
`type: template`, body parameters as text). Statuses (sent / delivered / read / failed) come back on
`/webhooks/whatsapp` (verify token `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, signature `WHATSAPP_APP_SECRET`);
a message not delivered 60 s after sending gets its SMS twin (domain §8).

18 templates.

| Template | Meta category | Sent as notify template (category) |
|---|---|---|
| `otp_login` | AUTHENTICATION | the sign-in code (identity, not a notify template) |
| `console_live_down_alert` | UTILITY | `console_live_down_alert` (safety) |
| `console_unwatched_alert` | UTILITY | `console_unwatched_alert` (safety) |
| `courier_arriving` | UTILITY | `courier_arriving` (order_updates) |
| `courier_arriving_paid` | UTILITY | `courier_arriving_paid` (order_updates) |
| `courier_cash_receipt` | UTILITY | `courier_cash_receipt` (money) |
| `courier_unreachable` | UTILITY | `courier_unreachable` (safety) |
| `khat_child_arrived` | UTILITY | `khat_child_arrived` (safety) |
| `khat_sweep_dispatch_alert` | UTILITY | `khat_sweep_dispatch_alert` (safety) |
| `merchant_cash_handover` | UTILITY | `merchant_cash_handover` (money) |
| `order_receipt` | UTILITY | `order_receipt` (receipts) |
| `rajaa_arrived_contact` | UTILITY | `rajaa_arrived_contact` (safety) |
| `rajaa_boarding_pass` | UTILITY | `rajaa_boarding_pass` (receipts) |
| `ride_receipt` | UTILITY | `ride_receipt` (receipts) |
| `sos_dispatch_alert` | UTILITY | `sos_dispatch_alert` (safety) |
| `sos_emergency_contact` | UTILITY | `sos_emergency_contact` (safety) |
| `trip_shared_contact` | UTILITY | `trip_shared_contact` (safety) |
| `wallet_topup_receipt` | UTILITY | `wallet_topup_receipt` (receipts) |

## Templates

### `console_live_down_alert`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.console_live_down` · notify template `console_live_down_alert`
- Body parameters, in order: `{{1}}` minutes, `{{2}}` link

Arabic (`ar`):

```text
درايفر: التحديث المباشر بالكونسول واقف من {{1}}، الشاشات تتحدث ببطء. شوف السيرفر: {{2}}
```

English (`en`):

```text
Driver: Console live updates have been down for {{1}}; screens refresh slowly. Check the server: {{2}}
```

Sample values for the submission: `{{1}}` = 1 دقيقة · `{{2}}` = https://console.driver.iq

### `console_unwatched_alert`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.console_unwatched` · notify template `console_unwatched_alert`
- Body parameters, in order: `{{1}}` minutes, `{{2}}` link

Arabic (`ar`):

```text
درايفر: من {{1}} ماكو ولا شاشة مفتوحة بالكونسول، وإنت المناوب. افتحه أو اتصل بالفريق: {{2}}
```

English (`en`):

```text
Driver: for {{1}} no Console screen has been open, and you're on call. Open it or call the team: {{2}}
```

Sample values for the submission: `{{1}}` = 5 دقيقة · `{{2}}` = https://console.driver.iq

### `courier_arriving`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.courier_arriving` · notify template `courier_arriving`
- Body parameters, in order: `{{1}}` name, `{{2}}` courier, `{{3}}` merchant, `{{4}}` amount

Arabic (`ar`):

```text
هلا {{1}}، الدليفري {{2}} يوصلك بعد دقيقتين بطلبك من {{3}}. المبلغ {{4}} دينار.
```

English (`en`):

```text
Hi {{1}}, courier {{2}} is 2 minutes away with your order from {{3}}. Amount {{4}} IQD.
```

Sample values for the submission: `{{1}}` = علي · `{{2}}` = حيدر · `{{3}}` = مطعم خالد · `{{4}}` = 12,500

### `courier_arriving_paid`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.courier_arriving_paid` · notify template `courier_arriving_paid`
- Body parameters, in order: `{{1}}` name, `{{2}}` courier, `{{3}}` merchant

Arabic (`ar`):

```text
هلا {{1}}، الدليفري {{2}} يوصلك بعد دقيقتين بطلبك من {{3}}. طلبك مدفوع.
```

English (`en`):

```text
Hi {{1}}, courier {{2}} is two minutes away with your order from {{3}}. It's already paid.
```

Sample values for the submission: `{{1}}` = علي · `{{2}}` = حيدر · `{{3}}` = مطعم خالد

### `courier_cash_receipt`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.partner_settlement_receipt` · notify template `courier_cash_receipt`
- Body parameters, in order: `{{1}}` amount, `{{2}}` date, `{{3}}` balance

Arabic (`ar`):

```text
استلمنا تسويتك {{1}} دينار بتاريخ {{2}}. رصيدك هسة {{3}} دينار.
```

English (`en`):

```text
We received your settlement of {{1}} IQD on {{2}}. Your balance is now {{3}} IQD.
```

Sample values for the submission: `{{1}}` = 60,000 · `{{2}}` = 2026-10-04 · `{{3}}` = -15,000

### `courier_unreachable`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.courier_unreachable` · notify template `courier_unreachable`
- Body parameters, in order: `{{1}}` courier

Arabic (`ar`):

```text
الدليفري {{1}} عند بابك بطلبك ويحاول يوصلك. اطلع له أو رد على رسالته خلال 5 دقايق، بعدها يرجع.
```

English (`en`):

```text
Courier {{1}} is at your door with your order and is trying to reach you. Step out or answer their message within 5 minutes, or they will leave.
```

Sample values for the submission: `{{1}}` = حيدر

### `khat_child_arrived`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.khat_dropped` · notify template `khat_child_arrived`
- Body parameters, in order: `{{1}}` child, `{{2}}` place, `{{3}}` time

Arabic (`ar`):

```text
{{1}} وصل {{2}} بالسلامة الساعة {{3}}.
```

English (`en`):

```text
{{1}} arrived at {{2}} safely at {{3}}.
```

Sample values for the submission: `{{1}}` = زينب · `{{2}}` = مدرسة الرافدين · `{{3}}` = 7:40

### `khat_sweep_dispatch_alert`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.khat_sweep_dispatch` · notify template `khat_sweep_dispatch_alert`
- Body parameters, in order: `{{1}}` name, `{{2}}` route, `{{3}}` minutes, `{{4}}` link

Arabic (`ar`):

```text
خطوط بدرايفر: {{1}} · خط {{2}}: ما تأكد إن السيارة فاضية من {{3}}. افتح الكونسول واتصل بيه: {{4}}
```

English (`en`):

```text
School run on Driver: {{1}} · run {{2}}: no empty-car check for {{3}}. Open the Console and call him: {{4}}
```

Sample values for the submission: `{{1}}` = حيدر ك. · `{{2}}` = #4821 · `{{3}}` = 5 دقايق · `{{4}}` = https://console.driver.iq/safety

### `merchant_cash_handover`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.merchant_cash_handover` · notify template `merchant_cash_handover`
- Body parameters, in order: `{{1}}` store, `{{2}}` amount, `{{3}}` courier, `{{4}}` date, `{{5}}` balance, `{{6}}` reference

Arabic (`ar`):

```text
{{1}}: استلمت {{2}} دينار كاش من الدليفري {{3}} يوم {{4}}. الباقي إلك عند درايفر {{5}} دينار. الرقم المرجعي: {{6}}
```

English (`en`):

```text
{{1}}: you received {{2}} IQD cash from courier {{3}} on {{4}}. Driver still owes you {{5}} IQD. Reference: {{6}}
```

Sample values for the submission: `{{1}}` = مطعم خالد · `{{2}}` = 45,000 · `{{3}}` = حيدر · `{{4}}` = 2026-10-04 · `{{5}}` = 0 · `{{6}}` = MH-2610-0001

### `order_receipt`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.order_delivered` · notify template `order_receipt`
- Body parameters, in order: `{{1}}` merchant, `{{2}}` amount, `{{3}}` receiptUrl

Arabic (`ar`):

```text
وصل طلبك من {{1}}. المجموع {{2}} دينار. الوصل: {{3}}
```

English (`en`):

```text
Your order from {{1}} was delivered. Total {{2}} IQD. Receipt: {{3}}
```

Sample values for the submission: `{{1}}` = مطعم خالد · `{{2}}` = 12,500 · `{{3}}` = https://driver.iq/r/ord_123

### `rajaa_arrived_contact`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.rajaa_arrived_contact` · notify template `rajaa_arrived_contact`
- Body parameters, in order: `{{1}}` name, `{{2}}` route, `{{3}}` time

Arabic (`ar`):

```text
رحلة {{1}} ({{2}}) وصلت بالسلامة الساعة {{3}}. — درايفر
```

English (`en`):

```text
{{1}}'s trip ({{2}}) arrived safely at {{3}}. — Driver
```

Sample values for the submission: `{{1}}` = زينب · `{{2}}` = بغداد ← العزيزية · `{{3}}` = 7:42 المسا

### `rajaa_boarding_pass`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.rajaa_boarding_pass` · notify template `rajaa_boarding_pass`
- Body parameters, in order: `{{1}}` route, `{{2}}` date, `{{3}}` time, `{{4}}` seat, `{{5}}` vehicle, `{{6}}` place, `{{7}}` pin

Arabic (`ar`):

```text
تذكرة الرجعة: {{1}} يوم {{2}} الساعة {{3}}، مقعد {{4}}. السيارة {{5}}. نقطة التحرك: {{6}}. رمز الصعود {{7}}، گوله للسايق بس.
```

English (`en`):

```text
Return-trip ticket: {{1}} on {{2}} at {{3}}, seat {{4}}. Car {{5}}. Departure point: {{6}}. Boarding code {{7}}; tell it to the driver only.
```

Sample values for the submission: `{{1}}` = العزيزية ← بغداد · `{{2}}` = 2026-10-05 · `{{3}}` = 7:30 · `{{4}}` = A1 · `{{5}}` = كيا بونگو · 12345 واسط · `{{6}}` = كراج البوابة 1 · `{{7}}` = 4821

### `ride_receipt`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.trip_completed` · notify template `ride_receipt`
- Body parameters, in order: `{{1}}` amount, `{{2}}` driver, `{{3}}` receiptUrl

Arabic (`ar`):

```text
وصلت بالسلامة. الأجرة {{1}} دينار مع السايق {{2}}. الوصل: {{3}}
```

English (`en`):

```text
You arrived safely. Fare {{1}} IQD with driver {{2}}. Receipt: {{3}}
```

Sample values for the submission: `{{1}}` = 4,000 · `{{2}}` = حيدر · `{{3}}` = https://driver.iq/r/ord_123

### `sos_dispatch_alert`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.sos_dispatch` · notify template `sos_dispatch_alert`
- Body parameters, in order: `{{1}}` name, `{{2}}` role, `{{3}}` what, `{{4}}` link

Arabic (`ar`):

```text
طوارئ بدرايفر: {{1}} ({{2}}) ضغط زر الطوارئ · {{3}}. افتح الكونسول واستلمه هسة: {{4}}
```

English (`en`):

```text
SOS on Driver: {{1}} ({{2}}) pressed SOS · {{3}}. Open the Console and take it now: {{4}}
```

Sample values for the submission: `{{1}}` = حيدر ك. · `{{2}}` = سايق · `{{3}}` = مشوار تكتك #1290 · `{{4}}` = https://console.driver.iq/safety/sos_123

### `sos_emergency_contact`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.sos_contact` · notify template `sos_emergency_contact`
- Body parameters, in order: `{{1}}` name, `{{2}}` link

Arabic (`ar`):

```text
تنبيه طوارئ من درايفر: وصلنا تنبيه من {{1}}. فريقنا يتابع هسة. الموقع المباشر: {{2}}
```

English (`en`):

```text
Emergency alert from Driver: {{1}} pressed SOS. Our team is following up and calling now. Live location: {{2}}
```

Sample values for the submission: `{{1}}` = علي · `{{2}}` = https://driver.iq/sos/abc.def

### `trip_shared_contact`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.trip_shared_contact` · notify template `trip_shared_contact`
- Body parameters, in order: `{{1}}` name, `{{2}}` what, `{{3}}` link

Arabic (`ar`):

```text
وصلك رابط من {{1}}: {{2}}. تابع الطريق لحد الوصول: {{3}}
```

English (`en`):

```text
{{1}} shared a trip with you: {{2}}. Follow it until arrival: {{3}}
```

Sample values for the submission: `{{1}}` = زينب · `{{2}}` = الرجعة بغداد ← العزيزية · `{{3}}` = https://driver.iq/share/shr_abc

### `wallet_topup_receipt`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.topup_receipt` · notify template `wallet_topup_receipt`
- Body parameters, in order: `{{1}}` amount, `{{2}}` date, `{{3}}` reference

Arabic (`ar`):

```text
انشحنت محفظتك بدرايفر بـ {{1}} دينار كاش يوم {{2}}. الرقم المرجعي: {{3}}. تگدر تدفع بيها طلباتك هسة.
```

English (`en`):

```text
Your Driver wallet was topped up with {{1}} IQD cash on {{2}}. Reference: {{3}}. You can pay for orders with it now.
```

Sample values for the submission: `{{1}}` = 25,000 · `{{2}}` = 2026-10-04 · `{{3}}` = TU-2610-0007
