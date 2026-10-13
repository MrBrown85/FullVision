/**
 * Sample data is for Demo Mode only — shared/data.js loadSeedIfNeeded.
 *
 * A signed-in teacher with no classes must never get the Science 8 demo
 * class written into their account.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('loadSeedIfNeeded', () => {
  let originalIsDemoMode, originalSeed, seeded;

  beforeEach(() => {
    originalIsDemoMode = window.isDemoMode;
    originalSeed = globalThis.seedIfNeeded;
    seeded = 0;
    globalThis.seedIfNeeded = () => {
      seeded++;
    };
  });

  afterEach(() => {
    window.isDemoMode = originalIsDemoMode;
    globalThis.seedIfNeeded = originalSeed;
  });

  it('seeds in Demo Mode', async () => {
    window.isDemoMode = () => true;
    await window.loadSeedIfNeeded();
    expect(seeded).toBe(1);
  });

  it('does nothing for a signed-in teacher', async () => {
    window.isDemoMode = () => false;
    await window.loadSeedIfNeeded();
    expect(seeded).toBe(0);
  });
});
