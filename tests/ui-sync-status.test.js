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

  it('renders the offline banner and sync status shell in the dock', () => {
    var html = renderDock('dashboard');
    expect(html).toContain('offline-banner');
    expect(html).toContain('tb-sync-badge');
    expect(html).toContain('tb-sync-popover');
  });

  it('shows queued and failed sync state from the offline queue', () => {
    var elements = {
      'offline-banner': createElementStub(),
      'tb-sync-badge': createElementStub(),
      'tb-sync-popover': createElementStub(),
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
    expect(elements['tb-sync-badge'].hidden).toBe(false);
    expect(elements['tb-sync-badge'].textContent).toBe('3');
    expect(elements['tb-sync-popover'].innerHTML).toContain('3 unsynced');
    // Each failed write is listed with the server's message, Try again and Discard.
    expect(elements['tb-sync-popover'].innerHTML).toContain('The server said: assessment not found');
    expect(elements['tb-sync-popover'].innerHTML).toContain('data-action="retrySyncDeadLetter" data-id="dead-1"');
    expect(elements['tb-sync-popover'].innerHTML).toContain('data-action="dismissSyncDeadLetter" data-id="dead-1"');
    // A failed write outranks being offline in the banner.
    expect(elements['offline-banner'].innerHTML).toContain('1 change couldn&#39;t be saved.');
    expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot error');
  });

  it('returns to the idle state when no sync work remains', () => {
    var elements = {
      'offline-banner': createElementStub(),
      'tb-sync-badge': createElementStub(),
      'tb-sync-popover': createElementStub(),
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
    expect(elements['tb-sync-badge'].hidden).toBe(true);
    expect(elements['tb-sync-popover'].innerHTML).toContain('All changes saved');
    expect(elements['sync-indicator-dot'].className).toBe('tb-sync-dot idle');
  });
});
