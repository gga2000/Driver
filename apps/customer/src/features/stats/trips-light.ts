/** «خريطتك» is shown by day or in golden light only (night is after launch): the day stays day, every other light is golden. */
export function tripsLight(light: string): 'day' | 'golden' {
  return light === 'day' ? 'day' : 'golden';
}
