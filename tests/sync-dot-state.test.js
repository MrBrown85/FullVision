import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/* The sync dot is the one place sync shows, and it says no count
   (DECISIONS, "Product shape"). The sweep found it stuck on "Syncing..." for
   minutes with an empty queue, saying "All changes saved" with four changes
   still queued, and counting "Syncing 6 queued changes" down to 0. */

function dotStub() {
  var attrs = {};
  return {
    className: '',
    title: '',
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name] || null;
    },
  };
}

function queueWith(stats) {
  return {
    stats() {
      return Object.assign(
        { queued: 0, deadLettered: 0, signedOut: false, online: true, flushing: false, lastFlushAt: null },
        stats,
      );
    },
    deadLetter() {
      return [];
    },
  };
}

describe('sync dot', () => {
  var originalGetElementById;
  var originalQueue;
  var dot;

  beforeEach(() => {
    originalGetElementById = document.getElementById;
    originalQueue = window.v2Queue;
    dot = dotStub();
    document.getElementById = id => (id === 'sync-indicator-dot' ? dot : null);
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    window.v2Queue = originalQueue;
    _pendingSyncs = 0;
    _syncStatus = 'idle';
  });

  it('says saved once the queue is empty, even if a promise on this tab never settled', () => {
    window.v2Queue = queueWith({ queued: 0 });
    _pendingSyncs = 1;
    _syncStatus = 'syncing';

    _updateSyncIndicator();

    expect(dot.className).toBe('tb-sync-dot idle');
    expect(dot.title).toBe('All changes saved');
    expect(dot.getAttribute('aria-label')).toBe('All changes saved');
  });

  it('keeps syncing while changes are queued, whichever painter runs last', () => {
    window.v2Queue = queueWith({ queued: 4 });
    _pendingSyncs = 0;
    _syncStatus = 'idle';

    refreshSyncStatusUI();
    _updateSyncIndicator();

    expect(dot.className).toBe('tb-sync-dot syncing');
    expect(dot.title).toBe('Syncing...');
    expect(dot.getAttribute('aria-label')).toBe('Syncing...');
  });

  it('never gives a count of changes', () => {
    for (var stats of [{ queued: 6 }, { queued: 1 }, { queued: 3, online: false }]) {
      window.v2Queue = queueWith(stats);
      refreshSyncStatusUI();
      expect(dot.title).not.toMatch(/\d/);
      expect(dot.getAttribute('aria-label')).not.toMatch(/\d/);
    }
  });

  it('turns red offline with changes waiting', () => {
    window.v2Queue = queueWith({ queued: 3, online: false });
    _updateSyncIndicator();
    expect(dot.className).toBe('tb-sync-dot error');
    expect(dot.title).toBe('Offline — changes are saved on this device');
  });
});
