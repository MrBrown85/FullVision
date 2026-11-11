/**
 * Reset Demo Data empties the photo queue (shared/data.js, resetDemoData).
 * Photos added in Demo Mode wait in IndexedDB, not in the class data, so
 * deleting the classes alone left them on the device. Signing out (and so
 * leaving Demo Mode) empties it too: tests/signout-offline-queue.test.js.
 */
import './setup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Reset Demo Data', () => {
  const was = { isDemoMode: window.isDemoMode, queue: window.PhotoQueue, seed: window.loadSeedIfNeeded };

  afterEach(() => {
    window.isDemoMode = was.isDemoMode;
    window.PhotoQueue = was.queue;
    window.loadSeedIfNeeded = was.seed;
    localStorage.clear();
  });

  it('empties the photo queue before the sample is seeded again', async () => {
    window.isDemoMode = () => true;
    const order = [];
    window.PhotoQueue = { wipe: vi.fn(async () => order.push('wipe')) };
    window.loadSeedIfNeeded = vi.fn(async () => order.push('seed'));
    await window.resetDemoData();
    expect(order).toEqual(['wipe', 'seed']);
  });

  it('still reseeds when the queue cannot be emptied', async () => {
    window.isDemoMode = () => true;
    window.PhotoQueue = { wipe: vi.fn(() => Promise.reject(new Error('blocked'))) };
    window.loadSeedIfNeeded = vi.fn(async () => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await window.resetDemoData();
    expect(window.loadSeedIfNeeded).toHaveBeenCalled();
  });

  it('does nothing outside Demo Mode', async () => {
    window.isDemoMode = () => false;
    window.PhotoQueue = { wipe: vi.fn() };
    await window.resetDemoData();
    expect(window.PhotoQueue.wipe).not.toHaveBeenCalled();
  });
});
