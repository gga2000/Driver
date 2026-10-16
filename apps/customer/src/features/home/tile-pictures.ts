/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
import type { ImageSourcePropType } from 'react-native';

/** A home tile's picture: the file, its width over its height, and which way the vehicle faces as drawn. */
export interface TilePicture {
  source: ImageSourcePropType;
  aspect: number;
  faces: 'left' | 'right';
}

/**
 * The realistic pictures on the home tiles (Ali chose them with the soft-tint cards, 2026-10-07): the
 * wrap, a white Corolla taxi, a tuktuk in the app's plum, the garage GMC out to Baghdad and Kut, and
 * the garage van that brings you back (الرجعة, Ali: "a different one"). `aspect` is each file's own,
 * so a tile can size its picture without measuring it.
 */
export const TILE_PICTURES = {
  food: { source: require('../../../assets/home/food.webp') as number, aspect: 380 / 542, faces: 'left' },
  taxi: { source: require('../../../assets/home/taxi.webp') as number, aspect: 360 / 188, faces: 'left' },
  tuktuk: { source: require('../../../assets/home/tuktuk.webp') as number, aspect: 360 / 328, faces: 'right' },
  intercity: { source: require('../../../assets/home/intercity.webp') as number, aspect: 420 / 253, faces: 'left' },
  van: { source: require('../../../assets/home/van.webp') as number, aspect: 400 / 239, faces: 'left' },
} as const satisfies Record<string, TilePicture>;
