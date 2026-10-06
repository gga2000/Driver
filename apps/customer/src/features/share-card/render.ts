/**
 * The share card on the web (joy l5): the preview's own drawing (its SVG, serialized) and the lines
 * drawn on a 1080×1920 canvas with the app's loaded fonts, then the browser's share sheet with the
 * picture (WhatsApp / Instagram from Android Chrome) or a download. Native: `render.native.ts`
 * (the view captured with react-native-view-shot).
 */
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { fontFamily } from '@driver/design-tokens';
import { SKETCH } from '@driver/ui';
import { shareBlob, type ShareResult } from '@/lib/share-file';
import { CARD } from './layout';

export interface CardText {
  head: string;
  sub: string | null;
  brand: string;
  accent: string;
  /** Where the drawing sits on the artboard: a square dish or a 16:10 scene. */
  art: 'dish' | 'scene';
}

const cssStack = (stack: readonly string[]) => stack.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ');

function loadSvg(svg: SVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const markup = new XMLSerializer().serializeToString(clone);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('share card art did not load'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

function line(ctx: CanvasRenderingContext2D, text: string, y: number, size: number, family: string, color: string) {
  const k = CARD.scale;
  const max = (CARD.w - CARD.pad * 2) * k;
  let px = size * k;
  ctx.font = `700 ${px}px ${family}`;
  while (ctx.measureText(text).width > max && px > 12) {
    px -= 2;
    ctx.font = `700 ${px}px ${family}`;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, (CARD.w / 2) * k, y * k);
}

/** Draws the card from the preview on screen (`sharecard-art` holds the drawing). */
export async function renderCard(text: CardText, artHost: Element | null): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const k = CARD.scale;
  const canvas = document.createElement('canvas');
  canvas.width = CARD.w * k;
  canvas.height = CARD.h * k;
  const ctx = canvas.getContext('2d') as (CanvasRenderingContext2D & { direction?: CanvasDirection }) | null;
  if (!ctx) return null;
  const voice = cssStack(fontFamily.voice);
  const display = cssStack(fontFamily.display);
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  await Promise.all([`700 40px ${voice}`, `700 40px ${display}`].map((f) => fonts?.load(f, 'ع').catch(() => undefined)));
  ctx.fillStyle = SKETCH.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const svg = artHost?.querySelector('svg') ?? null;
  if (svg) {
    const img = await loadSvg(svg);
    if (text.art === 'dish') ctx.drawImage(img, ((CARD.w - CARD.dishSize) / 2) * k, CARD.dishTop * k, CARD.dishSize * k, CARD.dishSize * k);
    else ctx.drawImage(img, ((CARD.w - CARD.sceneW) / 2) * k, CARD.sceneTop * k, CARD.sceneW * k, CARD.sceneH * k);
  }
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  line(ctx, text.head, CARD.headY, CARD.headSize, voice, SKETCH.line);
  if (text.sub) line(ctx, text.sub, CARD.subY, CARD.subSize, display, SKETCH.line);
  ctx.fillStyle = text.accent;
  ctx.fillRect((CARD.w / 2 - 24) * k, CARD.ruleY * k, 48 * k, 3 * k);
  line(ctx, text.brand, CARD.brandY, CARD.brandSize, voice, SKETCH.tea);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

export async function shareCard(input: { text: CardText; fileName: string; title: string; view: RefObject<View | null> }): Promise<ShareResult> {
  try {
    const host = (input.view.current as unknown as Element | null)?.querySelector?.('[data-testid="sharecard-art"]') ?? null;
    const blob = await renderCard(input.text, host);
    if (!blob) return 'failed';
    return await shareBlob(blob, input.fileName, input.title);
  } catch {
    return 'failed';
  }
}
