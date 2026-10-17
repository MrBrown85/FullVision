/**
 * A tab left open picks up a new deploy by reloading itself quietly
 * (shared/auto-update.js), but only at a safe moment: the tab is hidden or
 * was just shown again, nothing is waiting in the outbox, no write has failed,
 * and the teacher isn't typing, in a dialog, or holding unsaved text.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'shared/auto-update.js'), 'utf-8');

describe('quiet reload after a deploy', () => {
  var originalDocument;
  var originalLocation;
  var originalQueue;
  var swListeners;
  var docListeners;
  var fields;
  var dialogOpen;
  var queueStats;

  function field(tag, opts) {
    var el = Object.assign({ tagName: tag, type: 'text', className: '', value: '', defaultValue: '' }, opts || {});
    fields.push(el);
    return el;
  }

  // Loads the module as a page would. hadController: the page was already
  // run by a service worker when it loaded (false on a first visit).
  function openTab(hadController) {
    swListeners = {};
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: {
        controller: hadController ? {} : null,
        addEventListener: (type, fn) => (swListeners[type] = fn),
        getRegistration: () => Promise.resolve({ update: () => Promise.resolve() }),
      },
      configurable: true,
      writable: true,
    });
    runInThisContext(source, { filename: 'shared/auto-update.js' });
  }

  function newVersionTakesOver() {
    swListeners.controllerchange();
  }

  function setVisibility(state) {
    document.visibilityState = state;
    (docListeners.visibilitychange || []).forEach(fn => fn());
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));
    originalDocument = globalThis.document;
    originalLocation = globalThis.location;
    originalQueue = window.v2Queue;
    docListeners = {};
    fields = [];
    dialogOpen = false;
    queueStats = { queued: 0, deadLettered: 0, flushing: false };
    globalThis.document = {
      visibilityState: 'visible',
      activeElement: null,
      body: {},
      getElementById: () => null,
      addEventListener: (type, fn) => (docListeners[type] = docListeners[type] || []).push(fn),
      querySelector: () => (dialogOpen ? {} : null),
      querySelectorAll: () => fields,
    };
    document.activeElement = document.body;
    globalThis.location = { reload: vi.fn() };
    window.v2Queue = { stats: () => queueStats };
    delete window.ReportQuestionnaire;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    globalThis.document = originalDocument;
    globalThis.location = originalLocation;
    window.v2Queue = originalQueue;
    delete window.ReportQuestionnaire;
    delete globalThis.navigator.serviceWorker;
  });

  it('reloads a hidden tab as soon as the new version takes over', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    newVersionTakesOver();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on a first visit, when the first worker takes over', () => {
    openTab(false);
    document.visibilityState = 'hidden';
    newVersionTakesOver();
    expect(location.reload).not.toHaveBeenCalled();
    // The next one is a real new version.
    newVersionTakesOver();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('waits while the teacher is using the tab, then reloads when it is hidden', () => {
    openTab(true);
    newVersionTakesOver();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(location.reload).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when the tab is shown again, before the teacher clicks', () => {
    openTab(true);
    setVisibility('hidden');
    vi.advanceTimersByTime(60 * 60 * 1000);
    setVisibility('visible');
    // The check started on showing the tab finds the new version a moment later.
    vi.advanceTimersByTime(2000);
    newVersionTakesOver();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload once the teacher has clicked after showing the tab', () => {
    openTab(true);
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(1000);
    _autoUpdate.inputAt = Date.now();
    vi.advanceTimersByTime(1000);
    newVersionTakesOver();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('waits for the outbox to empty, then reloads the hidden tab', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    queueStats.queued = 2;
    newVersionTakesOver();
    expect(location.reload).not.toHaveBeenCalled();
    queueStats.queued = 0;
    vi.advanceTimersByTime(30 * 1000);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload while a write is still being sent', async () => {
    openTab(true);
    document.visibilityState = 'hidden';
    var release;
    var sent = _trackPendingSync(new Promise(r => (release = r)));
    newVersionTakesOver();
    expect(location.reload).not.toHaveBeenCalled();
    release();
    await sent;
    vi.advanceTimersByTime(30 * 1000);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload while a write has failed', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    queueStats.deadLettered = 1;
    newVersionTakesOver();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('does not reload while the outbox cannot be read', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    window.v2Queue = {
      stats: () => {
        throw new Error('storage');
      },
    };
    newVersionTakesOver();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('does not reload while a field has focus, even in a hidden tab', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    document.activeElement = field('INPUT', { type: 'number', value: '3', defaultValue: '3' });
    newVersionTakesOver();
    expect(location.reload).not.toHaveBeenCalled();
    document.activeElement = document.body;
    vi.advanceTimersByTime(30 * 1000);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload while the narrative editor has focus', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    document.activeElement = { tagName: 'DIV', isContentEditable: true };
    newVersionTakesOver();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('does not reload while a report narrative has unsaved changes', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    window.ReportQuestionnaire = { tqNarrativeDirty: true };
    newVersionTakesOver();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('does not reload while a dialog or sheet is open', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    dialogOpen = true;
    newVersionTakesOver();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('does not reload while a text box holds typed text that was not saved', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    field('TEXTAREA', { value: 'Maya explained her reasoning', defaultValue: '' });
    newVersionTakesOver();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('ignores text in a search box and drawn values', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    field('INPUT', { type: 'text', className: 'gb-search-input', value: 'maya', defaultValue: '' });
    field('INPUT', { type: 'search', value: 'quiz', defaultValue: '' });
    field('INPUT', { type: 'text', value: 'Unit 3 Quiz', defaultValue: 'Unit 3 Quiz' });
    field('INPUT', { type: 'checkbox', value: 'on', defaultValue: '' });
    newVersionTakesOver();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads only once', () => {
    openTab(true);
    document.visibilityState = 'hidden';
    newVersionTakesOver();
    setVisibility('hidden');
    vi.advanceTimersByTime(60 * 1000);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });
});
