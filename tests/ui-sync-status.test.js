import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createClassList() {
  var names = new Set();
  return {
    add(name) {
      names.add(name);
    },
    remove(name) {
      names.delete(name);
    },
    toggle(name, force) {
      if (typeof force === 'boolean') {
        if (force) names.add(name);
        else names.delete(name);
        return force;
      }
      if (names.has(name)) {
        names.delete(name);
        return false;
      }
      names.add(name);
      return true;
    },
    contains(name) {
      return names.has(name);
    },
  };
}

function createElementStub() {
  var attrs = {};
  return {
    hidden: true,
    textContent: '',
    innerHTML: '',
    title: '',
    className: '',
    classList: createClassList(),
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name] || null;
    },
  };
}

describe('desktop sync status UI', () => {
  var originalGetElementById;
  var originalBody;
  var originalQueue;

  beforeEach(() => {
    originalGetElementById = document.getElementById;
    originalBody = document.body;
    originalQueue = window.v2Queue;
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    document.body = originalBody;
    window.v2Queue = originalQueue;
    vi.restoreAllMocks();
  });

  // Sync shows only as the dot: a count next to the teacher's name confused people.
  it('renders the offline banner and the sync dot, with no count or popover', () => {
    var html = renderDock('dashboard');
    expect(html).toContain('offline-banner');
    expect(html).toContain('sync-indicator-dot');
    expect(html).not.toContain('tb-sync-badge');
    expect(html).not.toContain('tb-sync-popover');
  });

  it('shows queued and failed sync state from the offline queue', () => {
    var elements = {
      'offline-banner': createElementStub(),
      'sync-indicator-dot': createElementStub(),
    };
    document.getElementById = function (id) {
      return elements[id] || null;
    };
    document.body = { classList: createClassList() };
    window.v2Queue = {
      stats() {
        return {
          queued: 2,
          deadLettered: 1,
          lastFlushAt: '2026-04-21T19:58:00.000Z',
          online: false,
          flushing: false,
        };
      },
      deadLetter() {
        return [{ id: 'dead-1', endpoint: 'upsert_score', last_error: 'assessment not found' }];
      },
    };
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-21T20:00:00.000Z'));

    refreshSyncStatusUI();

    expect(elements['offline-banner'].hidden).toBe(false);
    expect(document.body.classList.contains('offline-active')).toBe(true);
    expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot error');
  });

  it('turns the dot red while a write the server rejected remains', () => {
    var elements = {
      'offline-banner': createElementStub(),
      'sync-indicator-dot': createElementStub(),
    };
    document.getElementById = function (id) {
      return elements[id] || null;
    };
    document.body = { classList: createClassList() };
    window.v2Queue = {
      stats() {
        return { queued: 0, deadLettered: 1, lastFlushAt: null, online: true, flushing: false };
      },
      deadLetter() {
        return [{ id: 'dead-1', endpoint: 'update_assessment', last_error: 'assessment not found' }];
      },
    };

    refreshSyncStatusUI();

    expect(elements['offline-banner'].hidden).toBe(true);
    expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot error');
    expect(elements['sync-indicator-dot'].title).toBe("Some changes couldn't be saved");
  });

  it('turns the dot red with the reason while this device cannot save', () => {
    var elements = {
      'offline-banner': createElementStub(),
      'sync-indicator-dot': createElementStub(),
    };
    document.getElementById = function (id) {
      return elements[id] || null;
    };
    document.body = { classList: createClassList() };
    window.v2Queue = {
      stats() {
        return { queued: 0, deadLettered: 0, lastFlushAt: null, online: true, flushing: false };
      },
      deadLetter() {
        return [];
      },
    };
    var originalProblem = globalThis.getSaveProblem;
    globalThis.getSaveProblem = () => "This device's storage is full, so recent changes may not be saved";
    try {
      refreshSyncStatusUI();
    } finally {
      globalThis.getSaveProblem = originalProblem;
    }

    expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot error');
    expect(elements['sync-indicator-dot'].title).toBe(
      "This device's storage is full, so recent changes may not be saved",
    );
  });

  it('returns to the idle state when no sync work remains', () => {
    var elements = {
      'offline-banner': createElementStub(),
      'sync-indicator-dot': createElementStub(),
    };
    document.getElementById = function (id) {
      return elements[id] || null;
    };
    document.body = { classList: createClassList() };
    window.v2Queue = {
      stats() {
        return {
          queued: 0,
          deadLettered: 0,
          lastFlushAt: '2026-04-21T19:58:00.000Z',
          online: true,
          flushing: false,
        };
      },
      deadLetter() {
        return [];
      },
    };
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-21T20:00:00.000Z'));

    refreshSyncStatusUI();

    expect(elements['offline-banner'].hidden).toBe(true);
    expect(document.body.classList.contains('offline-active')).toBe(false);
    expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot idle');
    expect(elements['sync-indicator-dot'].title).toBe('All changes saved');
  });
});
