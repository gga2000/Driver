import { z } from 'zod';
import { CityId } from './common.js';

export const HealthPing = z.object({
  ok: z.literal(true),
  service: z.literal('driver-api'),
  version: z.string(),
  now: z.coerce.date(),
});
export type HealthPing = z.infer<typeof HealthPing>;

export const CityConfigInput = z.object({ cityId: CityId });
