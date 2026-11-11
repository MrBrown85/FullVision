/**
 * Student work for a signed-in teacher (S5-W1, S6-W1; shared/data.js,
 * "Student work for a signed-in teacher"). The server is
 * tests/helpers/fake-supabase.js with a stand-in for Batch B's teacher
 * RPCs (migrations/local-test/batch-b-contract.md) and for Storage.
 *
 * - The class's work is read with list_course_submissions when it loads
 *   with Send Work on, and the screens read it through the same readers
 *   Demo Mode's do.
 * - Send Work and an assessment's Students Send go up through the outbox,
 *   with an idempotency key, only what changed, and show at once.
 * - Add Work: start_work_upload, each page and thumbnail uploaded to the
 *   path the server named, then finish_work_upload in page order under
 *   the batch's key. Offline the pages wait and show from the photo queue.
 * - Delete Work and Handed In on Paper; a page shown through a 300-second
 *   signed link, never a path outside the class.
 * - A class whose student page is off is sent nothing new.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const queueSource = readFileSync(resolve(root, 'shared/photo-queue.js'), 'utf-8');

const CID = 'e0000000-0000-4000-8000-000000000001';
const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const NOOR = id(100);
const MATEO = id(101);
const CAUSES = id(300);
const WEEK1 = id(301);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let fake;
let original;
let course;
let srv; // what list_course_submissions sends
let uploads; // [{ path, type, upsert }]
let signed; // [{ path, seconds }]
let seq;

const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
const callsTo = name => fake.calls.filter(c => c.name === name).map(c => c.params);
const newId = () => 'f0000000-0000-4000-8000-' + String(++seq).padStart(12, '0');

function memoryStore() {
  const metas = new Map();
  const files = new Map();
  const copy = v => JSON.parse(JSON.stringify(v));
  return {
    async list() {
      return [...metas.values()].map(copy);
    },
    async putAll(items) {
      items.forEach(i => {
        metas.set(i.meta.id, copy(i.meta));
        files.set(i.meta.id, { photo: i.photo, thumb: i.thumb });
      });
    },
    async update(key, patch) {
      if (metas.has(key)) metas.set(key, window.PhotoQueue.applyPatch(copy(metas.get(key)), copy(patch)));
    },
    async blobs(key) {
      return files.get(key) || null;
    },
    async remove(keys) {
      keys.forEach(k => {
        metas.delete(k);
        files.delete(k);
      });
    },
    async clear() {
      metas.clear();
      files.clear();
    },
    count: () => metas.size,
  };
}
let store;

function shrunk(n) {
  return Array.from({ length: n }, (_, i) => ({
    blob: new Blob(['page' + i], { type: 'image/jpeg' }),
    thumb: new Blob(['t' + i], { type: 'image/jpeg' }),
    hash: String(i).repeat(64).slice(0, 64),
    width: 1500,
    height: 2000,
  }));
}

function file(sub, n, by = 'student') {
  const f = newId();
  const base = [CID, sub.assessment_id, sub.enrollment_id, sub.id, f].join('/');
  return { id: f, page: n, path: base + '.jpg', thumb_path: base + '-thumb.jpg', sha256: 'c'.repeat(64), added_by: by };
}
function sent(sid, aid, pages = 2) {
  const s = {
    id: newId(),
    assessment_id: aid,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    is_late: false,
    note: 'I was away Thursday.',
    created_at: '2026-11-05T17:40:00Z',
    sent_at: '2026-11-05T17:41:09Z',
    files: [],
  };
  for (let i = 1; i <= pages; i++) s.files.push(file(s, i));
  return s;
}

// The server's side of Add Work: rows and paths, then handing them in.
const started = {}; // submission id → { aid, sid, mode, files }
function answerStart(p) {
  const sub = newId();
  const files = p.p_pages.map((_, i) => {
    const f = newId();
    const base = [CID, p.p_assessment_id, p.p_enrollment_id, sub, f].join('/');
    return { file_id: f, page: i + 1, path: base + '.jpg', thumb_path: base + '-thumb.jpg' };
  });
  started[sub] = { aid: p.p_assessment_id, sid: p.p_enrollment_id, files };
  return {
    data: {
      result: 'ready',
      submission_id: sub,
      mode: p.p_mode,
      bucket: 'student-photos',
      finish_by: '2026-11-11T22:00:00Z',
      files,
    },
    error: null,
  };
}
function answerFinish(p) {
  const up = started[p.p_submission_id];
  if (!up) return { data: { result: 'gone' }, error: null };
  const sub = {
    id: p.p_submission_id,
    assessment_id: up.aid,
    enrollment_id: up.sid,
    version: 1,
    state: 'sent',
    sent_by: 'teacher',
    on_paper: false,
    is_late: false,
    note: null,
    sent_at: '2026-11-11T20:00:00Z',
    files: up.files.map(f => ({
      id: f.file_id,
      page: f.page,
      path: f.path,
      thumb_path: f.thumb_path,
      added_by: 'teacher',
    })),
  };
  srv.submissions.push(sub);
  return { data: { result: 'sent', submission: sub }, error: null };
}

function serverClass() {
  const bundle = syntheticClass();
  bundle.version = 1;
  Object.assign(bundle.gradebook.course, course);
  // Nothing graded yet for Noor and Mateo on Causes: their work is To Grade.
  // (Rows are [student, assessment, …] by position: Noor 0, Mateo 1, Causes 0.)
  ['score_rows', 'tag_rows', 'criterion_rows'].forEach(k => {
    bundle.gradebook[k] = (bundle.gradebook[k] || []).filter(r => !(r[1] === 0 && (r[0] === 0 || r[0] === 1)));
  });
  return bundle;
}

async function openClass() {
  await initData(CID);
  await settle();
  await settle();
}
async function quiet() {
  for (let i = 0; i < 6; i++) {
    await window.v2Queue.flush();
    await settle();
    await window.PhotoQueue.send();
    await settle();
  }
}

beforeEach(() => {
  original = {
    getSupabase: globalThis.getSupabase,
    useSupabase: _useSupabase,
    teacher: _teacherId,
    quiet: _REFRESH_QUIET_MS,
    fetch: globalThis.fetch,
    url: { create: URL.createObjectURL, revoke: URL.revokeObjectURL },
    wait: _WORK_START_WAIT_MS,
  };
  _REFRESH_QUIET_MS = 0;
  _useSupabase = true;
  _supabaseDegraded = false;
  _teacherId = 'teacher-a';
  globalThis.__FV_CLASS_BUNDLE = true;
  localStorage.clear();
  seq = 0;
  course = {
    student_page_enabled: true,
    return_grades: 'on_return',
    send_work: true,
    keep_photos_until: 'end_of_year',
  };
  srv = {
    bucket: 'student-photos',
    course: { send_work: true, keep_photos_until: 'end_of_year' },
    assessments: [
      {
        id: CAUSES,
        students_send: 'photos',
        after_due: 'keep',
        accept_until: null,
        group_work: 'each',
        students_see_markup: true,
      },
    ],
    submissions: [],
    uploads: [],
  };
  srv.submissions.push(sent(NOOR, CAUSES));
  uploads = [];
  signed = [];
  fake = makeFakeSupabase();
  fake.on('get_class_bundle', () => ({ data: serverClass(), error: null }));
  fake.on('list_course_grade_returns', () => ({ data: {}, error: null }));
  fake.on('list_course_submissions', () => ({ data: structuredClone(srv), error: null }));
  fake.on('start_work_upload', answerStart);
  fake.on('finish_work_upload', answerFinish);
  fake.storage = {
    from: bucket => ({
      upload: async (path, blob, opts) => {
        uploads.push({ bucket, path, type: opts.contentType, upsert: opts.upsert });
        return { data: { path }, error: null };
      },
      createSignedUrl: async (path, seconds) => {
        signed.push({ bucket, path, seconds });
        return { data: { signedUrl: 'https://x.supabase.co/sign/' + path }, error: null };
      },
    }),
  };
  globalThis.getSupabase = () => fake;
  globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['jpeg']) }));
  URL.createObjectURL = () => 'blob:page';
  URL.revokeObjectURL = () => {};
  setOnline(true);
  window.v2Queue.clear();
  runInThisContext(queueSource, { filename: 'shared/photo-queue.js' });
  store = memoryStore();
  window.PhotoQueue.configure({ store });
  _workQueueWired = false;
  _workServer = {};
  _workCourseRow = {};
  _workRead = {};
  saveCourses({ [CID]: { id: CID, name: 'History 12' } });
  saveConfig({ activeCourse: CID });
});

afterEach(() => {
  if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
  _loadRetryTimer = null;
  window.v2Queue.clear();
  window.PhotoQueue.release();
  globalThis.getSupabase = original.getSupabase;
  globalThis.fetch = original.fetch;
  URL.createObjectURL = original.url.create;
  URL.revokeObjectURL = original.url.revoke;
  _useSupabase = original.useSupabase;
  _teacherId = original.teacher;
  _REFRESH_QUIET_MS = original.quiet;
  _WORK_START_WAIT_MS = original.wait;
  globalThis.__FV_CLASS_BUNDLE = false;
  setOnline(true);
  localStorage.clear();
  delete _cache.students[CID];
  delete _classVersion[CID];
});

describe('reading a signed-in class’s work', () => {
  it('reads it when the class loads with Send Work on, and every reader answers from it', async () => {
    await openClass();
    expect(callsTo('list_course_submissions')).toEqual([{ p_course_id: CID }]);
    expect(getCourseSendWork(CID)).toEqual({ send_work: true, keep_photos_until: 'end_of_year' });
    expect(getAssessmentStudentWork(CID, CAUSES).students_send).toBe('photos');
    expect(getStudentSubmission(CID, NOOR, CAUSES).files).toHaveLength(2);
    expect(GraderWork.workOnInClass(CID)).toBe(true);
    expect(GraderWork.workStateOf(CID, CAUSES, NOOR)).toBe('tograde');
    expect(GraderWork.workStateOf(CID, CAUSES, MATEO)).toBe('notin');
  });

  it('with Send Work off on the course row, the class load asks nothing about work', async () => {
    course.send_work = false;
    await openClass();
    expect(callsTo('list_course_submissions')).toEqual([]);
    expect(getCourseSendWork(CID).send_work).toBe(false);
  });

  it('with Send Work off, opening the grader, the Assignments page or the Work Wall reads nothing', async () => {
    course.send_work = false;
    await openClass();
    expect((await refreshStudentWork(CID)).changed).toBe(false);
    expect((await refreshStudentWork(CID, { force: true })).changed).toBe(false);
    expect(callsTo('list_course_submissions')).toEqual([]);
    // Turned on (still on its way): read again.
    fake.on('set_course_send_work', p => ({ data: Object.assign({}, srv.course, p.p_patch), error: null }));
    setOnline(false);
    setCourseSendWork(CID, { send_work: true });
    setOnline(true);
    await quiet();
    expect(callsTo('list_course_submissions').length).toBeGreaterThan(0);
  });

  it('a class whose student page is off is sent nothing new, and its writers answer as before', async () => {
    course.student_page_enabled = false;
    await openClass();
    await refreshStudentWork(CID, { force: true });
    expect(setCourseSendWork(CID, { send_work: true })).toEqual({ ok: false });
    expect(await addStudentWorkPages(CID, MATEO, CAUSES, shrunk(1))).toEqual({ result: 'not_available' });
    expect(await deleteStudentWork(CID, NOOR, CAUSES)).toEqual({ result: 'not_available' });
    await window.v2Queue.flush();
    const work = /submission|work|paper/;
    expect(fake.calls.map(c => c.name).filter(n => work.test(n))).toEqual([]);
    expect(getStudentSubmission(CID, NOOR, CAUSES)).toBeNull();
  });

  it('shows a page through a 300-second signed link, as a blob: address, and only from this class', async () => {
    await openClass();
    const f = getStudentSubmission(CID, NOOR, CAUSES).files[0];
    const page = await openStudentWorkPage(CID, f, 'thumb');
    expect(page.url).toBe('blob:page');
    expect(signed).toEqual([{ bucket: 'student-photos', path: f.thumb_path, seconds: 300 }]);
    const other = { path: f.path.replace(CID, id(999)) };
    expect(await openStudentWorkPage(CID, other, 'page')).toBeNull();
    expect(await openStudentWorkPage(CID, { path: '../' + f.path }, 'page')).toBeNull();
    expect(signed).toHaveLength(1);
  });
});

describe('the class’s and an assessment’s settings', () => {
  it('Send Work goes up with a key and only what changed, and shows at once', async () => {
    await openClass();
    setOnline(false);
    expect(setCourseSendWork(CID, { keep_photos_until: 'end_of_term' })).toEqual({ ok: true });
    expect(getCourseSendWork(CID)).toEqual({ send_work: true, keep_photos_until: 'end_of_term' });
    fake.on('set_course_send_work', p => {
      Object.assign(srv.course, p.p_patch);
      return { data: Object.assign({}, srv.course), error: null };
    });
    setOnline(true);
    await quiet();
    const [call] = callsTo('set_course_send_work');
    expect(call.p_course_id).toBe(CID);
    expect(call.p_patch).toEqual({ keep_photos_until: 'end_of_term' });
    expect(call.p_idempotency_key).toMatch(UUID);
    expect(getCourseSendWork(CID).keep_photos_until).toBe('end_of_term');
  });

  it('the Student Work card sends only the choices that differ, and Until with its date', async () => {
    await openClass();
    fake.on('set_assessment_student_work', p => ({
      data: Object.assign({ id: p.p_assessment_id }, p.p_patch),
      error: null,
    }));
    const w = Object.assign({}, getAssessmentStudentWork(CID, WEEK1), {
      students_send: 'photos_files',
      after_due: 'until',
      accept_until: '2026-09-30',
    });
    expect(saveAssessmentStudentWork(CID, WEEK1, w)).toEqual({ ok: true });
    expect(getAssessmentStudentWork(CID, WEEK1)).toMatchObject({
      students_send: 'photos_files',
      accept_until: '2026-09-30',
    });
    // Nothing changed: nothing sent.
    expect(saveAssessmentStudentWork(CID, CAUSES, getAssessmentStudentWork(CID, CAUSES))).toEqual({ ok: true });
    await quiet();
    expect(callsTo('set_assessment_student_work').map(p => [p.p_assessment_id, p.p_patch])).toEqual([
      [WEEK1, { students_send: 'photos_files', after_due: 'until', accept_until: '2026-09-30' }],
    ]);
  });
});

describe('Add Work', () => {
  it('starts, uploads each page and thumbnail to the path named, then hands them in, in order', async () => {
    await openClass();
    const res = await addStudentWorkPages(CID, MATEO, CAUSES, shrunk(2));
    expect(res.result).toBe('sent');
    await quiet();
    const [start] = callsTo('start_work_upload');
    expect(start).toMatchObject({ p_assessment_id: CAUSES, p_enrollment_id: MATEO, p_mode: 'new' });
    expect(start.p_pages).toHaveLength(2);
    expect(start.p_idempotency_key).toMatch(UUID);
    const sub = Object.keys(started)[0];
    const named = started[sub].files.flatMap(f => [f.path, f.thumb_path]);
    expect(uploads.map(u => u.path).sort()).toEqual(named.sort());
    expect(uploads.every(u => u.bucket === 'student-photos' && u.type === 'image/jpeg' && u.upsert === false)).toBe(
      true,
    );
    const [finish] = callsTo('finish_work_upload');
    expect(finish.p_submission_id).toBe(sub);
    expect(finish.p_files).toEqual(
      started[sub].files.map((f, i) => ({ file_id: f.file_id, sha256: shrunk(2)[i].hash })),
    );
    expect(finish.p_idempotency_key).toMatch(UUID);
    expect(store.count()).toBe(0);
    expect(getStudentSubmission(CID, MATEO, CAUSES).id).toBe(sub);
    expect(GraderWork.workStateOf(CID, CAUSES, MATEO)).toBe('tograde');
  });

  it('offline, the pages wait on the device and show from the queue; they go when it is back', async () => {
    await openClass();
    _WORK_START_WAIT_MS = 0;
    setOnline(false);
    expect((await addStudentWorkPages(CID, MATEO, CAUSES, shrunk(1))).result).toBe('sent');
    const shown = getStudentSubmission(CID, MATEO, CAUSES);
    expect(shown.sent_by).toBe('teacher');
    expect(shown.files[0].path).toMatch(/^photo-queue:p/);
    expect(callsTo('start_work_upload')).toEqual([]);
    expect(getSyncDotState().status).toBe('error');
    setOnline(true);
    await quiet();
    expect(callsTo('finish_work_upload')).toHaveLength(1);
    expect(store.count()).toBe(0);
    expect(getStudentSubmission(CID, MATEO, CAUSES).files[0].path).toMatch(/\.jpg$/);
  });

  it('when the student sent first, the photos are dropped and the screen is told', async () => {
    await openClass();
    const theirs = sent(MATEO, CAUSES, 1);
    fake.on('start_work_upload', () => ({ data: { result: 'already_sent', submission: theirs }, error: null }));
    const res = await addStudentWorkPages(CID, MATEO, CAUSES, shrunk(1));
    expect(res.result).toBe('already_sent');
    expect(res.submission.id).toBe(theirs.id);
    expect(store.count()).toBe(0);
    expect(callsTo('finish_work_upload')).toEqual([]);
  });

  it('refused after the screen said sent, the photos are kept: held when the class is full, tried again, and on the sync dot only', async () => {
    await openClass();
    _WORK_START_WAIT_MS = 0;
    setOnline(false);
    expect((await addStudentWorkPages(CID, MATEO, CAUSES, shrunk(1))).result).toBe('sent');
    fake.on('start_work_upload', () => ({ data: { result: 'class_full' }, error: null }));
    setOnline(true);
    await quiet();
    expect(store.count()).toBe(1); // the page waits on the device
    expect(getStudentSubmission(CID, MATEO, CAUSES).files[0].path).toMatch(/^photo-queue:p/);
    expect(getSyncDotState()).toEqual({ status: 'error', title: "Some photos couldn't be sent" });
    // Room again: the sync dot's click (or the next page open) tries it again, under a new key.
    fake.on('start_work_upload', answerStart);
    retryHeldStudentWork();
    await quiet();
    const starts = callsTo('start_work_upload');
    expect(starts).toHaveLength(2);
    expect(starts[1].p_idempotency_key).not.toBe(starts[0].p_idempotency_key);
    expect(callsTo('finish_work_upload')).toHaveLength(1);
    expect(store.count()).toBe(0);
    expect(getSyncDotState().status).toBe('idle');
  });

  it('refused after the screen said sent because the student sent first, the sync dot says so', async () => {
    await openClass();
    _WORK_START_WAIT_MS = 0;
    setOnline(false);
    await addStudentWorkPages(CID, MATEO, CAUSES, shrunk(1));
    const theirs = sent(MATEO, CAUSES, 1);
    fake.on('start_work_upload', () => ({ data: { result: 'already_sent', submission: theirs }, error: null }));
    setOnline(true);
    await quiet();
    expect(store.count()).toBe(0);
    expect(getSyncDotState()).toEqual({ status: 'error', title: "Some photos couldn't be added" });
    retryHeldStudentWork(); // the click clears it
    expect(getSyncDotState().status).toBe('idle');
  });

  it('an upload the server let go of is started again with a new key, and its pages go to the new paths', async () => {
    await openClass();
    fake.on('finish_work_upload', (p, n) => (n === 1 ? { data: { result: 'gone' }, error: null } : answerFinish(p)));
    await addStudentWorkPages(CID, MATEO, CAUSES, shrunk(1));
    await quiet();
    const starts = callsTo('start_work_upload');
    expect(starts).toHaveLength(2);
    expect(starts[0].p_idempotency_key).not.toBe(starts[1].p_idempotency_key);
    const finishes = callsTo('finish_work_upload');
    expect(finishes).toHaveLength(2);
    expect(finishes[1].p_submission_id).not.toBe(finishes[0].p_submission_id);
    const last = started[finishes[1].p_submission_id].files[0];
    expect(uploads.map(u => u.path)).toEqual(expect.arrayContaining([last.path, last.thumb_path]));
    expect(store.count()).toBe(0);
  });
});

describe('Delete Work and Handed In on Paper', () => {
  it('Delete Work sends delete_submission for the work that is in, and it is gone at once', async () => {
    await openClass();
    const sub = getStudentSubmission(CID, NOOR, CAUSES);
    setOnline(false);
    expect(await GraderWork.deleteWork(CID, NOOR, CAUSES)).toEqual({ result: 'deleted', pages: 2 });
    expect(getStudentSubmission(CID, NOOR, CAUSES)).toBeNull();
    fake.on('delete_submission', () => ({ data: { deleted: true, pages: 2 }, error: null }));
    srv.submissions = [];
    setOnline(true);
    await quiet();
    expect(callsTo('delete_submission').map(p => p.p_submission_id)).toEqual([sub.id]);
    expect(getStudentSubmission(CID, NOOR, CAUSES)).toBeNull();
  });

  it('Handed In on Paper goes up for the students with nothing in', async () => {
    await openClass();
    fake.on('mark_handed_in_paper', () => ({ data: { marked: 1, submissions: [] }, error: null }));
    const res = await markStudentWorkOnPaper(CID, CAUSES, [NOOR, MATEO]);
    expect(res).toMatchObject({ result: 'sent', marked: 1 });
    expect(getStudentSubmission(CID, MATEO, CAUSES).on_paper).toBe(true);
    await quiet();
    expect(callsTo('mark_handed_in_paper').map(p => p.p_enrollment_ids)).toEqual([[MATEO]]);
  });
});
