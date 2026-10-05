import type { DayShareInput, DayShareResult } from './share-types';

const W = 1080;
const H = 1080;
const PAD = 72;
const FONT = '"IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif';

/** Breaks a line at spaces so it fits `max` px (Arabic words stay whole). */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The card as a 1080×1080 PNG (a square WhatsApp shows whole), drawn right-to-left in Plex Arabic. */
export async function drawDayCard(input: DayShareInput): Promise<Blob> {
  const { card, colors } = input;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  await (document as Document & { fonts?: FontFaceSet }).fonts?.ready.catch(() => undefined);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const right = W - PAD;

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);
  // The brand's one orange mark: a bar on the start edge.
  ctx.fillStyle = colors.accent;
  roundRect(ctx, right - 64, PAD, 64, 12, 6);
  ctx.fill();

  ctx.fillStyle = colors.muted;
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(card.brand, right, PAD + 64);
  ctx.fillStyle = colors.text;
  ctx.font = `700 60px ${FONT}`;
  ctx.fillText(card.store, right, PAD + 140);
  ctx.font = `600 40px ${FONT}`;
  ctx.fillStyle = colors.muted;
  ctx.fillText(card.title, right, PAD + 200);

  // Facts: the small ones in a row of tiles, the hero (the net) big underneath.
  const small = card.facts.filter((f) => !f.hero);
  const hero = card.facts.find((f) => f.hero);
  const gap = 24;
  const tileW = (W - PAD * 2 - gap * (small.length - 1)) / Math.max(1, small.length);
  const tileY = PAD + 250;
  small.forEach((f, i) => {
    const x = right - (i + 1) * tileW - i * gap;
    ctx.fillStyle = colors.surface;
    roundRect(ctx, x, tileY, tileW, 200, 28);
    ctx.fill();
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText(f.label, x + tileW - 32, tileY + 62);
    ctx.fillStyle = f.tone === 'danger' ? colors.danger : f.tone === 'success' ? colors.success : f.tone === 'muted' ? colors.muted : colors.text;
    ctx.font = `700 ${f.value.length > 8 ? 52 : 68}px ${FONT}`;
    ctx.fillText(f.value, x + tileW - 32, tileY + 156);
  });

  let y = tileY + 200 + 90;
  if (hero) {
    ctx.fillStyle = colors.muted;
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText(hero.label, right, y);
    ctx.fillStyle = colors.text;
    ctx.font = `700 112px ${FONT}`;
    ctx.fillText(hero.value, right, y + 120);
    y += 190;
  }
  if (card.advice) {
    ctx.fillStyle = colors.text;
    ctx.font = `500 36px ${FONT}`;
    for (const line of wrap(ctx, card.advice, W - PAD * 2).slice(0, 3)) {
      ctx.fillText(line, right, y);
      y += 54;
    }
  }
  ctx.fillStyle = colors.muted;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(card.footer, right, H - PAD);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
}

/**
 * Web: Web Share with the image where the browser can (phones: straight to WhatsApp), otherwise the
 * image is downloaded to send by hand.
 */
export async function shareDay(input: DayShareInput): Promise<DayShareResult> {
  const blob = await drawDayCard(input);
  const file = new File([blob], input.fileName, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text: input.text });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = input.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
