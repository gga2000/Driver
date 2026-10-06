/** What the end-of-day share needs: the server's WhatsApp text and the card as drawn on screen. */
export interface DayShareInput {
  /** `share_ar` from the server (Iraqi plurals, Western digits). */
  text: string;
  card: {
    brand: string;
    store: string;
    title: string;
    facts: Array<{ label: string; value: string; hero?: boolean; tone: 'text' | 'danger' | 'success' | 'muted' }>;
    advice: string | null;
    footer: string;
  };
  /** Theme colours (from design tokens) so the image matches the app. */
  colors: { bg: string; surface: string; text: string; muted: string; border: string; accent: string; success: string; danger: string };
  fileName: string;
}

export type DayShareResult = 'shared' | 'saved' | 'cancelled';
