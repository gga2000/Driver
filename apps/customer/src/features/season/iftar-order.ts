/**
 * «على الفطور» from home (home roast 4, concept C): a dish added for iftar marks its kitchen, and the
 * next checkout of that kitchen's cart opens on the iftar slot (the J6 one), once. Kept for this app
 * session only: an iftar order is decided the same afternoon.
 */
const marked = new Set<string>();

export function markIftarOrder(kitchenId: string): void {
  marked.add(kitchenId);
}

/** True once after `markIftarOrder` for this kitchen. */
export function takeIftarOrder(kitchenId: string): boolean {
  return marked.delete(kitchenId);
}
