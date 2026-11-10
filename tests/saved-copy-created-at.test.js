/**
 * A class this browser saved before it knew when pieces were made is
 * fetched again in full, once (S0-F1e).
 *
 * A saved class opens from this browser's copy, and the server is then asked
 * only whether the class changed ("not modified" when it has not). So a
 * browser holding a copy from before the server sent created_at would keep
 * a copy with no times for as long as the class did not change: same-date
 * pieces would sit in id order there, in the order made on a device that
 * fetched the class fresh, and a Most Recent level would change on its own
 * at the next refetch.
 *
 * shared/data.js therefore raises the saved copy's schema to 6 and uses no
 * older copy as it is. The first time a browser runs this code, each class
 * is fetched in full once and its copy saved with the times. This file pins
 * what that first run does:
 *   - online: one full fetch, then the copy is used as before;
 *   - with writes still unsent: the copy and its edits are kept, the writes
 *     are sent first, and only then is the class fetched;
 *   - offline: the old copy is shown and worked on, same-date pieces in id
 *     order, until a fetch succeeds;
 *   - Demo Mode: no server, nothing changes;
 *   - the phone app: the same shared/data.js.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';
import { syntheticClass } from './eval-fixture.js';

// Production loads the outbox next to shared/data.js; so does this test.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = 'e0000000-0000-4000-8000-000000000001';
const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const CHANGE_SECTION = id(702); // Continuity and Change
const PRIYA = id(102);

/* The server's times: Current Events Week 3 was made first, then Week 1,
   then Week 2, which is not the order of their ids. */
const MADE = [
  '2026-09-01T16:00:00.000000+00:00',
  '2026-09-02T16:00:00.000000+00:00', // Week 1
  '2026-09-02T16:05:00.000000+00:00', // Week 2
  '2026-09-01T16:30:00.000000+00:00', // Week 3
  '2026-09-03T16:00:00.000000+00:00',
  '2026-09-02T17:00:00.000000+00:00',
  '2026-09-04T16:00:00.000000+00:00',
];

/* History 12 with Current Events Week 1, 2 and 3 all dated Oct 20, as the
   server sends it: `times` true once the server sends created_at. */
function serverClass(version, times, patch) {
  const bundle = syntheticClass();
  bundle.version = version;
  const pieces = bundle.gradebook.assessments;
  [1, 2, 3].forEach(i => (pieces[i].date_assigned = pieces[i].due_date = '2026-10-20'));
  if (times) pieces.forEach((a, i) => (a.created_at = MADE[i]));
  if (patch) patch(bundle);
  return bundle;
}

function forgetMemory() {
  Object.keys(_DATA_KEYS).forEach(function (field) {
    delete _cache[field][CID];
  });
  delete _classVersion[CID];
  delete _classFresh[CID];
  delete _refreshState[CID];
  delete _loadError[CID];
  _serverState = {};
  _dirtyMarked = {};
  clearProfCache();
}

// The titles of Priya's Continuity and Change work, in the order it counts.
function counted() {
  setActiveTerm(CID, null);
  clearProfCache();
  const titles = {};
  getAssessments(CID).forEach(a => (titles[a.id] = a.title));
  return sectionCountedEvidence(CID, PRIYA, CHANGE_SECTION).map(e => titles[e.assessmentId]);
}
const BY_ID = ['Current Events: Week 1', 'Current Events: Week 2', 'Current Events: Week 3'];
const AS_MADE = ['Current Events: Week 3', 'Current Events: Week 1', 'Current Events: Week 2'];

