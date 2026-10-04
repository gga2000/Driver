// The WhatsApp Business port lives in `shared/messaging/whatsapp.ts` (next to the SMS port) so the
// identity module can send OTP codes over it too ("ما وصلك؟ دزلي على واتساب") without importing notify.
export * from '../../../shared/messaging/whatsapp.js';
