import { motifForDish } from '@/features/food/food-art';
import { photoForMotif } from '@/features/food-landing/photos';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
/**
 * Home's own real photos (Ali's approved dish library, 2026-10-08) for the rice-and-stew dishes the
 * hour's gallery leads with, which the food landing's set draws as one plate: بامية, قيمة, برياني and
 * كبد each get their own, so a lunch gallery isn't the same pot four times.
 */
const BY_NAME: ReadonlyArray<readonly [RegExp, number]> = [
  [/بامي/, require('../../../assets/home/dishes/bamia.webp') as number],
  [/قيمة/, require('../../../assets/home/dishes/qeema.webp') as number],
  [/برياني/, require('../../../assets/home/dishes/biryani.webp') as number],
  [/كبد|معلاگ/, require('../../../assets/home/dishes/liver.webp') as number],
];
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * One stand-in photo per dish, for dishes whose kitchen hasn't uploaded one: the dish's own photo when
 * home has it, else the food landing's photo for its kind. A kind's photo may repeat; a photo of another
 * dish never stands in, so what you see is what comes.
 */
export function dishPhoto(name: string): number {
  return BY_NAME.find(([re]) => re.test(name))?.[1] ?? photoForMotif(motifForDish(name));
}
