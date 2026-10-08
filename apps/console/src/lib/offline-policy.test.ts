import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { staleLevel, VERY_OLD_MS } from '@/components/ui/status';
import { makeQueryClient } from './providers';

afterEach(() => onlineManager.setOnline(true));

describe('offline policy (build plan section 6)', () => {
  it('a write tapped offline is tried now and fails, never parked and replayed later', async () => {
    onlineManager.setOnline(false);
    const client = makeQueryClient();
    const send = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const mutation = client.getMutationCache().build(client, { mutationFn: send });
    await expect(mutation.execute(undefined)).rejects.toThrow('Failed to fetch');
    expect(send).toHaveBeenCalledTimes(1);
    expect(mutation.state.isPaused).toBe(false);

    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('marks data amber past the page threshold and red past 2 minutes', () => {
    expect(staleLevel(null, 5, false)).toBe('fresh');
    expect(staleLevel(10_000, 5, false)).toBe('fresh');
    expect(staleLevel(60_000, 5, false)).toBe('stale');
    expect(staleLevel(VERY_OLD_MS + 1, 5, false)).toBe('old');
    // A page that polls every 60 s goes amber at 3 polls, red after that, never before 2 minutes.
    expect(staleLevel(150_000, 60, false)).toBe('fresh');
    expect(staleLevel(200_000, 60, false)).toBe('old');
  });
});
