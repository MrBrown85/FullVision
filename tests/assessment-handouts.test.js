/**
 * Handouts and Links (shared/data.js "Handouts and Links", shared/photo-
 * queue.js addHandout, shared/student-view.js, s/page-view.js; boards 3a
 * and 3b of the Assessment Form canvas; handouts-links-contract.md).
 *
 * Demo Mode: a link and a handout are kept on this device (the handout's
 * pages in the photo queue, which never sends there), shown to the student
 * through Preview as Student's view, and taken off again.
 *
 * Signed in, in a class whose student page is on: add_assessment_link,
 * start_handout_upload, each page to the path the server named (no
 * thumbnail), finish_handout_upload under the batch's key, and
 * remove_assessment_resource, every write with an idempotency key, a local
 * id re-keyed when its create lands. A path that is not this class's and
 * this handout's gives the upload up. A class whose student page is off is
 * offered none of it.
 *
 * The student's page: For This Assignment under the Description, a link as
 * an http(s) address only, opening in a new tab; a handout opening in the
 * page, one page at a time.
 */
import './setup.js';
import { parseHTML } from 'linkedom';
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

describe('a link’s address', () => {
  it.each([
    ['https://www.britannica.com/science/density', 'https://www.britannica.com/science/density', 'britannica.com'],
    ['  www.youtube.com/watch?v=abc  ', 'https://www.youtube.com/watch?v=abc', 'youtube.com'],
    ['http://example.ca', 'http://example.ca/', 'example.ca'],
    ['britannica.com:443/x', 'https://britannica.com/x', 'britannica.com'],
  ])('%s is kept as %s, from %s', (typed, url, host) => {
    expect(assessmentLinkCheck(typed)).toEqual({ ok: true, url, host });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['javascript:alert(1)', 'not_web'],
    ['data:text/html,hi', 'not_web'],
    ['ftp://files.example.ca/a', 'not_web'],
    ['https://user:pw@example.ca', 'not_web'],
    ['notaurl', 'not_web'],
    ['https://example.ca/' + 'a'.repeat(2000), 'too_long'],
  ])('%s is refused as %s', (typed, reason) => {
    expect(assessmentLinkCheck(typed)).toEqual({ ok: false, reason });
  });
});

/* ── Demo Mode ─────────────────────────────────────────────── */

