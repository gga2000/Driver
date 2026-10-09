# OTPIQ: sign-in codes by WhatsApp, then SMS

OTPIQ (otpiq.com) is an Iraqi verification service. One call sends **our own** sign-in code on
WhatsApp and, if that fails, as an SMS, so we don't run the fallback ourselves. Ali compared it with
other services on 2026-10-09 (lane D thread). Approximate prices per message, from otpiq.com on that
date:
- WhatsApp with SMS fallback: 25 دينار.
- SMS only: 100 دينار on Asiacell and Korek, 250 دينار on Zain.

Billing is a prepaid balance with no contract or monthly fee.

## How it plugs in

- `SMS_PROVIDER=otpiq` selects `OtpiqSmsProvider` (`apps/api/src/shared/messaging/sms.ts`).
- **A sign-in code** (any SMS that carries `code`) goes as `smsType: verification` with our code in
  `verificationCode`, on the channel `OTPIQ_CODE_CHANNEL` (default `whatsapp-sms`: WhatsApp first,
  SMS if WhatsApp fails). OTPIQ writes the message's wording, not our «رمز دخول درايفر» text.
- **Any other text** (the SMS twins of notifications, the gift recipient's SMS) goes as
  `smsType: custom`, SMS only. OTPIQ allows free text only with an approved sender id.
- **Retries:** errors map like the other providers.
  - A 400 (bad number, empty balance, spending cap) is permanent. A bad number also marks the
    recipient invalid.
  - 429 and 5xx are retried.
  - No key is `not_configured`, which sign-in shows as `sms_not_configured`.
- **Deadlines:** every call has the 10-second deadline from `shared/messaging/http.ts`.
- The «ما وصلك؟ دزلي على واتساب» button still uses the WhatsApp port (`WHATSAPP_PROVIDER`). With
  OTPIQ on `whatsapp-sms` the first send already tries WhatsApp.

| Variable | Where | What |
|---|---|---|
| `SMS_PROVIDER` | production host | `otpiq` |
| `OTPIQ_API_KEY` | production secret | The project's `sk_live…` key. A `sk_dev…` key only ever reaches the developer's own phone. |
| `OTPIQ_CODE_CHANNEL` | optional | `whatsapp-sms` (default), `sms`, `whatsapp`, `auto`, `telegram-sms`, `whatsapp-telegram-sms` |
| `SMS_SENDER_ID` | optional | `Driver`, once OTPIQ confirms the sender id is approved |
| `OTPIQ_BASE_URL` | tests only | defaults to `https://api.otpiq.com` |

Staging never uses OTPIQ: staging must not text real people. Sign in there with the test numbers
(`docs/api/staging-test-numbers.md`).

## Ali's steps (before launch)

1. Sign up at **app.otpiq.com** with an email, create a project and top up a small balance.
2. Ask OTPIQ support for the sender id **Driver**. It needs the company licence, plus something
   showing Driver belongs to the company (the app or the website). OTPIQ says Asiacell takes about
   1–3 days, and Korek and Zain about 1–3 weeks. Codes still arrive before that, from a plain number.
3. Copy the project's live key. **Paste it only into the production API's secrets, not into
   chat.** The command is `fly secrets set --config deploy/fly/api.toml OTPIQ_API_KEY=… SMS_PROVIDER=otpiq`,
   the same way as the other secrets in `docs/deploy/hosting.md`.
4. For a first check, a `sk_dev…` key sends every message to your own phone only, whatever number
   is typed.

Switching to another service later is one setting (`SMS_PROVIDER=http` or `twilio`), with no app
release.
