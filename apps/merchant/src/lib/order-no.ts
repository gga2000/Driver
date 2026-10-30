/**
 * Day-one d05: an order number reads «#7477» everywhere. Inside Arabic text the «#» can drift to the
 * far side of the digits («7477#», most often when the line wraps), so every number built in code is
 * wrapped in a left-to-right isolate, like the `⁦#{number}⁩` copy in locales/ar.json. Plain Node, tested.
 */

export const LRI = '⁦';
export const PDI = '⁩';

/** `#7477` inside a left-to-right isolate. */
export function orderNo(number: string | number): string {
  return `${LRI}#${number}${PDI}`;
}

/** The text a person sees, without the invisible isolate marks (tests, screen readers, logs). */
export function visibleText(s: string): string {
  return s.replace(/[⁦-⁩]/g, '');
}
