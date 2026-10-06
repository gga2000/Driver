/**
 * Which drawing a dish gets (b3, UI/UX audit F-01 / S2-07) — the interim until the illustrated set
 * and real photos (J4). Pure: the motif follows the dish itself (its name, then its menu section),
 * never the kitchen, so a kebab menu is no longer nine identical plates; water is a bottle, laban and
 * شنينة a glass, soft drinks a can. Each dish also gets one of a few looks (tilt, garnish, plate
 * tint) from a hash of its id, and adjacent rows never share a drawing.
 */
export type Motif =
  | 'kebab'
  | 'tikka'
  | 'liver'
  | 'chicken'
  | 'wrap'
  | 'shawarma'
  | 'falafel'
  | 'rice'
  | 'soup'
  | 'salad'
  | 'pickles'
  | 'bread'
  | 'sweet'
  | 'tea'
  | 'water'
  | 'laban'
  | 'can'
  | 'juice'
  | 'plate';

/** Name rules, first match wins (drinks before food words: «ليمون بالنعناع» is a drink, «لفة كبد» a wrap). */
const BY_NAME: ReadonlyArray<readonly [RegExp, Motif]> = [
  [/چاي|شاي|قهوة|استكان/, 'tea'],
  [/ماي|مياه/, 'water'],
  [/لبن|شنينة|عيران/, 'laban'],
  [/بيبسي|ببسي|كولا|سفن|ميرندا|غازي/, 'can'],
  [/عصير|ليمون|برتقال/, 'juice'],
  [/لفة|سندويش|ساندويج/, 'wrap'],
  [/شاورما|صاج/, 'shawarma'],
  [/فلافل/, 'falafel'],
  [/كنافة|زلابية|بقلاوة|حلو|كيك|مهلبي/, 'sweet'],
  [/طرشي|مخلل|عمبة/, 'pickles'],
  [/شوربة|عدس|باچة|باجة|تشريب/, 'soup'],
  [/تمن|برياني|قوزي|مقلوبة/, 'rice'],
  [/سلطة|جاجيك|حمص|فتوش|تبولة/, 'salad'],
  [/كبد|معلاك|قلوب/, 'liver'],
  [/دجاج|طاووق|فروج|مسحب/, 'chicken'],
  [/تكة|تكه/, 'tikka'],
  [/كباب|مشوي|مشكّل|مشكل|شيش/, 'kebab'],
  [/خبز|منقوشة|مناقيش|كاهي|عجين|صمون|قيمر|كيمر/, 'bread'],
];

/** Menu-section fallbacks for names the rules don't know. */
const BY_SECTION: ReadonlyArray<readonly [RegExp, Motif]> = [
  [/مشروب/, 'can'],
  [/حلو/, 'sweet'],
  [/شاورما/, 'shawarma'],
  [/فلافل/, 'falafel'],
  [/مقبلات|سلط/, 'salad'],
  [/شوربة/, 'soup'],
  [/خبز|معجنات|مناقيش/, 'bread'],
  [/مشويات|لفات/, 'kebab'],
];

/** How many looks each motif has (tilt, garnish, plate tint). */
export const ART_LOOKS = 3;

export function motifForDish(name: string, section?: string): Motif {
  for (const [re, m] of BY_NAME) if (re.test(name)) return m;
  if (section) for (const [re, m] of BY_SECTION) if (re.test(section)) return m;
  return 'plate';
}

/** A kitchen's hero scene, from its cuisine tags. */
export function motifForKitchen(tags: readonly string[]): Motif {
  if (tags.includes('shawarma')) return 'shawarma';
  if (tags.includes('breakfast') || tags.includes('pacha')) return 'tea';
  if (tags.includes('grill') || tags.includes('kebab')) return 'kebab';
  if (tags.includes('falafel')) return 'falafel';
  return 'rice';
}

export interface DishArt {
  motif: Motif;
  /** 0 … ART_LOOKS − 1. */
  look: number;
}

/** FNV-1a: a small, stable hash of a dish id (same look on every phone and every visit). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One dish's drawing on its own (cart upsell, search, the item sheet). */
export function artOf(dish: { id: string; name: string; category?: string }): DishArt {
  return { motif: motifForDish(dish.name, dish.category), look: hash(dish.id) % ART_LOOKS };
}

export function sameDrawing(a: DishArt, b: DishArt): boolean {
  return a.motif === b.motif && a.look === b.look;
}

/** Drawings for a list in display order: a row that would repeat the one above takes the next look. */
export function dishArt(rows: ReadonlyArray<{ id: string; name: string; category?: string }>): DishArt[] {
  const out: DishArt[] = [];
  for (const row of rows) {
    const art = artOf(row);
    const prev = out[out.length - 1];
    out.push(prev && sameDrawing(prev, art) ? { motif: art.motif, look: (art.look + 1) % ART_LOOKS } : art);
  }
  return out;
}
