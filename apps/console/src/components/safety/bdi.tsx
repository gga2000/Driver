import { Fragment, type ReactNode } from 'react';

/** "مشوار تكسي #3006" in RTL: each "#1234" goes in a <bdi> so its # stays in front (DESIGN.md). */
export function withBdi(text: string): ReactNode {
  const parts = text.split(/(#\d+)/);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (/^#\d+$/.test(p) ? <bdi key={i}>{p}</bdi> : <Fragment key={i}>{p}</Fragment>));
}
