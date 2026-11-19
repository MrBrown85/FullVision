/**
 * A saved copy with a part that would not fit is never opened from
 * (shared/data.js, _copyKeysUnsaved).
 *
 * On Nov 18 2026 a teacher's phone (Safari, whose storage is small) could not
 * save History 12's scores. Swiping through students' photos made Safari
 * reload the page; the class reopened from its saved copy, which had every
 * Missing mark and no scores, and the server answered "not modified" to the
 * copy's version. Every student read IE 0% and the class showed 0/30 graded,
 * though every grade was on the server.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';
import { syntheticClass } from './eval-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

let fake;
let original;
let fullFor;
let realSet;
const bundle = syntheticClass();
bundle.version = 7;
const cid = bundle.gradebook.course.id;

async function quiet() {
  for (let i = 0; i < 6; i++) {
    await settle();
    await window.v2Queue.flush();
  }
}

/* Safari reloading the page: memory is gone, browser storage stays. */
function reloadPage() {
  delete _cache.students[cid];
  delete _cache.scores[cid];
  delete _cache.statuses[cid];
  delete _classVersion[cid];
  delete _classLoads[cid];
  _initPromise = null;
  clearProfCache();
}

const letters = () =>
  getStudents(cid).map(s => {
    const b = studentGradeBadges(cid, s.id).letter;
    return b ? b.text : null;
  });

beforeEach(() => {
  original = { getSupabase: globalThis.getSupabase, useSupabase: _useSupabase, teacher: _teacherId };
  _useSupabase = true;
  _supabaseDegraded = false;
  _teacherId = 'teacher-a';
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  globalThis.__FV_CLASS_BUNDLE = true;
  localStorage.clear();
  window.v2Queue.clear();
  fullFor = null;
  realSet = localStorage.setItem;
  localStorage.setItem = function (k, v) {
    if (fullFor && fullFor.test(k)) {
      const e = new Error('The quota has been exceeded.');
      e.name = 'QuotaExceededError';
      throw e;
    }
    return realSet.call(this, k, v);
  };
  fake = makeFakeSupabase();
  // The server answers "not modified" to a copy's version, as gradebook-prod does.
  fake.on('get_class_bundle', p => ({
    data: p && p.p_if_version != null ? { not_modified: true, version: 7 } : bundle,
    error: null,
  }));
  fake.on('list_course_grade_returns', () => ({ data: {}, error: null }));
  fake.on('note_course_opened', () => ({ data: true, error: null }));
  globalThis.getSupabase = () => fake;
  saveCourses({ [cid]: { id: cid, name: 'History 12', gradingSystem: 'letter' } });
  saveConfig({ activeCourse: cid });
});

afterEach(() => {
  localStorage.setItem = realSet;
  if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
  _loadRetryTimer = null;
  window.v2Queue.clear();
  globalThis.getSupabase = original.getSupabase;
  _useSupabase = original.useSupabase;
  _teacherId = original.teacher;
  globalThis.__FV_CLASS_BUNDLE = false;
  _copyKeysUnsaved = {};
  _storageFullKeys.clear();
  localStorage.clear();
  reloadPage();
});

describe('a saved copy missing its scores', () => {
  it('is not opened from after a reload: the class downloads in full and keeps its grades', async () => {
    fullFor = /^gb-scores-/;
    await initData(cid);
    await quiet();
    clearProfCache();
    const before = letters();
    expect(before.filter(t => t && !/ 0%$/.test(t)).length).toBeGreaterThan(0);
    expect(localStorage.getItem('gb-scores-' + cid)).toBeNull();
    expect(localStorage.getItem('gb-bundle-meta-' + cid)).toBeNull();

    reloadPage();
    await initData(cid);
    await quiet();
    clearProfCache();

    expect(letters()).toEqual(before);
    const asks = fake.calls.filter(c => c.name === 'get_class_bundle');
    expect(asks[asks.length - 1].params.p_if_version).toBeNull();
  });

  it('a part that fails after the copy was saved takes the record away too', async () => {
    await initData(cid);
    await quiet();
    expect(localStorage.getItem('gb-bundle-meta-' + cid)).not.toBeNull();

    fullFor = /^gb-scores-/;
    saveScores(cid, Object.assign({}, getScores(cid)));
    expect(localStorage.getItem('gb-bundle-meta-' + cid)).toBeNull();
    // Opening the class again does not put the record back while the part is unsaved.
    _saveClassMeta(cid, { lastOpenedAt: Date.now() });
    expect(localStorage.getItem('gb-bundle-meta-' + cid)).toBeNull();
  });

  it('a complete copy is still opened from, with only a version check', async () => {
    await initData(cid);
    await quiet();
    clearProfCache();
    const before = letters();

    reloadPage();
    await initData(cid);
    await quiet();
    clearProfCache();

    expect(letters()).toEqual(before);
    const asks = fake.calls.filter(c => c.name === 'get_class_bundle');
    expect(asks[asks.length - 1].params.p_if_version).toBe(7);
  });
});
