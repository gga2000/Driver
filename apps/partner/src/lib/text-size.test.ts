import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from './storage';
import { loadTextSize, saveTextSize, TEXT_SIZE_KEY } from './text-size';

describe('text size choice (n6)', () => {
  it('keeps his choice on the phone and reads anything else as normal', async () => {
    const store = createMemoryStorage();
    await saveTextSize('largest', store);
    expect(store.dump()[TEXT_SIZE_KEY]).toBe('largest');
    expect(await loadTextSize(store)).toBe('largest');
    expect(await loadTextSize(createMemoryStorage({ [TEXT_SIZE_KEY]: 'huge' }))).toBe('normal');
  });
});
