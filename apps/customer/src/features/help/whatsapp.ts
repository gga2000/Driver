/**
 * The support line on WhatsApp (audit C-13): a wa.me link with the message already typed, so a
 * customer who writes about an order starts with its number ("عندي مشكلة بطلب #1284").
 */
export function whatsappUrl(phone: string, text: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** "+964 780 000 0000" style for showing the number when WhatsApp can't open. */
export function displayPhone(phone: string): string {
  const d = phone.replace(/[^\d]/g, '');
  if (d.startsWith('964') && d.length === 13) return `0${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  return phone;
}
