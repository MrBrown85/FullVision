/**
 * Work a teacher adds (shared/data.js, "Student work" › "Work a teacher
 * adds"): Add Work, Add as More Pages, Replace Them, Handed In on Paper, and
 * an address for a page whether it is a sample file or a photo still in the
 * photo queue. Shapes follow batch-b-contract.md's start_work_upload +
 * finish_work_upload and mark_handed_in_paper; nothing is sent anywhere.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
const queueSource = readFileSync('shared/photo-queue.js', 'utf-8');
let wasDemo;
let store;
let realUrl;

// An in-memory stand-in for the queue's IndexedDB store.
function memoryStore() {
  const metas = new Map();
  const files = new Map();
  const copy = v => JSON.parse(JSON.stringify(v));
  const s = {
    beforePut: null,
    async list() {
      return [...metas.values()].map(copy);
    },
    async putAll(items) {
      if (s.beforePut) await s.beforePut(items);
      items.forEach(i => {
        metas.set(i.meta.id, copy(i.meta));
        files.set(i.meta.id, { photo: i.photo, thumb: i.thumb });
      });
    },
    async update(id, patch) {
      if (metas.has(id)) metas.set(id, window.PhotoQueue.applyPatch(copy(metas.get(id)), copy(patch)));
    },
    async blobs(id) {
      return files.get(id) || null;
    },
    async remove(ids) {
      ids.forEach(id => {
        metas.delete(id);
        files.delete(id);
      });
    },
    async clear() {
      metas.clear();
      files.clear();
    },
    count: () => metas.size,
    ids: () => [...metas.keys()],
    peek: id => (metas.has(id) ? copy(metas.get(id)) : null),
  };
  return s;
}

function shrunk(n, tag = 'p') {
  return Array.from({ length: n }, (_, i) => ({
    blob: new Blob([tag + i + '-page-bytes'], { type: 'image/jpeg' }),
    thumb: new Blob([tag + i + '-t'], { type: 'image/jpeg' }),
    hash: String(i).padStart(64, 'a'),
    width: 1500,
    height: 2000,
  }));
}

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  realUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
});

afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
  URL.createObjectURL = realUrl.create;
  URL.revokeObjectURL = realUrl.revoke;
});

beforeEach(() => {
  seedDemo();
  runInThisContext(queueSource, { filename: 'shared/photo-queue.js' });
  store = memoryStore();
  window.PhotoQueue.configure({ store, isDemo: () => window.isDemoMode(), upload: async () => ({ error: null }) });
});

afterEach(() => {
  window.PhotoQueue.release();
  window.PhotoQueue = undefined;
  vi.restoreAllMocks();
});

describe('signed in: nothing yet', () => {
  it('each answers not_available, stores nothing and calls nothing', async () => {
    window.isDemoMode = () => false;
    const add = vi.spyOn(window.PhotoQueue, 'add');
    const rpc = vi.fn();
    globalThis.getSupabase = rpc;
    expect(await addStudentWorkPages(CID, 'st11', LAB, shrunk(1))).toEqual({ result: 'not_available' });
    expect(await addStudentWorkPages(CID, 'st1', LAB, shrunk(1), { mode: 'add' })).toEqual({
      result: 'not_available',
    });
    expect(await replaceStudentWorkPages(CID, 'st1', LAB, shrunk(1))).toEqual({ result: 'not_available' });
    expect(await markStudentWorkOnPaper(CID, LAB, ['st11'])).toEqual({
      result: 'not_available',
      marked: 0,
      submissions: [],
    });
    expect(await openStudentWorkPage(CID, { path: 'cell-lab-cece-1.jpg' }, 'page')).toBeNull();
    expect(add).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(store.count()).toBe(0);
    delete globalThis.getSupabase;
  });
});

describe('Add Work for a student with nothing in', () => {
  it('records the pages as the teacher’s work, handed in, with the photos kept in the queue', async () => {
    expect(getStudentSubmission(CID, 'st11', LAB)).toBeNull();
    const res = await addStudentWorkPages(CID, 'st11', LAB, shrunk(2));
    expect(res.result).toBe('sent');
    expect(res.submission).toMatchObject({
      assessment_id: LAB,
      enrollment_id: 'st11',
      version: 1,
      state: 'sent',
      sent_by: 'teacher',
      on_paper: false,
      is_late: false,
      note: null,
    });
    expect(res.submission.files.map(f => f.page)).toEqual([1, 2]);
    res.submission.files.forEach(f => {
      expect(f.added_by).toBe('teacher');
      expect(f.path).toBe('photo-queue:' + f.id);
      expect(f.thumb_path).toBe('photo-queue:' + f.id + ':thumb');
      expect(store.peek(f.id)).toMatchObject({
        ids: { course: CID, assessment: LAB, enrollment: 'st11', submission: res.submission.id, file: f.id },
      });
    });
    expect(store.count()).toBe(2);
    // Read back as any other work is, and kept across a reload of the cache.
    _studentWork = {};
    expect(getStudentSubmission(CID, 'st11', LAB)).toEqual(res.submission);
    // The queue never sends in Demo Mode.
    expect((await window.PhotoQueue.send()).note).toBe('demo');
  });

  it('answers already_sent with what is in, and keeps no photo', async () => {
    const res = await addStudentWorkPages(CID, 'st1', LAB, shrunk(1));
    expect(res).toEqual({ result: 'already_sent', submission: getStudentSubmission(CID, 'st1', LAB) });
    expect(store.count()).toBe(0);
  });

  it('refuses more than 30 pages, a student or piece not in the class, and pages that are not shrunk', async () => {
    const add = vi.spyOn(window.PhotoQueue, 'add');
    expect(await addStudentWorkPages(CID, 'st11', LAB, shrunk(31))).toEqual({ result: 'too_many_pages', room: 30 });
    expect(await addStudentWorkPages(CID, 'nobody', LAB, shrunk(1))).toEqual({ result: 'not_found' });
    expect(await addStudentWorkPages(CID, 'st11', 'nopiece', shrunk(1))).toEqual({ result: 'not_found' });
    expect(await addStudentWorkPages(CID, 'st11', LAB, [])).toEqual({ result: 'invalid' });
    expect(await addStudentWorkPages(CID, 'st11', LAB, [{ blob: new Blob([]), thumb: new Blob(['x']) }])).toEqual({
      result: 'invalid',
    });
    expect(add).not.toHaveBeenCalled();
    expect(store.count()).toBe(0);
    expect(getStudentSubmission(CID, 'st11', LAB)).toBeNull();
  });

  it('two at once: the second is told work is in, and its photos are never kept', async () => {
    const add = vi.spyOn(window.PhotoQueue, 'add');
    const [a, b] = await Promise.all([
      addStudentWorkPages(CID, 'st11', LAB, shrunk(1, 'a')),
      addStudentWorkPages(CID, 'st11', LAB, shrunk(2, 'b')),
    ]);
    expect(a.result).toBe('sent');
    expect(b.result).toBe('already_sent');
    expect(b.submission.id).toBe(a.submission.id);
    // The second waited for the first, so it never stored its photos.
    expect(add).toHaveBeenCalledTimes(1);
    expect(store.count()).toBe(1);
  });

  it('work that arrives while the photos are being kept wins, and those photos are dropped', async () => {
    store.beforePut = async () => {
      // The student sends (another tab) while this device keeps the photos.
      const raw = JSON.parse(localStorage.getItem('gb-student-work-' + CID));
      raw.submissions.push({
        id: 'other',
        assessment_id: LAB,
        enrollment_id: 'st11',
        version: 1,
        state: 'sent',
        sent_by: 'student',
        on_paper: false,
        is_late: false,
        note: null,
        followed_plan: null,
        files: [],
      });
      localStorage.setItem('gb-student-work-' + CID, JSON.stringify(raw));
    };
    const res = await addStudentWorkPages(CID, 'st11', LAB, shrunk(2));
    expect(res.result).toBe('already_sent');
    expect(res.submission.id).toBe('other');
    expect(store.count()).toBe(0);
  });

  it('a full device is answered, and nothing is recorded', async () => {
    store.beforePut = async () => {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    };
    expect(await addStudentWorkPages(CID, 'st11', LAB, shrunk(1))).toEqual({ result: 'storage_full' });
    expect(getStudentSubmission(CID, 'st11', LAB)).toBeNull();
  });

  it('with no photo store loaded, says so', async () => {
    window.PhotoQueue.release();
    window.PhotoQueue = undefined;
    expect(await addStudentWorkPages(CID, 'st11', LAB, shrunk(1))).toEqual({ result: 'no_photo_store' });
    runInThisContext(queueSource, { filename: 'shared/photo-queue.js' });
  });
});

describe('Add as More Pages', () => {
  it('puts the teacher’s pages after the student’s, and the work stays the student’s', async () => {
    const before = getStudentSubmission(CID, 'st3', LAB);
    const res = await addStudentWorkPages(CID, 'st3', LAB, shrunk(2), { mode: 'add' });
    expect(res.result).toBe('sent');
    const after = res.submission;
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({ sent_by: 'student', note: before.note, is_late: before.is_late });
    const n = before.files.length;
    expect(after.files.map(f => f.page)).toEqual(Array.from({ length: n + 2 }, (_, i) => i + 1));
    expect(after.files.slice(0, n)).toEqual(before.files);
    expect(after.files.slice(n).map(f => f.added_by)).toEqual(['teacher', 'teacher']);
    expect(store.ids().sort()).toEqual(
      after.files
        .slice(n)
        .map(f => f.id)
        .sort(),
    );
  });

  it('answers nothing_sent, on_paper and too_many_pages (with the room left)', async () => {
    expect(await addStudentWorkPages(CID, 'st11', LAB, shrunk(1), { mode: 'add' })).toEqual({
      result: 'nothing_sent',
    });
    expect(await addStudentWorkPages(CID, 'st6', LAB, shrunk(1), { mode: 'add' })).toEqual({
      result: 'on_paper',
      submission: getStudentSubmission(CID, 'st6', LAB),
    });
    const have = getStudentSubmission(CID, 'st2', LAB).files.length;
    expect(await addStudentWorkPages(CID, 'st2', LAB, shrunk(31 - have), { mode: 'add' })).toEqual({
      result: 'too_many_pages',
      room: 30 - have,
    });
    expect((await addStudentWorkPages(CID, 'st2', LAB, shrunk(30 - have), { mode: 'add' })).result).toBe('sent');
    expect(getStudentSubmission(CID, 'st2', LAB).files).toHaveLength(30);
  });
});

describe('Replace Them', () => {
  it('takes the place of every page, the student’s among them, as the teacher’s work', async () => {
    const before = getStudentSubmission(CID, 'st2', LAB);
    const res = await replaceStudentWorkPages(CID, 'st2', LAB, shrunk(1));
    expect(res.result).toBe('sent');
    expect(res.submission.id).not.toBe(before.id);
    expect(res.submission).toMatchObject({ sent_by: 'teacher', on_paper: false, version: before.version, note: null });
    expect(res.submission.files).toHaveLength(1);
    expect(res.submission.files[0].added_by).toBe('teacher');
    expect(getCourseSubmissions(CID).submissions.filter(s => s.enrollment_id === 'st2')).toHaveLength(1);
  });

  it('replaces a paper hand-in, and lets go of photos it replaced', async () => {
    const first = await replaceStudentWorkPages(CID, 'st6', LAB, shrunk(2, 'a'));
    expect(first.submission.on_paper).toBe(false);
    expect(store.count()).toBe(2);
    const second = await replaceStudentWorkPages(CID, 'st6', LAB, shrunk(1, 'b'));
    expect(second.result).toBe('sent');
    expect(store.ids()).toEqual([second.submission.files[0].id]);
  });

  it('answers nothing_sent with nothing in, and refuses more than 30 pages', async () => {
    expect(await replaceStudentWorkPages(CID, 'st11', LAB, shrunk(1))).toEqual({ result: 'nothing_sent' });
    expect(await replaceStudentWorkPages(CID, 'st1', LAB, shrunk(31))).toEqual({ result: 'too_many_pages', room: 30 });
    expect(store.count()).toBe(0);
  });
});

describe('Handed In on Paper', () => {
  it('marks students with nothing in, once each, and passes over the rest', async () => {
    const res = await markStudentWorkOnPaper(CID, LAB, ['st11', 'st1', 'nobody', 'st11']);
    expect(res.result).toBe('sent');
    expect(res.marked).toBe(1);
    expect(res.submissions).toHaveLength(1);
    expect(res.submissions[0]).toMatchObject({
      enrollment_id: 'st11',
      sent_by: 'teacher',
      on_paper: true,
      files: [],
      state: 'sent',
    });
    expect(getStudentSubmission(CID, 'st11', LAB)).toEqual(res.submissions[0]);
    expect(getStudentSubmission(CID, 'st1', LAB).on_paper).toBe(false);
    expect((await markStudentWorkOnPaper(CID, LAB, ['st11'])).marked).toBe(0);
  });

  it('works on a piece that takes nothing, in a class with Send Work off', async () => {
    expect(getCourseSendWork(CID).send_work).toBe(false);
    const other = getAssessments(CID).find(a => a.id !== LAB).id;
    expect(getAssessmentStudentWork(CID, other).students_send).toBe('nothing');
    expect((await markStudentWorkOnPaper(CID, other, ['st1'])).marked).toBe(1);
  });
});

describe('openStudentWorkPage', () => {
  let made;
  let revoked;
  beforeEach(() => {
    made = [];
    revoked = [];
    URL.createObjectURL = blob => {
      made.push(blob);
      return 'blob:test-' + made.length;
    };
    URL.revokeObjectURL = url => revoked.push(url);
  });

  it('gives a sample page its file address, with a release that does nothing', async () => {
    const f = getStudentSubmission(CID, 'st1', LAB).files[0];
    const page = await openStudentWorkPage(CID, f, 'page');
    expect(page.url).toBe('/assets/sample-work/' + f.path);
    page.release();
    expect((await openStudentWorkPage(CID, f, 'thumb')).url).toBe('/assets/sample-work/' + f.thumb_path);
    expect(made).toEqual([]);
    expect(revoked).toEqual([]);
  });

  it('shows a photo still in the queue, and lets its address go once', async () => {
    const res = await addStudentWorkPages(CID, 'st11', LAB, shrunk(1));
    const f = res.submission.files[0];
    const page = await openStudentWorkPage(CID, f, 'page');
    expect(page.url).toBe('blob:test-1');
    expect(made[0].size).toBe(store.peek(f.id).bytes);
    const thumb = await openStudentWorkPage(CID, f, 'thumb');
    expect(made[1].size).toBe(store.peek(f.id).thumb_bytes);
    page.release();
    page.release();
    thumb.release();
    expect(revoked).toEqual(['blob:test-1', 'blob:test-2']);
  });

  it('answers null for a photo no longer in the queue, a mismatched part, or anything else', async () => {
    const res = await addStudentWorkPages(CID, 'st11', LAB, shrunk(1));
    const f = res.submission.files[0];
    expect(await openStudentWorkPage(CID, { path: f.thumb_path }, 'page')).toBeNull();
    expect(await openStudentWorkPage(CID, { thumb_path: f.path }, 'thumb')).toBeNull();
    await window.PhotoQueue.remove(f.id);
    expect(await openStudentWorkPage(CID, f, 'page')).toBeNull();
    expect(await openStudentWorkPage(CID, { path: 'photo-queue:../x' }, 'page')).toBeNull();
    expect(await openStudentWorkPage(CID, { path: 'https://example.com/a.jpg' }, 'page')).toBeNull();
    expect(await openStudentWorkPage(CID, null, 'page')).toBeNull();
    expect(made).toEqual([]);
  });
});

describe('an offline student or assessment gets its server id', () => {
  it('data.js listens for the re-key', () => {
    // The test page's document has no events, so read the hook from the source.
    expect(readFileSync('shared/data.js', 'utf-8')).toContain(
      "document.addEventListener('fv:id-rekeyed', _studentWorkRekeyed);",
    );
  });

  it('the photos waiting for it take the new id; other kinds are not the queue’s', async () => {
    const res = await addStudentWorkPages(CID, 'st11', LAB, shrunk(1));
    const id = res.submission.files[0].id;
    const server = '11111111-2222-4333-8444-555555555555';
    await _studentWorkRekeyed({ detail: { cid: CID, kind: 'assessment', from: LAB, to: server } });
    expect(store.peek(id).ids.assessment).toBe(server);
    await _studentWorkRekeyed({
      detail: { cid: CID, kind: 'tag', from: 'st11', to: '21111111-2222-4333-8444-555555555555' },
    });
    expect(store.peek(id).ids.enrollment).toBe('st11');
    await _studentWorkRekeyed({
      detail: { cid: CID, kind: 'student', from: 'st11', to: '31111111-2222-4333-8444-555555555555' },
    });
    expect(store.peek(id).ids.enrollment).toBe('31111111-2222-4333-8444-555555555555');
  });
});

describe('nothing reaches the server, and the phone has the photo modules', () => {
  it('data.js names none of the Add Work functions the server will have', () => {
    const src = readFileSync('shared/data.js', 'utf-8');
    // Named in comments only, never as a call.
    expect(src).not.toMatch(
      /['"`](start_work_upload|finish_work_upload|mark_handed_in_paper|delete_submission|sweep)['"`]/,
    );
  });

  it('the phone, its offline copy and its tests load photo-shrink.js and photo-queue.js', () => {
    const phone = readFileSync('teacher-mobile/index.html', 'utf-8');
    const sw = readFileSync('sw.js', 'utf-8');
    const setup = readFileSync('tests/setup-mobile.js', 'utf-8');
    ['photo-shrink.js', 'photo-queue.js'].forEach(f => {
      expect(phone).toContain('<script src="../shared/' + f + '"></script>');
      expect(sw).toContain("'/shared/" + f + "'");
      expect(setup).toContain("load('shared/" + f + "')");
    });
    // Before the phone's own modules, which use them.
    expect(phone.indexOf('photo-queue.js')).toBeLessThan(phone.indexOf('teacher-mobile/components.js'));
  });
});
