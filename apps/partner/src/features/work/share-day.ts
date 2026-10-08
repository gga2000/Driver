/**
 * "شارك يومك" on the web (audit S-4): the day drawn on a canvas — the brand mark, the net, per hour
 * and the stats — then the browser's share sheet with the picture when it can share files (Android
 * Chrome: WhatsApp is right there), else the PNG is downloaded to send by hand. Native:
 * `share-day.native.ts` (the same card captured from a view, then the platform share sheet).
 */
import type { RefObject } from 'react';
import { fontFamily, themes } from '@driver/design-tokens';
import type { ShareCardModel } from './shift-logic';

export type ShareResult = 'shared' | 'saved' | 'cancelled' | 'failed';

const W = 1080;
const H = 1350;
const C = themes.light;
const FONT = `"${fontFamily.display[0]}", ${fontFamily.display.slice(1).join(', ')}`;

type Ctx = CanvasRenderingContext2D & { direction?: CanvasDirection };

function font(ctx: Ctx, weight: number, size: number) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

/** Text right-aligned at `x` (RTL), returning its width. */
function rtl(ctx: Ctx, text: string, x: number, y: number, opts: { weight: number; size: number; color: string; align?: CanvasTextAlign }) {
  font(ctx, opts.weight, opts.size);
  ctx.fillStyle = opts.color;
  ctx.textAlign = opts.align ?? 'right';
  ctx.fillText(text, x, y);
  return ctx.measureText(text).width;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Draws the card (1080×1350, the WhatsApp/Instagram 4:5) on a 2D context. */
export function drawShareCard(ctx: Ctx, m: ShareCardModel, brand: { name: string; badge: string }): void {
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const pad = 88;
  const right = W - pad;

  // Brand mark: the wordmark in accent with its dot, and the Partner tag in ink.
  const markW = rtl(ctx, brand.name, right, 170, { weight: 700, size: 88, color: C.accentText });
  ctx.beginPath();
  ctx.arc(right - markW - 18, 150, 10, 0, Math.PI * 2);
  ctx.fillStyle = C.accent;
  ctx.fill();
  font(ctx, 700, 40);
  const badgeW = ctx.measureText(brand.badge).width + 48;
  const badgeX = right - markW - 52 - badgeW;
  roundRect(ctx, badgeX, 112, badgeW, 64, 32, C.text);
  rtl(ctx, brand.badge, badgeX + badgeW / 2, 157, { weight: 700, size: 40, color: C.surface, align: 'center' });

  // Title and when.
  rtl(ctx, m.title, right, 330, { weight: 700, size: 64, color: C.text });
  rtl(ctx, m.date, right, 398, { weight: 500, size: 36, color: C.textMuted });

  // The one big number.
  roundRect(ctx, pad, 470, W - pad * 2, 420, 48, C.surface);
  const numW = rtl(ctx, m.net, right - 56, 700, { weight: 700, size: 180, color: C.text });
  rtl(ctx, m.currency, right - 56 - numW - 28, 700, { weight: 600, size: 60, color: C.textMuted });
  if (m.perHour) {
    font(ctx, 600, 44);
    const pillW = ctx.measureText(m.perHour).width + 72;
    roundRect(ctx, right - 56 - pillW, 760, pillW, 84, 42, C.accentTint);
    rtl(ctx, m.perHour, right - 56 - 36, 816, { weight: 600, size: 44, color: C.accentText });
  }

  // Stats in columns, start side first.
  const cols = m.stats.slice(0, 3);
  const colW = (W - pad * 2) / Math.max(1, cols.length);
  cols.forEach((s, i) => {
    const x = right - i * colW;
    rtl(ctx, s.label, x, 1000, { weight: 500, size: 34, color: C.textMuted });
    rtl(ctx, s.value, x, 1066, { weight: 700, size: 46, color: C.text });
  });

  // «يومك» (e7): the word customers said most, in a soft green pill.
  if (m.quote) {
    font(ctx, 600, 40);
    const qW = Math.min(W - pad * 2, ctx.measureText(m.quote).width + 80);
    roundRect(ctx, right - qW, 1096, qW, 72, 36, C.successTint);
    rtl(ctx, m.quote, right - 40, 1145, { weight: 600, size: 40, color: C.successText });
  }

  // Footer: an accent rule and the tag.
  ctx.fillStyle = C.accent;
  ctx.fillRect(pad, 1200, W - pad * 2, 6);
  rtl(ctx, m.tag, right, 1275, { weight: 500, size: 34, color: C.textMuted });
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Renders the card to a PNG blob (null when the browser has no canvas). */
export async function renderShareCard(m: ShareCardModel, brand: { name: string; badge: string }): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d') as Ctx | null;
  if (!ctx) return null;
  // The app's fonts are bundled and aliased at start; wait for them so Arabic never draws in a fallback.
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  await Promise.all([500, 600, 700].map((w) => fonts?.load(`${w} 40px "${fontFamily.display[0]}"`, 'ع').catch(() => undefined)));
  drawShareCard(ctx, m, brand);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

export async function shareDay(input: { model: ShareCardModel; fileName: string; brand: { name: string; badge: string }; view?: RefObject<unknown> }): Promise<ShareResult> {
  try {
    const blob = await renderShareCard(input.model, input.brand);
    if (!blob) return 'failed';
    const file = typeof File !== 'undefined' ? new File([blob], input.fileName, { type: 'image/png' }) : null;
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { canShare?: (d: ShareData) => boolean }) : null;
    if (file && nav?.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: input.model.title });
        return 'shared';
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return 'cancelled';
      }
    }
    download(blob, input.fileName);
    return 'saved';
  } catch {
    return 'failed';
  }
}