describe('a class saved before the server sent when pieces were made', () => {
  let fake;
  let original;

  beforeEach(() => {
    original = {
      getSupabase: globalThis.getSupabase,
      useSupabase: _useSupabase,
      teacher: _teacherId,
      quiet: _REFRESH_QUIET_MS,
    };
    _REFRESH_QUIET_MS = 0;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-a';
    globalThis.__FV_CLASS_BUNDLE = true;
    localStorage.clear();
    forgetMemory();
    fake = makeFakeSupabase();
    globalThis.getSupabase = () => fake;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
    saveCourses({ [CID]: { id: CID, name: 'History 12' } });
    saveConfig({ activeCourse: CID });
  });

  afterEach(() => {
    if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
    _loadRetryTimer = null;
    _loadRetryCount = 0;
    window.v2Queue.clear();
    forgetMemory();
    globalThis.getSupabase = original.getSupabase;
    _useSupabase = original.useSupabase;
    _teacherId = original.teacher;
    _REFRESH_QUIET_MS = original.quiet;
    globalThis.__FV_CLASS_BUNDLE = false;
    localStorage.clear();
  });

  /* What the code before this left in the browser: the class at `version`
     with no times, its copy marked schema 5. Then the page is closed. */
  async function savedByEarlierCode(version) {
    fake.on('get_class_bundle', () => ({ data: serverClass(version, false), error: null }));
    await initData(CID);
    await settle();
    expect(getAssessments(CID).every(a => a.created_at === undefined)).toBe(true);
    _saveClassMeta(CID, { schema: 5 });
    forgetMemory();
    fake.calls.length = 0;
  }

  /* The server after the migration: "not modified" to a request that names
     the class's current version, the whole class with its times otherwise. */
  function serverWithTimes(version, patch) {
    fake.on('get_class_bundle', p =>
      p.p_if_version === version
        ? { data: { not_modified: true, version }, error: null }
        : { data: serverClass(version, true, patch), error: null },
    );
  }
  const fetches = () => fake.calls.filter(c => c.name === 'get_class_bundle').map(c => c.params.p_if_version);

  it('the saved copy’s schema is 6, and no older copy is used as it is', () => {
    expect(_BUNDLE_SCHEMA).toBe(6);
    localStorage.setItem('gb-students-' + CID, '[]');
    const meta = schema => {
      _saveClassMeta(CID, { schema, owner: _teacherId, version: 9, lastOpenedAt: Date.now(), savedAt: Date.now() });
      return _savedCopyUsable(CID);
    };
    expect(meta(6)).toBe(true);
    expect(meta(5)).toBe(false);
    expect(meta(4)).toBe(false);
    expect(meta(3)).toBe(false);
    expect(meta(undefined)).toBe(false);
    expect(meta(7)).toBe(false); // nor one from code newer than this
  });

  it('online: the class is fetched in full once, though it has not changed, and then its copy is used', async () => {
    await savedByEarlierCode(5);
    serverWithTimes(5);

    await initData(CID);
    await settle();
    // Not "has version 5 changed?", which the server would answer "not modified".
    expect(fetches()).toEqual([null]);
    expect(getAssessments(CID).map(a => a.created_at)).toEqual(MADE);
    expect(counted().slice(-3)).toEqual(AS_MADE);
    expect(_classMeta(CID)).toMatchObject({ schema: 6, version: 5, dirty: false });

    // The page is opened again: the copy is used and only checked.
    forgetMemory();
    fake.calls.length = 0;
    await initData(CID);
    expect(counted().slice(-3)).toEqual(AS_MADE);
    await _refreshState[CID].running;
    expect(fetches()).toEqual([5]);
    expect(getAssessments(CID).map(a => a.created_at)).toEqual(MADE);
    expect(counted().slice(-3)).toEqual(AS_MADE);
  });

  it('a copy written since by a tab still running the earlier code is fetched again too', async () => {
    await savedByEarlierCode(5);
    serverWithTimes(5);
    await initData(CID);
    await settle();
    expect(_classMeta(CID).schema).toBe(6);
    // The other tab stores the class as the earlier code does: no times, schema 5.
    const stored = JSON.parse(localStorage.getItem('gb-assessments-' + CID));
    stored.forEach(a => delete a.created_at);
    localStorage.setItem('gb-assessments-' + CID, JSON.stringify(stored));
    _saveClassMeta(CID, { schema: 5 });

    forgetMemory();
    fake.calls.length = 0;
    await initData(CID);
    await settle();
    expect(fetches()).toEqual([null]);
    expect(counted().slice(-3)).toEqual(AS_MADE);
  });

  it('with a write still unsent: the copy and its edit are kept, the write is sent, and only then is the class fetched', async () => {
    await savedByEarlierCode(5);
    // In the earlier session the teacher renamed Priya with no connection: the
    // change is in this browser's copy and waiting in the outbox.
    _loadCourseFromLS(CID);
    _rememberServerState('students', CID, getStudents(CID));
    fake.failNext('update_student', 1);
    const students = getStudents(CID);
    students.find(s => s.id === PRIYA).firstName = 'Priyanka';
    saveStudents(CID, students);
    await settle();
    expect(window.v2Queue.stats().queued).toBe(1);
    expect(fake.committedCount('update_student')).toBe(0);
    forgetMemory();
    fake.calls.length = 0;

    // The server holds the rename once it has been sent, and not before.
    const renamed = () =>
      fake.committedCount('update_student', p => p.p_patch && p.p_patch.first_name === 'Priyanka') > 0;
    fake.on('get_class_bundle', () => ({
      data: serverClass(renamed() ? 6 : 5, true, bundle => {
        if (renamed()) bundle.gradebook.students[2].first_name = 'Priyanka';
      }),
      error: null,
    }));

    // The first run of this code.
    await initData(CID);
    await settle();
    // Nothing is fetched over the unsent edit; the copy with the edit is on screen.
    expect(fetches()).toEqual([]);
    expect(getStudents(CID).find(s => s.id === PRIYA).firstName).toBe('Priyanka');
    expect(window.v2Queue.stats().queued).toBe(1);
    expect(counted().slice(-3)).toEqual(BY_ID); // no times yet

    // The connection is back: the outbox sends the rename, then the class is fetched in full.
    await window.v2Queue.flush();
    await _refreshState[CID].running;
    await settle();
    expect(renamed()).toBe(true);
    expect(window.v2Queue.stats().queued).toBe(0);
    const names = fake.calls.map(c => c.name);
    expect(names.indexOf('update_student')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('update_student')).toBeLessThan(names.indexOf('get_class_bundle'));
    expect(fetches()).toEqual([null]);
    expect(getStudents(CID).find(s => s.id === PRIYA).firstName).toBe('Priyanka');
    expect(getAssessments(CID).map(a => a.created_at)).toEqual(MADE);
    expect(counted().slice(-3)).toEqual(AS_MADE);
    expect(_classMeta(CID)).toMatchObject({ schema: 6, version: 6 });
  });

  it('offline: the old copy is shown and same-date pieces sit in id order, until a fetch succeeds', async () => {
    await savedByEarlierCode(5);
    fake.on('get_class_bundle', () => ({ data: null, error: { message: 'network: failed to fetch' } }));

    await initData(CID);
    await settle();
    expect(fetches()).toEqual([null]);
    // The class is there to read and to work on.
    expect(getStudents(CID).map(s => s.firstName)).toContain('Priya');
    expect(getAssessments(CID)).toHaveLength(7);
    expect(_loadError[CID]).toBeTruthy();
    // No piece has a time, so same-date pieces count in id order.
    expect(_pieceOrderFacts(CID).every(f => f.made === null)).toBe(true);
    expect(counted().slice(-3)).toEqual(BY_ID);
    // The copy is still the earlier code's: the next open will try again.
    expect(_classMeta(CID).schema).toBe(5);

    // The connection is back and the load is tried again (as the retry timer does).
    serverWithTimes(5);
    fake.calls.length = 0;
    await _handleExternalCourseUpdate(CID, 'gradebook');
    await settle();
    expect(fetches()).toEqual([null]);
    expect(_loadError[CID]).toBeUndefined();
    expect(counted().slice(-3)).toEqual(AS_MADE);
    expect(_classMeta(CID).schema).toBe(6);
  });

  it('offline, a piece made here meanwhile counts after the loaded same-date pieces', async () => {
    await savedByEarlierCode(5);
    fake.on('get_class_bundle', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
    await initData(CID);
    await settle();
    getAssessments(CID).push({
      id: uid(),
      title: 'Quiz',
      scoreMode: 'proficiency',
      tagIds: [id(402)],
      date: '2026-10-20',
      categoryId: id(500),
      created: new Date().toISOString(),
    });
    const quiz = getAssessments(CID)[7];
    getScores(CID)[PRIYA].push({ assessmentId: quiz.id, tagId: id(402), score: 4, date: '2026-10-20' });
    expect(counted().slice(-4)).toEqual(BY_ID.concat('Quiz'));
  });

  it('Demo Mode and a signed-out class: no server is asked and the class this browser holds is used', async () => {
    await savedByEarlierCode(5);
    _useSupabase = false;
    serverWithTimes(5);
    await initData(CID);
    await settle();
    expect(fake.calls).toEqual([]);
    expect(getStudents(CID).map(s => s.firstName)).toContain('Priya');
    expect(getAssessments(CID)).toHaveLength(7);
    expect(counted().slice(-3)).toEqual(BY_ID);
  });

  it('the phone app loads the same shared/data.js', () => {
    const page = file => readFileSync(resolve(root, file), 'utf-8');
    expect(page('teacher-mobile/index.html')).toMatch(/<script[^>]+src="[^"]*shared\/data\.js[^"]*"/);
    expect(page('teacher/app.html')).toMatch(/<script[^>]+src="[^"]*shared\/data\.js[^"]*"/);
  });
});
