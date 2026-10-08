/**
 * Calls at launch (Ali, G0-10 «Chat first»): chat and voice notes only, numbers stay hidden, and every
 * call button in the app shows greyed with «قريباً» and offers the chat instead. Flip this once masked
 * calls are carried by the platform (docs/before-launch.md, calls).
 */
export const CALLS_LIVE = false;

/**
 * خطوط guardian calls stay on (coordinator, 2026-10-07): a driver carrying children must be able to
 * reach a guardian, and khat runs have no chat. Its own switch, so it can follow the parents' WhatsApp
 * work later (docs/before-launch.md §4). Ali may overrule.
 */
export const KHAT_CALLS_LIVE = true;
