import { describe, expect, it } from 'vitest';
import { color, fontFamily, space, tokens } from './tokens.js';

describe('design tokens', () => {
  it('spacing is a scale of 4', () => {
    for (const v of Object.values(space)) expect(v % 4).toBe(0);
  });
  it('colors are 6-digit hex', () => {
    const walk = (o: Record<string, unknown>) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'string') expect(v).toMatch(/^#[0-9A-F]{6}$/);
        else walk(v as Record<string, unknown>);
      }
    };
    walk(color);
  });
  it('font stacks start with an Arabic face', () => {
    expect(fontFamily.sans[0]).toBe('IBM Plex Sans Arabic');
    expect(fontFamily.display[0]).toBe('IBM Plex Sans Arabic');
  });
  it('is JSON-serialisable', () => {
    expect(JSON.parse(JSON.stringify(tokens))).toEqual(tokens);
  });
});