describe('in Demo Mode', () => {
  const CID = 'hl-demo';
  const SID = 'hl-cece';
  const AID = 'hl-density';
  let store;
  let wasDemo;
  let wasUrl;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T18:00:00Z'));
    wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
    wasUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    let n = 0;
    URL.createObjectURL = () => 'blob:handout-' + ++n;
    URL.revokeObjectURL = () => {};
    localStorage.clear();
    clearClass(CID);
    seedClass(CID, {
      students: [{ id: SID, firstName: 'Cece', lastName: 'Lee' }],
      assessments: [
        {
          id: AID,
          title: 'Density Lab Write-Up',
          description: 'Write up your density lab.',
          date: '2026-11-11',
          dueDate: '2026-11-18',
          type: 'summative',
          tagIds: [],
        },
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

  it('is offered, and keeps a link and a handout on this device in the order added', async () => {
    expect(assessmentResourcesOffered(CID)).toBe(true);
    const handout = await addAssessmentHandout(CID, AID, 'Density Lab Instructions', shrunk(3));
    expect(handout.ok).toBe(true);
    const link = await addAssessmentLink(CID, AID, 'https://www.britannica.com/science/density', 'Density');
    const plain = await addAssessmentLink(CID, AID, 'youtube.com/watch?v=x', '');
    expect([link.ok, plain.ok]).toEqual([true, true]);
    const got = getAssessmentResources(CID, AID);
    expect(got.map(r => [r.kind, r.title, r.host, r.pageCount, r.status])).toEqual([
      ['pdf', 'Density Lab Instructions', '', 3, 'ready'],
      ['link', 'Density', 'britannica.com', 0, 'ready'],
      // With no name, students see the address.
      ['link', 'youtube.com/watch?v=x', 'youtube.com', 0, 'ready'],
    ]);
    // The pages wait in the photo queue, as a handout, with no thumbnail, and are never sent.
    expect(store.metas().map(m => [m.kind, m.ids.resource, m.sent.thumb])).toEqual([
      ['handout', handout.resource.id, true],
      ['handout', handout.resource.id, true],
      ['handout', handout.resource.id, true],
    ]);
    expect((await window.PhotoQueue.send()).note).toBe('not_configured');
    expect(store.count()).toBe(3);
    // A page opens from this device.
    const page = await openAssessmentHandoutPage(CID, handout.resource.id, 1);
    expect(page.url).toMatch(/^blob:handout-/);
    expect(await openAssessmentHandoutPage(CID, handout.resource.id, 3)).toBeNull();
  });

  it('refuses a handout of more than 20 pages, or none, and an address that is not a web address', async () => {
    expect(await addAssessmentHandout(CID, AID, 'Long', shrunk(21))).toEqual({ ok: false, reason: 'too_many_pages' });
    expect(await addAssessmentHandout(CID, AID, 'None', [])).toEqual({ ok: false, reason: 'no_pages' });
    expect(await addAssessmentLink(CID, AID, 'javascript:alert(1)', 'x')).toEqual({ ok: false, reason: 'not_web' });
    expect(getAssessmentResources(CID, AID)).toEqual([]);
    expect(store.count()).toBe(0);
  });

  it('Remove takes it off, and a handout’s pages leave the device', async () => {
    const h = await addAssessmentHandout(CID, AID, 'Instructions', shrunk(2));
    const l = await addAssessmentLink(CID, AID, 'https://example.ca', 'Example');
    expect((await removeAssessmentResource(CID, h.resource.id)).ok).toBe(true);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, AID).map(r => r.id)).toEqual([l.resource.id]);
    await removeAssessmentResource(CID, l.resource.id);
    expect(getAssessmentResources(CID, AID)).toEqual([]);
  });

  it('Preview as Student’s view has them, and the card shows For This Assignment under the Description', async () => {
    await addAssessmentHandout(CID, AID, 'Density Lab Instructions', shrunk(3));
    await addAssessmentLink(CID, AID, 'https://www.britannica.com/science/density', 'Density');
    await addAssessmentLink(CID, AID, 'https://www.youtube.com/watch?v=abc', 'Measuring Density');
    const reply = StudentView.reply(CID, SID);
    expect(reply.assessments[0].resources.map(r => [r.kind, r.title, r.url, r.page_count])).toEqual([
      ['pdf', 'Density Lab Instructions', null, 3],
      ['link', 'Density', 'https://www.britannica.com/science/density', null],
      ['link', 'Measuring Density', 'https://www.youtube.com/watch?v=abc', null],
    ]);
    const built = StudentView.fromCache(CID, SID);
    expect(built.ready).toBe(true);
    const p = built.view.work.find(x => x.id === AID);
    expect(p.resources.map(r => r.kind)).toEqual(['handout', 'link', 'link']);
    const { document } = parseHTML('<main>' + StudentPageView.html(built.view, { pick: AID }) + '</main>');
    const card = document.querySelector('.sp-piece[data-piece="' + AID + '"]');
    const block = card.querySelector('.sp-res');
    expect(block.previousElementSibling.className).toBe('sp-piece-about');
    expect(block.querySelector('.sp-res-head').textContent).toBe('For This Assignment');
    const rows = [...block.querySelectorAll('.sp-res-row')];
    expect(rows.map(r => r.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Density Lab Instructions Handout · 3 pages',
      'Density britannica.com (opens in a new tab)',
      'Measuring Density youtube.com (opens in a new tab)',
    ]);
    expect(rows[0].tagName).toBe('BUTTON');
    expect(rows[0].getAttribute('data-act')).toBe('handout');
    expect(rows[1].getAttribute('href')).toBe('https://www.britannica.com/science/density');
    expect(rows[1].getAttribute('target')).toBe('_blank');
    expect(rows[1].getAttribute('rel')).toBe('noopener noreferrer');
    expect(rows[2].querySelector('.sp-res-icon-video')).toBeTruthy();
  });

  it('a handout still uploading, or one with no pages, is not shown to the student', async () => {
    const draft = { rows: [], gone: [] };
    draft.rows.push({
      id: 'r1',
      assessment_id: AID,
      kind: 'pdf',
      title: 'Up',
      page_count: 2,
      status: 'uploading',
      position: 1,
    });
    draft.rows.push({
      id: 'r2',
      assessment_id: AID,
      kind: 'pdf',
      title: 'Empty',
      page_count: 0,
      status: 'ready',
      position: 2,
    });
    localStorage.setItem('gb-assessment-resources-' + CID, JSON.stringify(draft));
    const p = StudentView.fromCache(CID, SID).view.work.find(x => x.id === AID);
    expect(p.resources).toEqual([]);
  });

  it('a handout opens in the page, one page at a time, and Back goes to its card', async () => {
    const h = await addAssessmentHandout(CID, AID, 'Density Lab Instructions', shrunk(2));
    const view = StudentView.fromCache(CID, SID).view;
    const { document } = parseHTML('<main>' + StudentPageView.html(view, { pick: AID }) + '</main>');
    const row = document.querySelector('[data-act="handout"]');
    const opened = StudentPageView.press({ pick: AID }, view, 'handout', row);
    expect(opened.handout).toEqual({ piece: AID, resource: h.resource.id });
    expect(opened.focus).toBe('#sp-handout-title');
    let ui = opened.ui;
    expect(StudentPageView.html(view, ui)).toContain('Getting the handout…');
    ui = Object.assign({}, ui, {
      handoutPages: { id: h.resource.id, state: 'ready', pages: [{ url: 'blob:one' }, { url: 'blob:two' }] },
    });
    let html = StudentPageView.html(view, ui);
    expect(html).toContain('Page 1 of 2');
    expect(html).toContain('src="blob:one"');
    expect(html).toContain('sp-on-feedback');
    // A picture that is not this page's own is never drawn.
    const bad = Object.assign({}, ui, {
      handoutPages: { id: h.resource.id, state: 'ready', pages: [{ url: 'https://evil.example/x.jpg' }] },
    });
    expect(StudentPageView.html(view, bad)).toContain('This handout can’t be shown here.');
    const next = parseHTML('<main>' + html + '</main>').document.querySelector('.sp-work-next');
    ui = StudentPageView.press(ui, view, 'handout-page', next).ui;
    html = StudentPageView.html(view, ui);
    expect(html).toContain('Page 2 of 2');
    expect(html).toContain('src="blob:two"');
    const back = StudentPageView.press(ui, view, 'handout-close', null);
    expect(back.ui.handout).toBe('');
    expect(back.focus).toBe('[data-act="handout"][data-resource="' + h.resource.id + '"]');
    // Any other press leaves it too.
    const tab = parseHTML('<main>' + html + '</main>').document.querySelector('[data-act="segment"]');
    expect(StudentPageView.press(ui, view, 'segment', tab).ui.handout).toBe('');
  });

  it('the view leaves out a link that is not an http(s) address', () => {
    const view = StudentView.fromPage(
      {
        ok: true,
        v: 1,
        student: { enrollment_id: SID, first_name: 'Cece' },
        course: { name: 'Science 8', block: 'A', grading_system: 'proficiency' },
        tags: {},
        rubrics: [],
        assessments: [
          {
            id: AID,
            title: 'Density Lab Write-Up',
            date: '2026-11-11',
            due_date: '2026-11-18',
            tag_ids: [],
            resources: [
              { id: 'x1', kind: 'link', title: 'Bad', url: 'javascript:alert(1)' },
              { id: 'x2', kind: 'link', title: 'Quote', url: 'https://a.ca/"onmouseover="x' },
              { id: 'x3', kind: 'pdf', title: 'Long', page_count: 21 },
              { id: 'x4', kind: 'link', title: '', url: 'https://www.cbc.ca/news' },
            ],
          },
        ],
      },
      null,
    );
    const p = view.work.find(x => x.id === AID);
    expect(p.resources).toEqual([
      { id: 'x4', kind: 'link', title: 'cbc.ca', url: 'https://www.cbc.ca/news', host: 'cbc.ca' },
    ]);
  });
});

/* ── Signed in ─────────────────────────────────────────────── */

describe('signed in, in a class whose student page is on', () => {
  const CID = 'e0000000-0000-4000-8000-000000000001';
  const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const CAUSES = id(300);
  let fake;
  let original;
  let course;
  let uploads;
  let signed;
  let seq;
  let store;
  let started;
  const newId = () => 'f0000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
  const callsTo = name => fake.calls.filter(c => c.name === name).map(c => c.params);
  const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });

  function serverClass() {
    const bundle = syntheticClass();
    bundle.version = 1;
    Object.assign(bundle.gradebook.course, course);
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
    };
    _REFRESH_QUIET_MS = 0;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-a';
    _resMissing = false;
    globalThis.__FV_CLASS_BUNDLE = true;
    localStorage.clear();
    seq = 0;
    started = {};
    course = { student_page_enabled: true, return_grades: 'on_return' };
    uploads = [];
    signed = [];
    fake = makeFakeSupabase();
    fake.on('get_class_bundle', () => ({ data: serverClass(), error: null }));
    fake.on('list_course_grade_returns', () => ({ data: {}, error: null }));
    // The server's rows, as the migration keeps them: list_course_resources answers them.
    const rows = new Map();
    let at = 0;
    fake.on('list_course_resources', () => ({ data: [...rows.values()].map(r => ({ ...r })), error: null }));
    fake.on('add_assessment_link', p => {
      const row = {
        id: newId(),
        assessment_id: p.p_assessment_id,
        kind: 'link',
        title: p.p_title,
        url: p.p_url,
        page_count: null,
        status: 'ready',
        position: ++at,
      };
      rows.set(row.id, row);
      return { data: { ...row }, error: null };
    });
    fake.on('remove_assessment_resource', p => ({ data: { removed: rows.delete(p.p_resource_id) }, error: null }));
    fake.on('start_handout_upload', p => {
      const rid = newId();
      const paths = Array.from({ length: p.p_page_count }, (_, i) => `${CID}/handouts/${rid}/${i + 1}.jpg`);
      started[rid] = { aid: p.p_assessment_id, paths };
      const row = {
        id: rid,
        assessment_id: p.p_assessment_id,
        kind: 'pdf',
        title: p.p_title,
        url: null,
        page_count: p.p_page_count,
        status: 'uploading',
        position: ++at,
        paths,
      };
      rows.set(rid, row);
      return { data: { ...row, bucket: 'student-photos' }, error: null };
    });
    fake.on('finish_handout_upload', p => {
      const row = rows.get(p.p_resource_id);
      if (!row) return { data: { id: p.p_resource_id, status: 'gone' }, error: null };
      const all = row.paths.every(x => uploads.some(u => u.path === x));
      if (all) row.status = 'ready';
      return { data: { ...row }, error: null };
    });
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

  it('a link goes up with a key, shows at once, and takes the server’s id when it lands', async () => {
    await openClass();
    expect(assessmentResourcesOffered(CID)).toBe(true);
    const res = await addAssessmentLink(CID, CAUSES, 'https://www.britannica.com/science/density', 'Density');
    expect(res.resource.id).toMatch(/^r/);
    expect(getAssessmentResources(CID, CAUSES)).toHaveLength(1);
    await quiet();
    const [call] = callsTo('add_assessment_link');
    expect(call).toEqual({
      p_assessment_id: CAUSES,
      p_url: 'https://www.britannica.com/science/density',
      p_title: 'Density',
      p_idempotency_key: expect.stringMatching(UUID),
    });
    const [row] = getAssessmentResources(CID, CAUSES);
    expect(row.id).toMatch(UUID);
    await removeAssessmentResource(CID, row.id);
    expect(getAssessmentResources(CID, CAUSES)).toEqual([]);
    await quiet();
    expect(callsTo('remove_assessment_resource')).toEqual([
      { p_resource_id: row.id, p_idempotency_key: expect.stringMatching(UUID) },
    ]);
  });

  it('a link removed before it landed is removed by its server id, after the add', async () => {
    await openClass();
    setOnline(false);
    const res = await addAssessmentLink(CID, CAUSES, 'https://example.ca', 'Example');
    await removeAssessmentResource(CID, res.resource.id);
    setOnline(true);
    await quiet();
    const [added] = callsTo('add_assessment_link');
    expect(added).toBeTruthy();
    const [removed] = callsTo('remove_assessment_resource');
    expect(removed.p_resource_id).toMatch(UUID);
    expect(fake.calls.map(c => c.name).filter(n => /assessment_link|resource$/.test(n))).toEqual([
      'add_assessment_link',
      'remove_assessment_resource',
    ]);
  });

  it('a handout starts, each page goes to the path named (no thumbnail), then is handed in under the batch’s key', async () => {
    await openClass();
    const res = await addAssessmentHandout(CID, CAUSES, 'Density Lab Instructions', shrunk(3));
    expect(res.ok).toBe(true);
    // Uploading: the teacher sees it, the student does not yet.
    expect(getAssessmentResources(CID, CAUSES)[0].status).toBe('uploading');
    expect(getAssessmentResources(CID, CAUSES, { ready: true })).toEqual([]);
    await quiet();
    const [start] = callsTo('start_handout_upload');
    expect(start).toEqual({
      p_assessment_id: CAUSES,
      p_title: 'Density Lab Instructions',
      p_page_count: 3,
      p_idempotency_key: expect.stringMatching(UUID),
    });
    const rid = Object.keys(started)[0];
    expect(uploads.map(u => u.path)).toEqual(started[rid].paths);
    expect(uploads.every(u => u.bucket === 'student-photos' && u.type === 'image/jpeg' && u.upsert === false)).toBe(
      true,
    );
    const [finish] = callsTo('finish_handout_upload');
    expect(finish).toEqual({ p_resource_id: rid, p_idempotency_key: expect.stringMatching(UUID) });
    expect(store.count()).toBe(0);
    const [row] = getAssessmentResources(CID, CAUSES, { ready: true });
    expect(row).toMatchObject({ id: rid, kind: 'pdf', pageCount: 3, status: 'ready' });
    // A page opens through a 300-second signed link, as a blob: address, only from this handout's folder.
    const page = await openAssessmentHandoutPage(CID, rid, 0);
    expect(page.url).toBe('blob:page');
    expect(signed).toEqual([{ bucket: 'student-photos', path: started[rid].paths[0], seconds: 300 }]);
  });

  it('paths that are not this class’s and this handout’s give the upload up, and nothing is uploaded', async () => {
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
    await addAssessmentHandout(CID, CAUSES, 'Instructions', shrunk(2));
    await quiet();
    expect(uploads).toEqual([]);
    expect(callsTo('finish_handout_upload')).toEqual([]);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, CAUSES)).toEqual([]);
  });

  it('a page the server is still missing goes again; a handout the server let go of is given up', async () => {
    await openClass();
    let tries = 0;
    fake.on('finish_handout_upload', p => {
      tries += 1;
      if (tries === 1)
        return { data: { id: p.p_resource_id, kind: 'pdf', status: 'uploading', missing: [2] }, error: null };
      return { data: { id: p.p_resource_id, status: 'gone' }, error: null };
    });
    await addAssessmentHandout(CID, CAUSES, 'Instructions', shrunk(2));
    await quiet();
    // Past the queue's wait before it tries again.
    for (let i = 0; i < 3; i++) {
      await window.PhotoQueue.send({ force: true });
      await settle();
    }
    const rid = Object.keys(started)[0];
    // Page 2 went up again; then the server had let the handout go.
    expect(uploads.filter(u => u.path === started[rid].paths[1]).length).toBe(2);
    expect(uploads.filter(u => u.path === started[rid].paths[0]).length).toBe(1);
    expect(tries).toBe(2);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, CAUSES)).toEqual([]);
  });

  it('offline, the pages wait on the device; they go when it is back', async () => {
    await openClass();
    setOnline(false);
    await addAssessmentHandout(CID, CAUSES, 'Instructions', shrunk(2));
    expect(callsTo('start_handout_upload')).toEqual([]);
    expect(store.count()).toBe(2);
    setOnline(true);
    await quiet();
    expect(callsTo('finish_handout_upload')).toHaveLength(1);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, CAUSES, { ready: true })).toHaveLength(1);
  });

  it('reads the class’s handouts and links from list_course_resources, keeping what this device has not sent', async () => {
    const LINK = id(500);
    fake.on('list_course_resources', () => ({
      data: [
        {
          id: LINK,
          assessment_id: CAUSES,
          kind: 'link',
          title: 'CBC',
          url: 'https://www.cbc.ca/news',
          status: 'ready',
          position: 1,
        },
        { id: id(501), assessment_id: CAUSES, kind: 'video', title: 'Bad' },
      ],
      error: null,
    }));
    await openClass();
    setOnline(false);
    await addAssessmentLink(CID, CAUSES, 'https://example.ca', 'Example');
    setOnline(true);
    await refreshAssessmentResources(CID, true);
    expect(callsTo('list_course_resources')).toContainEqual({ p_course_id: CID });
    expect(getAssessmentResources(CID, CAUSES).map(r => r.title)).toEqual(['CBC', 'Example']);
  });

  it('a server without the calls offers nothing', async () => {
    fake.on('list_course_resources', () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.list_course_resources' },
    }));
    await openClass();
    await refreshAssessmentResources(CID, true);
    expect(assessmentResourcesOffered(CID)).toBe(false);
  });
});

describe('signed in, in a class whose student page is off', () => {
  it('is not offered, and nothing is sent', async () => {
    const fake = makeFakeSupabase();
    const was = { getSupabase: globalThis.getSupabase, useSupabase: _useSupabase };
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    try {
      const CID = 'e0000000-0000-4000-8000-0000000000aa';
      expect(assessmentResourcesOffered(CID)).toBe(false);
      expect(await addAssessmentLink(CID, 'x', 'https://example.ca', '')).toEqual({
        ok: false,
        reason: 'not_available',
      });
      expect(await addAssessmentHandout(CID, 'x', 'H', shrunk(1))).toEqual({ ok: false, reason: 'not_available' });
      await refreshAssessmentResources(CID, true);
      expect(fake.calls.map(c => c.name)).toEqual([]);
    } finally {
      globalThis.getSupabase = was.getSupabase;
      _useSupabase = was.useSupabase;
    }
  });
});
