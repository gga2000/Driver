/**
 * The home ride card's sub line split for its look (home roast 3, look B): the place stays in the words,
 * the fare rides on the little road. The fare is what follows the last « · » («تكسي من {from} · {amount}
 * دينار»), kept on one line; a line without « · » has no fare and stays whole.
 */
export function splitFare(sub: string): [place: string, fare: string | null] {
  const i = sub.lastIndexOf(' · ');
  return i < 0 ? [sub, null] : [sub.slice(0, i), sub.slice(i + 3).replace(/ /g, ' ')];
}
