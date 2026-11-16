import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './id';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  it('uses crypto.randomUUID where the browser has it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77' });
    expect(newId()).toBe('3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77');
  });

  it('still gives a different id each time when crypto.randomUUID is missing', () => {
    vi.stubGlobal('crypto', {});
    const first = newId();
    const second = newId();
    expect(first).toMatch(/^id-[a-z0-9]+-[a-z0-9]+$/);
    expect(second).not.toBe(first);
  });

  it('does not need crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newId()).toMatch(/^id-/);
  });
});
