import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { shownPhoto, usePhotoFallback } from './photo-fallback';

const OLD = 'http://api.local/files/up_1?exp=1&sig=old';
const FRESH = 'http://api.local/files/up_1?exp=2&sig=new';

describe('photo fallback (expired signed links)', () => {
  it('shows a link until that exact link failed; no link is no photo', () => {
    expect(shownPhoto(OLD, null)).toBe(OLD);
    expect(shownPhoto(OLD, OLD)).toBeNull();
    expect(shownPhoto(FRESH, OLD)).toBe(FRESH);
    expect(shownPhoto(null, null)).toBeNull();
    expect(shownPhoto(undefined, OLD)).toBeNull();
  });

  it('drops a link once it fails to load and tries the fresh one a refetch brings', () => {
    const { result, rerender } = renderHook(({ uri }: { uri: string | null }) => usePhotoFallback(uri), { initialProps: { uri: OLD } });
    expect(result.current.uri).toBe(OLD);
    act(() => result.current.onError());
    // The component now draws the dish / shows the initial instead of a broken image.
    expect(result.current.uri).toBeNull();
    rerender({ uri: FRESH });
    expect(result.current.uri).toBe(FRESH);
  });
});
