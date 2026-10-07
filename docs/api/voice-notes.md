# Voice notes in the chat — ride ideas n7/n8 (2026-10-07)

Ali voted yes: «hold to record, release to send, slide to cancel; gone with the chat when it closes».
A voice note is one more message kind of the order chat (`packages/contracts/src/chat-io.ts`), so it
reuses the chat's parties, open/closed rules, send limit, read receipts, live stream and push.

## Where

| Thread kind | Voice notes |
|---|---|
| `customer_courier` (customer ↔ courier / driver, rides and deliveries) | yes |
| `customer_support` (customer ↔ our desk, «احجي ويا الدعم») | yes, the customer sends; the desk listens in the Console |
| `merchant_courier`, `customer_merchant` (the kitchen) | no — `chat_voice_unavailable` (the merchant app has no player) |

`VOICE_THREAD_KINDS` / `voiceAllowedIn(kind)` say so in one place; the apps show the mic only there.

## Rules (`VOICE_RULES`)

| Rule | Value |
|---|---|
| Length | 1–60 s (`maxSec`); the app stops by itself at 60 s and sends. Under 0.6 s is a tap: nothing is sent, «اضغط مطوّل على المايك وسجّل…» |
| Size | ≤ 1,000,000 bytes (`maxBytes`); the apps record mono AAC / Opus at 48 kb/s (≈ 360 KB a minute) |
| Types | `audio/mp4` (m4a: iOS, Android, Safari), `audio/aac` (ADTS), `audio/webm` (Chrome), `audio/ogg` (Firefox) — the server checks the first bytes against the declared type (`sniffAudio`, next to `sniffImage`) |
| Retention | the file goes with the chat: once the thread is **closed** (30 min after the order or ride; the support chat 24 h after) the voice retention job deletes it and the message keeps only its length. `audioUrl` is then `null` and the bubble says «الرسالة الصوتية راحت ويا المحادثة» |

## Procedures

### `chat.voiceUpload` (mutation)
`{ orderId, kind, contentType: VoiceContentType, sizeBytes ≤ 1,000,000 }` → the same signed ticket as
`places.photoUpload` (`{ uploadId, uploadUrl, method: 'PUT', headers, expiresAt, maxBytes }`). Only for
someone who may write in that thread **now**: a party (or support) of an open thread (`chat_not_party`,
`chat_not_open`, `chat_closed`, `chat_voice_unavailable`). PUT the recording to `uploadUrl` with the
ticket's headers within 15 minutes.

### `chat.send` with a voice note
`{ orderId, kind, clientId, voiceUploadId, durationSec }` — exactly one body as before (text, quick reply,
photo, location, or voice); `durationSec` (1–60, the recorder's length rounded up) goes with
`voiceUploadId` and only with it. The upload must be the sender's own, finished, and a voice note
(`upload_invalid` otherwise — a photo upload is never a voice note and a voice upload never a photo,
anywhere in the API).

### What readers get
`ChatMessage` gains `audioUrl` (signed, short-lived `/files/<id>?exp&sig`; `null` on other kinds and once
the file is gone) and `durationSec` (`null` on other kinds). `kind: 'voice'`, `text: null`.
The push reads «رسالة جديدة من السايق» / «… من الزبون» with the body «دزلك رسالة صوتية»
(`push.chat_message.voice`, `chatPushBody`).

### Files
`GET /files/:id` now answers byte ranges (`Range: bytes=a-b`, `a-`, `-n` → 206 with `content-range`;
outside the file → 416) and says `accept-ranges: bytes`: iPhones refuse to play audio from a server
that ignores ranges. With object storage the 302 goes to a presigned GET, which does ranges itself.

## Storage
- `chat_messages.voice_ref` (the upload id; set back to `NULL` when the file is deleted) and
  `chat_messages.duration_sec` (1–60, checked), migration `20261008013000_chat_voice_notes`.
- The bytes are an `uploads` row of type `audio/*` (the photo pipeline: dev storage or S3).
- `VoiceNoteRetention` (retention module) runs every 5 minutes: `ChatService.purgeClosedVoice` walks the
  threads that still hold voice files, 100 at a time, and deletes the files of every thread that is
  closed now (an unreadable order is skipped, never purged on a guess).

## Apps
- Shared UI (`packages/ui`): `ChatThread` takes a `voice` prop (`ChatVoice`: recorder, one player,
  upload). With the text field empty the send key becomes the mic (`MicHoldButton`). Hold: a light
  haptic, the field turns into the recorder bar (a softly pulsing red dot, the seconds, «‹ اسحب
  للإلغاء» following the finger); release sends; sliding towards the start side (right in Arabic) past
  96 px cancels with a light haptic. A screen reader's double tap records without holding (the bar gets
  delete and send keys). Bubbles: a 44 px play / pause key, a thin progress line, the seconds; one note
  plays at a time. A note on its way shows as a pending bubble; a failed upload or send turns red and
  a tap retries (uploading again if needed).
- Microphone permission at the first hold: «نحتاج المايك — حتى تسجّل رسالة صوتية. المايك يشتغل بس
  وانت ضاغط عليه» before the OS prompt; refused → «المايك مسدود» with «افتح الإعدادات» (phones) or
  «جرّب مرة ثانية» (browser).
- Customer (`apps/customer/src/features/chat/useChatVoice.ts`) and Partner (`apps/partner/…`): expo-audio
  recorder and player (MediaRecorder in the browser through expo-audio's web build; `mic.ts` /
  `mic.native.ts` for the permission and the file type). The recording audio mode is on only while
  recording. `app.json` now declares the microphone (iOS text, Android `RECORD_AUDIO`), so phones need a
  new development build.
- Console: voice notes in the support case, the order's chat tab and the chat case play in the
  browser's own player (`components/support/voice-note.tsx`).

## Demo
- Customer demo API: `scenario=ride` includes a 4-second voice note from the driver; a voice note the
  customer sends to his courier / driver is answered by one 2.5 s later.
- Partner demo API: `/demo/chat` includes a voice note from the customer.
- The clip is `scripts/dev/demo-voice-note.m4a` (3.2 s, a soft hum made with ffmpeg).
