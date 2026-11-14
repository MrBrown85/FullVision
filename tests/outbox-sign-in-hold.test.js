/**
 * The outbox while start-up's sign-in re-check has not passed (Colin's
 * ruling of 2026-11-14, "Drop on failure"; docs/DECISIONS.md). With a
 * second tab already open and sending, a write made in the tab still
 * checking is not handed to that tab and sent: it waits for its own tab's
 * re-check, and is removed unsent if that fails. Two copies of
 * shared/offline-queue.js stand for the two tabs (tests/setup.js gives them
 * a shared BroadcastChannel and Web Locks).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_SOURCE = readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8');
const TEACHER = 'a0000000-0000-4000-8000-00000000000a';

let original;
let sent;
let tabs;

const tick = () => new Promise(r => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 10; i++) await tick();
}

/* A tab: its own copy of the outbox, sending through `sent`. */
function openTab(name) {
  window.v2Queue = undefined; // the tab already open stays open
  runInThisContext(QUEUE_SOURCE, { filename: 'shared/offline-queue.js' });
  const q = window.v2Queue;
  q.configure({
    send: (endpoint, payload) => {
      sent.push({ tab: name, endpoint, payload });
      return Promise.resolve({ data: null, error: null });
    },
  });
  tabs.push(q);
  return q;
}

const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });

beforeEach(() => {
  original = { queue: window.v2Queue, store: localStorage._store };
  setOnline(true);
  localStorage._store = {};
  localStorage.setItem('sb-example-auth-token', JSON.stringify({ user: { id: TEACHER } }));
  sent = [];
  tabs = [];
});

afterEach(() => {
  tabs.forEach(q => q.release());
  window.v2Queue = original.queue;
  localStorage._store = original.store;
});

describe('a second tab owns the outbox while this one checks its sign-in', () => {
  async function twoTabs() {
    const owner = openTab('owner');
    await settle();
    const checking = openTab('checking');
    await settle();
    // An entry from an earlier, confirmed visit, left waiting.
    checking.enqueue('save_teacher_preferences', { p_view_mode: 'compact' }, { noFlush: true });
    checking.hold();
    checking.push('upsert_score', { p_enrollment_id: 'e1', p_assessment_id: 'a1', p_score: 3 });
    await settle();
    return { owner, checking };
  }

  it('the owner does not send the held write, even when asked to flush', async () => {
    const { owner } = await twoTabs();
    await owner.flush();
    await settle();
    expect(sent.map(s => s.endpoint)).not.toContain('upsert_score');
    // The earlier entry is the owner's to send, as before.
    expect(sent.map(s => s.endpoint)).toContain('save_teacher_preferences');
  });

  it('it goes once this tab’s re-check passes', async () => {
    const { owner, checking } = await twoTabs();
    await owner.flush();
    checking.unhold();
    await settle();
    await owner.flush();
    expect(sent.filter(s => s.endpoint === 'upsert_score')).toHaveLength(1);
    expect(sent.find(s => s.endpoint === 'upsert_score').tab).toBe('owner');
  });

  it('it is removed, never sent, when the re-check fails; the earlier entry stays', async () => {
    const { owner, checking } = await twoTabs();
    expect(checking.dropHeld()).toBe(1);
    await owner.flush();
    await settle();
    expect(sent.map(s => s.endpoint)).toEqual(['save_teacher_preferences']);
    expect(JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries).toEqual([]);
  });

  it('a held write does not take the place of an earlier queued one', async () => {
    const owner = openTab('owner');
    await settle();
    const checking = openTab('checking');
    owner.release(); // nobody sends, so both stay queued
    checking.release();
    checking.enqueue('upsert_score', { p_enrollment_id: 'e1', p_assessment_id: 'a1', p_score: 2 }, { noFlush: true });
    checking.hold();
    checking.enqueue('upsert_score', { p_enrollment_id: 'e1', p_assessment_id: 'a1', p_score: 4 }, { noFlush: true });
    expect(checking.queued('upsert_score')).toHaveLength(2);
    checking.dropHeld();
    expect(checking.queued('upsert_score').map(e => e.payload.p_score)).toEqual([2]);
  });
});
