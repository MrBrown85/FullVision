/**
 * A PDF handout also keeps the original PDF (shared/data-handout-files.js, "A PDF handout's original";
 * migrations/2026112408_handout_pdf_original.sql; teacher/page-assignments.js).
 *
 * Demo Mode: the original waits in the photo queue beside the pages, never sent, and opens from there;
 * Remove takes it off the device with the pages. A handout added without one is exactly as before.
 *
 * Signed in, in a class whose student page is on: the pages go first (start_handout_upload, each page,
 * finish_handout_upload); then start_handout_original (keyed), the one file to <class>/<resource>.pdf in
 * handout-files typed application/pdf and never upsert, and finish_handout_original. Any refusal, a name
 * that is not its own, an answer of dropped or bad, gives the original up quietly: the handout stays and
 * works from its pages, and nothing is counted on the sync dot.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';
import { syntheticClass } from './eval-fixture.js';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});
const queueSource = readFileSync(resolve(root, 'shared/photo-queue.js'), 'utf-8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    metas: () => [...metas.values()].map(copy),
  };
}

function shrunk(n) {
  return Array.from({ length: n }, (_, i) => ({
    blob: new Blob(['page' + i], { type: 'image/jpeg' }),
    thumb: new Blob(['t' + i], { type: 'image/jpeg' }),
    hash: String(i).repeat(64).slice(0, 64),
    width: 1545,
    height: 2000,
  }));
}
const pdfFile = (text = '%PDF-1.4 the real file') => new Blob([text], { type: 'application/pdf' });

describe('in Demo Mode', () => {
  const CID = 'ho-demo';
  const AID = 'ho-density';
  let store;
  let wasDemo;
  let wasUrl;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T18:00:00Z'));
    wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
    wasUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = () => 'blob:handout';
    URL.revokeObjectURL = () => {};
    localStorage.clear();
    clearClass(CID);
    seedClass(CID, {
      students: [{ id: 'ho-cece', firstName: 'Cece', lastName: 'Lee' }],
      assessments: [
        { id: AID, title: 'Density Lab', date: '2026-11-24', dueDate: '2026-12-01', type: 'summative', tagIds: [] },
      ],
      courseConfigs: { student_page_enabled: true },
    });
    COURSES[CID] = { id: CID, name: 'Science 8', block: 'A', gradingSystem: 'proficiency', gradeLevel: '8' };
    runInThisContext(queueSource, { filename: 'shared/photo-queue.js' });
    store = memoryStore();
    window.PhotoQueue.configure({ store });
  });

  afterEach(() => {
    window.PhotoQueue.release();
    window.isDemoMode = wasDemo;
    URL.createObjectURL = wasUrl.create;
    URL.revokeObjectURL = wasUrl.revoke;
    clearClass(CID);
    localStorage.clear();
    vi.useRealTimers();
  });

  it('keeps the original beside the pages on this device, and opens it', async () => {
    const h = await addAssessmentHandout(CID, AID, 'Instructions', shrunk(2), pdfFile());
    expect(h.ok).toBe(true);
    expect(getAssessmentResources(CID, AID)[0]).toMatchObject({ kind: 'pdf', pageCount: 2, hasOriginal: true });
    expect(store.metas().map(m => [m.kind, m.mime || null])).toEqual([
      ['handout', null],
      ['handout', null],
      ['handout', 'application/pdf'],
    ]);
    // Never sent in Demo Mode.
    expect((await window.PhotoQueue.send()).note).toBe('not_configured');
    const got = await openAssessmentHandoutOriginal(CID, h.resource.id);
    expect(got.title).toBe('Instructions');
    expect(got.blob.type).toBe('application/pdf');
    expect(await got.blob.text()).toBe('%PDF-1.4 the real file');
    // The pages still open as before.
    expect((await openAssessmentHandoutPage(CID, h.resource.id, 0)).url).toBe('blob:handout');
  });

  it('a handout added without one is as before: no original, nothing extra on the device', async () => {
    const h = await addAssessmentHandout(CID, AID, 'Instructions', shrunk(2));
    expect(getAssessmentResources(CID, AID)[0].hasOriginal).toBe(false);
    expect(store.count()).toBe(2);
    expect(await openAssessmentHandoutOriginal(CID, h.resource.id)).toBeNull();
  });

  it('an original over 20 MB or empty is not kept; the handout is added from its pages', async () => {
    const big = { size: 20971521, type: 'application/pdf' };
    const h = await addAssessmentHandout(CID, AID, 'Big', shrunk(1), big);
    const e = await addAssessmentHandout(CID, AID, 'Empty', shrunk(1), new Blob([], { type: 'application/pdf' }));
    expect([h.ok, e.ok]).toEqual([true, true]);
    expect(getAssessmentResources(CID, AID).map(r => r.hasOriginal)).toEqual([false, false]);
    expect(store.count()).toBe(2);
  });

  it('Remove takes the pages and the original off the device', async () => {
    const h = await addAssessmentHandout(CID, AID, 'Instructions', shrunk(2), pdfFile());
    expect(store.count()).toBe(3);
    expect((await removeAssessmentResource(CID, h.resource.id)).ok).toBe(true);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, AID)).toEqual([]);
  });
});

describe('signed in, in a class whose student page is on', () => {
  const CID = 'e0000000-0000-4000-8000-000000000001';
  const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const CAUSES = id(300);
  let fake;
  let original;
  let uploads;
  let signed;
  let seq;
  let store;
  let rows;
  let queueFailed;
  const newId = () => 'f0000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
  const callsTo = name => fake.calls.filter(c => c.name === name).map(c => c.params);
  const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
  async function openClass() {
    await initData(CID);
    await settle();
    await settle();
  }
  async function quiet() {
    for (let i = 0; i < 8; i++) {
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
    };
    _REFRESH_QUIET_MS = 0;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-a';
    _resMissing = false;
    globalThis.__FV_CLASS_BUNDLE = true;
    localStorage.clear();
    seq = 0;
    uploads = [];
    signed = [];
    rows = new Map();
    queueFailed = 0;
    fake = makeFakeSupabase();
    fake.on('get_class_bundle', () => {
      const bundle = syntheticClass();
      bundle.version = 1;
      Object.assign(bundle.gradebook.course, { student_page_enabled: true, return_grades: 'on_return' });
      return { data: bundle, error: null };
    });
    fake.on('list_course_grade_returns', () => ({ data: {}, error: null }));
    // The server's rows, as the migration keeps them.
    fake.on('list_course_resources', () => ({ data: [...rows.values()].map(r => ({ ...r })), error: null }));
    fake.on('start_handout_upload', p => {
      const rid = newId();
      const row = {
        id: rid,
        assessment_id: p.p_assessment_id,
        kind: 'pdf',
        title: p.p_title,
        url: null,
        page_count: p.p_page_count,
        status: 'uploading',
        position: rows.size + 1,
        paths: Array.from({ length: p.p_page_count }, (_, i) => `${CID}/handouts/${rid}/${i + 1}.jpg`),
      };
      rows.set(rid, row);
      return { data: { ...row, bucket: 'student-photos' }, error: null };
    });
    fake.on('finish_handout_upload', p => {
      const row = rows.get(p.p_resource_id);
      if (!row) return { data: { id: p.p_resource_id, status: 'gone' }, error: null };
      if (row.paths.every(x => uploads.some(u => u.path === x))) row.status = 'ready';
      return { data: { ...row }, error: null };
    });
    fake.on('start_handout_original', p => {
      const row = rows.get(p.p_resource_id);
      if (!row) return { data: null, error: { code: 'P0002', message: 'handout not found', status: 404 } };
      if (!row.original)
        Object.assign(row, { original: 'uploading', original_bytes: p.p_bytes, original_path: `${CID}/${row.id}.pdf` });
      return {
        data: { ...row, bucket: 'handout-files' },
        error: null,
      };
    });
    fake.on('finish_handout_original', p => {
      const row = rows.get(p.p_resource_id);
      if (!row) return { data: { id: p.p_resource_id, status: 'gone' }, error: null };
      const path = `${CID}/${row.id}.pdf`;
      if (row.original === 'uploading' && uploads.some(u => u.path === path)) row.original = 'ready';
      return {
        data: { ...row, original_path: path, ...(row.original === 'ready' ? {} : { missing: true }) },
        error: null,
      };
    });
    fake.on('remove_assessment_resource', p => ({ data: { removed: rows.delete(p.p_resource_id) }, error: null }));
    fake.storage = {
      from: bucket => ({
        upload: async (path, blob, opts) => {
          uploads.push({ bucket, path, type: opts.contentType, blobType: blob.type, upsert: opts.upsert });
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path, seconds) => {
          signed.push({ bucket, path, seconds });
          return { data: { signedUrl: 'https://x.supabase.co/sign/' + path }, error: null };
        },
      }),
    };
    globalThis.getSupabase = () => fake;
    globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['%PDF from the server']) }));
    URL.createObjectURL = () => 'blob:page';
    URL.revokeObjectURL = () => {};
    setOnline(true);
    window.v2Queue.clear();
    runInThisContext(queueSource, { filename: 'shared/photo-queue.js' });
    store = memoryStore();
    window.PhotoQueue.configure({ store });
    _workQueueWired = false;
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
    _resMissing = false;
    globalThis.__FV_CLASS_BUNDLE = false;
    setOnline(true);
    localStorage.clear();
    delete _cache.students[CID];
    delete _classVersion[CID];
  });

  it('the pages first, then the original: started with a key, uploaded as a PDF to its one name, handed in', async () => {
    await openClass();
    const res = await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(2), pdfFile());
    expect(res.ok).toBe(true);
    expect(getAssessmentResources(CID, CAUSES)[0]).toMatchObject({ status: 'uploading', hasOriginal: true });
    // Three files wait on the device: two pages and the original.
    expect(store.count()).toBe(3);
    await quiet();
    const rid = [...rows.keys()][0];
    expect(callsTo('start_handout_upload')).toHaveLength(1);
    const [start] = callsTo('start_handout_original');
    expect(start).toEqual({
      p_resource_id: rid,
      p_bytes: pdfFile().size,
      p_idempotency_key: expect.stringMatching(UUID),
    });
    // The order the server saw: pages in and finished before the original starts.
    const order = fake.calls.map(c => c.name).filter(n => /handout_(upload|original)$/.test(n));
    expect(order).toEqual([
      'start_handout_upload',
      'finish_handout_upload',
      'start_handout_original',
      'finish_handout_original',
    ]);
    const pdfUploads = uploads.filter(u => u.bucket === 'handout-files');
    expect(pdfUploads).toEqual([
      {
        bucket: 'handout-files',
        path: `${CID}/${rid}.pdf`,
        type: 'application/pdf',
        blobType: 'application/pdf',
        upsert: false,
      },
    ]);
    expect(uploads.filter(u => u.bucket === 'student-photos')).toHaveLength(2);
    const [finish] = callsTo('finish_handout_original');
    expect(finish).toEqual({ p_resource_id: rid, p_idempotency_key: expect.stringMatching(UUID) });
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, CAUSES, { ready: true })[0]).toMatchObject({
      id: rid,
      kind: 'pdf',
      pageCount: 2,
      hasOriginal: true,
    });
    // It opens through a 300-second link in handout-files, at its own name only.
    const opened = await openAssessmentHandoutOriginal(CID, rid);
    expect(opened.blob.type).toBe('application/pdf');
    expect(await opened.blob.text()).toBe('%PDF from the server');
    expect(signed).toEqual([{ bucket: 'handout-files', path: `${CID}/${rid}.pdf`, seconds: 300 }]);
    // A read of the class keeps it.
    await refreshAssessmentResources(CID, true);
    expect(getAssessmentResources(CID, CAUSES)[0].hasOriginal).toBe(true);
  });

  it('with no original the calls are exactly as before: no start_handout_original', async () => {
    await openClass();
    await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(2));
    await quiet();
    expect(callsTo('start_handout_original')).toEqual([]);
    expect(callsTo('finish_handout_original')).toEqual([]);
    expect(uploads.every(u => u.bucket === 'student-photos')).toBe(true);
    expect(getAssessmentResources(CID, CAUSES, { ready: true })[0].hasOriginal).toBe(false);
  });

  it('offline, both wait on the device; they go in order when it is back', async () => {
    await openClass();
    setOnline(false);
    await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(1), pdfFile());
    expect(callsTo('start_handout_upload')).toEqual([]);
    expect(store.count()).toBe(2);
    setOnline(true);
    await quiet();
    expect(callsTo('finish_handout_original')).toHaveLength(1);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, CAUSES, { ready: true })[0].hasOriginal).toBe(true);
  });

  it('a name that is not this class’s and this handout’s gives the original up, and the handout stays', async () => {
    await openClass();
    fake.on('start_handout_original', p => ({
      data: { id: p.p_resource_id, original: 'uploading', original_path: `${id(999)}/${p.p_resource_id}.pdf` },
      error: null,
    }));
    await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(2), pdfFile());
    await quiet();
    expect(uploads.filter(u => u.bucket === 'handout-files')).toEqual([]);
    expect(callsTo('finish_handout_original')).toEqual([]);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, CAUSES, { ready: true })).toMatchObject([{ kind: 'pdf', hasOriginal: false }]);
    expect(Object.keys(JSON.parse(localStorage.getItem('gb-handout-uploads') || '{}'))).toEqual([]);
  });

  it.each([
    ['dropped', { original: 'dropped' }],
    ['ready already', { original: 'ready' }],
  ])('a start that answers %s sends nothing and clears the device', async (_n, said) => {
    await openClass();
    fake.on('start_handout_original', p => ({
      data: { id: p.p_resource_id, original_path: `${CID}/${p.p_resource_id}.pdf`, ...said },
      error: null,
    }));
    await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(1), pdfFile());
    await quiet();
    expect(uploads.filter(u => u.bucket === 'handout-files')).toEqual([]);
    expect(store.count()).toBe(0);
  });

  it('a start the server refuses gives the original up quietly: the handout stays, nothing on the sync dot', async () => {
    await openClass();
    fake.on('start_handout_original', () => ({
      data: null,
      error: { code: '22023', message: 'a PDF can be 20 MB at most', status: 400 },
    }));
    await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(2), pdfFile());
    await quiet();
    expect(store.count()).toBe(0);
    expect(uploads.filter(u => u.bucket === 'handout-files')).toEqual([]);
    expect(getAssessmentResources(CID, CAUSES, { ready: true })).toMatchObject([{ kind: 'pdf', status: 'ready' }]);
    expect(getAssessmentResources(CID, CAUSES, { ready: true })[0].hasOriginal).toBe(false);
    expect(callsTo('remove_assessment_resource')).toEqual([]);
  });

  it('a file the server finds of another type or size, or gone, is given up; the handout stays', async () => {
    await openClass();
    fake.on('finish_handout_original', p => ({ data: { ...rows.get(p.p_resource_id), bad: true }, error: null }));
    await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(1), pdfFile());
    await quiet();
    expect(callsTo('finish_handout_original')).toHaveLength(1);
    expect(callsTo('remove_assessment_resource')).toEqual([]);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, CAUSES, { ready: true })[0]).toMatchObject({ kind: 'pdf', hasOriginal: false });
  });

  it('missing in storage: the one file goes again', async () => {
    await openClass();
    let tries = 0;
    fake.on('finish_handout_original', p => {
      tries += 1;
      const row = rows.get(p.p_resource_id);
      if (tries === 1) return { data: { ...row, original_path: `${CID}/${row.id}.pdf`, missing: true }, error: null };
      row.original = 'ready';
      return { data: { ...row, original_path: `${CID}/${row.id}.pdf` }, error: null };
    });
    await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(1), pdfFile());
    await quiet();
    for (let i = 0; i < 3; i++) {
      await window.PhotoQueue.send({ force: true });
      await settle();
    }
    expect(tries).toBe(2);
    expect(uploads.filter(u => u.bucket === 'handout-files').length).toBe(2);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, CAUSES, { ready: true })[0].hasOriginal).toBe(true);
  });

  it('Remove while the original waits: it leaves the device and nothing is sent for it', async () => {
    await openClass();
    setOnline(false);
    const res = await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(1), pdfFile());
    expect(store.count()).toBe(2);
    await removeAssessmentResource(CID, res.resource.id);
    expect(store.count()).toBe(0);
    setOnline(true);
    await quiet();
    expect(callsTo('start_handout_original')).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it('a pages upload the server refuses takes the waiting original with it', async () => {
    await openClass();
    fake.on('start_handout_upload', p => {
      const rid = newId();
      return {
        data: {
          id: rid,
          paths: Array.from({ length: p.p_page_count }, (_, i) => `${id(999)}/handouts/${rid}/${i + 1}.jpg`),
        },
        error: null,
      };
    });
    await addAssessmentHandout(CID, CAUSES, 'Density Lab', shrunk(1), pdfFile());
    await quiet();
    expect(store.count()).toBe(0);
    expect(callsTo('start_handout_original')).toEqual([]);
  });

  it('an original read from the server is opened only at its own name', async () => {
    await openClass();
    const rid = newId();
    rows.set(rid, {
      id: rid,
      assessment_id: CAUSES,
      kind: 'pdf',
      title: 'Worksheet',
      url: null,
      page_count: 1,
      status: 'ready',
      position: 1,
      paths: [`${CID}/handouts/${rid}/1.jpg`],
      original: 'ready',
      original_path: `${CID}/${rid}.pdf`,
      original_bytes: 1000,
    });
    const other = newId();
    rows.set(other, { ...rows.get(rid), id: other, original_path: `${id(999)}/${other}.pdf` });
    const older = newId();
    const { original: _o, original_path: _p, original_bytes: _b, ...plain } = rows.get(rid);
    rows.set(older, { ...plain, id: older });
    await refreshAssessmentResources(CID, true);
    const got = getAssessmentResources(CID, CAUSES);
    expect(got.map(r => r.hasOriginal)).toEqual([true, true, false]);
    expect((await openAssessmentHandoutOriginal(CID, rid)).title).toBe('Worksheet');
    expect(await openAssessmentHandoutOriginal(CID, other)).toBeNull();
    expect(await openAssessmentHandoutOriginal(CID, older)).toBeNull();
    expect(signed).toEqual([{ bucket: 'handout-files', path: `${CID}/${rid}.pdf`, seconds: 300 }]);
  });
});
