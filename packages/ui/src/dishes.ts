/**
 * `@driver/ui/dishes`: the dish pictures (DishDrawing and its photo set). A subpath of its own because
 * Metro bundles everything an import reaches: the courier app imports `@driver/ui` and must not carry
 * the 1.2 MB of dish photos it never shows.
 */
export { DishDrawing, DISH_KINDS, DISH_LOOKS, type DishKind, type DishDrawingProps } from './art/dishes';
export { dishLook, motifForDish, temperatureOf, type Temperature } from './art/dish-motif';
