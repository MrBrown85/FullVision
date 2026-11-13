/**
 * A refused write is counted in Sentry by reason, with nothing from the write
 * itself (owner's ruling, 2026-11-13). The outbox is filled to its limit, a
 * score is entered, and the fake Sentry is checked for what it was sent.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '11111111-1111-4111-8111-111111111111';
const SID = 'e0000000-0000-4000-8000-000000000001';
const AID = 'a0000000-0000-4000-8000-000000000002';
const SCORE = 7.25;
const work = {
  id: AID,
  title: 'Test',
  date: '2026-11-01',
  type: 'summative',
  tagIds: [],
  scoreMode: 'points',
  maxPoints: 10,
};

var originalGetSupabase, originalUseSupabase, originalSentry, warn;

function signIn() {
  globalThis.getSupabase = () => makeFakeSupabase();
  _useSupabase = true;
  _supabaseDegraded = false;
  _teacherId = 'teacher-uuid';
  localStorage.removeItem('gb-demo-mode');
}
function openClass() {
  localStorage.setItem(
    'gb-students-' + CID,
    JSON.stringify([
      {
        id: SID,
        personId: 'f0000000-0000-4000-8000-000000000001',
        firstName: 'Maya',
        lastName: 'Quill',
        designations: [],
      },
    ]),
  );
  localStorage.setItem('gb-assessments-' + CID, JSON.stringify([work]));
  localStorage.setItem('gb-scores-' + CID, JSON.stringify({}));
  _loadCourseFromLS(CID);
  _persistLoadedField(CID, 'scores', {});
}
function fillOutbox() {
  for (var i = 0; i < window.v2Queue.MAX_ENTRIES; i++) window.v2Queue.enqueue('rpc', { i: i }, { noFlush: true });
}
function enterScore() {
  return setPointsScore(CID, SID, AID, SCORE);
}

beforeEach(() => {
  localStorage.clear();
  Object.keys(_cache).forEach(function (field) {
    if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config')
      _cache[field] = {};
  });
  _serverState = {};
  _idRekeys = {};
  _forgetServerState(CID);
  originalGetSupabase = globalThis.getSupabase;
  originalUseSupabase = _useSupabase;
  originalSentry = window.Sentry;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  window.v2Queue.clear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  signIn();
  openClass();
  fillOutbox();
});

afterEach(() => {
  globalThis.getSupabase = originalGetSupabase;
  _useSupabase = originalUseSupabase;
  window.Sentry = originalSentry;
  _outboxRefused = false;
  window.v2Queue.clear();
  warn.mockRestore();
});

describe('a refused write is reported to Sentry by reason', () => {
  it('sends one warning with the function name and reason, and nothing else', () => {
    var captureMessage = vi.fn();
    window.Sentry = { captureMessage };
    enterScore();

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0]).toEqual(['Write refused: upsert_score (queue_full)', 'warning']);
    var everything = JSON.stringify(captureMessage.mock.calls);
    [SID, AID, CID, String(SCORE), 'Maya', 'Quill'].forEach(v => expect(everything).not.toContain(v));
  });

  it('the refusal is still handled as before: console warning, sync dot state', () => {
    window.Sentry = { captureMessage: vi.fn() };
    enterScore();
    expect(warn).toHaveBeenCalledWith('upsert_score not queued (queue_full): the outbox has no room');
    expect(_outboxRefused).toBe(true);
  });

  it('a second refusal with the same text sends nothing more', () => {
    var captureMessage = vi.fn();
    window.Sentry = { captureMessage };
    enterScore();
    setPointsScore(CID, SID, AID, 8);
    setPointsScore(CID, SID, AID, 9);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('a different function name or reason is reported on its own', () => {
    var captureMessage = vi.fn();
    window.Sentry = { captureMessage };
    _onWriteRefused('upsert_score', {}, undefined, 'queue_full');
    _onWriteRefused('update_student', {}, undefined, 'queue_full');
    _onWriteRefused('upsert_score', {}, undefined, 'storage_full');
    expect(captureMessage.mock.calls.map(c => c[0])).toEqual([
      'Write refused: upsert_score (queue_full)',
      'Write refused: update_student (queue_full)',
      'Write refused: upsert_score (storage_full)',
    ]);
  });

  it('with Sentry absent, the refusal is handled as before', () => {
    delete window.Sentry;
    enterScore();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(_outboxRefused).toBe(true);
  });

  it('with Sentry throwing, the refusal is handled as before', () => {
    window.Sentry = {
      captureMessage() {
        throw new Error('sentry down');
      },
    };
    expect(() => enterScore()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(_outboxRefused).toBe(true);
  });

  it('Demo Mode never reaches the outbox, so nothing is reported', async () => {
    var captureMessage = vi.fn();
    window.Sentry = { captureMessage };
    _useSupabase = false;
    localStorage.setItem('gb-demo-mode', '1');
    enterScore();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
