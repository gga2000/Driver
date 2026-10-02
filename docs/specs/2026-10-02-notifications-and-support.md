# Driver (درايفر) — Notifications & Support Spec

Date: 2026-10-02 · Status: approved — Plan 5 complete.

## 1. Notification channels
Policy and per-event table: see `2026-10-02-domain-and-events.md` §8 (push first; WhatsApp for money and safety; SMS for OTP and fallback; quiet hours 23:00–07:00 except active trips; deep links; merchant Bluetooth printing).

## 2. Support model
Hours 10:00–24:00 matching dispatch; outside hours auto-reply with the morning time; SOS always escalates. Channels: in-app chat inside the order screen, WhatsApp Business in the same Console inbox, outbound masked calls only. First-response targets: 2 min during active trips, 15 min otherwise, shown to the customer. Canned Iraqi-Arabic responses for the top 20 situations, each with its one-tap action (refund, reassign, credit, call driver). Escalation to Ali: money over 25,000, safety, bans, merchant disputes. Self-serve first: live map, cancel, report-a-problem/dispute flow in the order screen. Every resolved ticket asks one tap "هل انحلت مشكلتك؟"; agent metrics feed the staff scorecard.

## 3. State-of-the-art layer
AI first line: an agent in the chat reads order, timeline and the default-outcome table, resolves common cases in Iraqi Arabic (voice-note input supported), and hands off to a human with a written summary when money exceeds its limit, safety is involved, or sentiment is hostile. Proactive support: delay > 10 min past promise triggers an apology with new ETA and, when the fault is ours, automatic credit; substitution and unreachable protocols message before the customer asks. One case screen for agents: order, trip map, participants, ledger lines, all-channel messages, scores, suggested resolution pre-selected. Queue ranked by urgency (active trip, money, tone). Merchant and driver support in the same desk with their own actions (reassign, release payment, fix menu).
