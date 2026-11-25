/**
 * Handout files (Colin, Nov 17 2026: "+ Add a File"; migrations/
 * 2026111706_handout_files.sql; handouts-links-contract.md, "Handout files").
 *
 * - shared/handout-files.js: what a picked file is; a web page's pictures,
 *   picked beside it, put inside it as data: addresses, and the ones it
 *   names that were not picked said by name; text kept as UTF-8; 20 MB.
 * - shared/data.js: Demo Mode keeps a file in the photo queue with its own
 *   type and opens it from there; signed in, start_handout_file with a key,
 *   the file to its one path in the bucket handout-files with its type,
 *   finish_handout_file under the batch's key, and a 300-second link to
 *   open it, only at this class's and this handout's own name.
 * - The student's view: a file is For This Assignment's row that opens it.
 * - shared/handout-viewer.js: a text file through textContent only; a web
 *   page in the sealed frame (sandbox without allow-same-origin), handed
 *   its text only when that frame says it is ready; a message from anyone
 *   else is not read. An EPUB's chapters, read with fflate.
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
const load = file => runInThisContext(readFileSync(resolve(root, file), 'utf-8'), { filename: file });
load('shared/offline-queue.js');
load('shared/handout-files.js');
load('shared/handout-viewer.js');
load('vendor/fflate/fflate.min.js');
const queueSource = readFileSync(resolve(root, 'shared/photo-queue.js'), 'utf-8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const file = (name, body, type = '') => new File([body], name, { type });

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

/* ── shared/handout-files.js ─────────────────────────────────── */

describe('what a picked file is', () => {
  it.each([
    ['Lesson 3.html', '', 'html'],
    ['lesson.HTM', '', 'html'],
    ['notes.txt', '', 'txt'],
    ['Novel.epub', '', 'epub'],
    ['Novel', 'application/epub+zip', 'epub'],
    ['Lab.pdf', '', 'pdf'],
    ['map.PNG', '', 'picture'],
    ['photo.jpeg', 'image/jpeg', 'picture'],
    ['essay.docx', '', null],
    ['run.exe', 'text/html', null],
  ])('%s (%s) is %s', (name, type, kind) => {
    expect(HandoutFiles.kindOf({ name, type })).toBe(kind);
  });

  it('is named from the file, and sized as a teacher reads it', () => {
    expect(HandoutFiles.titleOf('lesson_3_practice.html')).toBe('lesson 3 practice');
    expect(HandoutFiles.titleOf('.epub')).toBe('Handout');
    expect(HandoutFiles.sizeWord(900)).toBe('900 bytes');
    expect(HandoutFiles.sizeWord(52000)).toBe('51 KB');
    expect(HandoutFiles.sizeWord(3 * 1024 * 1024)).toBe('3 MB');
    expect(HandoutFiles.sizeWord(2.94 * 1024 * 1024)).toBe('2.9 MB');
  });

  it('reads UTF-8, drops a byte-order mark, and falls back to Windows-1252', () => {
    expect(HandoutFiles.decodeText(new TextEncoder().encode('﻿café – “quotes”'))).toBe('café – “quotes”');
    expect(HandoutFiles.decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x78, 0x94]))).toBe('café “x”');
  });
});

describe('a web page’s pictures', () => {
  const PICS = { 'map.png': 'data:image/png;base64,AAA', 'fig 1.jpg': 'data:image/jpeg;base64,BBB' };

  it('are put inside it wherever it names them, in any folder', () => {
    const page = [
      '<img src="images/map.png" alt="Map">',
      "<img src='./Map.PNG'>",
      '<img src=map.png>',
      '<img srcset="map.png 1x, fig%201.jpg 2x">',
      '<div style="background:url(\'../pics/fig 1.jpg\')"></div>',
      '<script>document.querySelector("img").src = "images/map.png";</script>',
    ].join('\n');
    const out = HandoutFiles.inlinePictures(page, PICS);
    expect(out.html).not.toMatch(/map\.png|fig 1\.jpg|fig%201/i);
    expect(out.html.match(/data:image\/png;base64,AAA/g)).toHaveLength(5);
    expect(out.html).toContain('url("data:image/jpeg;base64,BBB")');
    expect(out.html).toContain('data:image/jpeg;base64,BBB 2x');
    expect(out.used.sort()).toEqual(['fig 1.jpg', 'map.png']);
    expect(out.missing).toEqual([]);
  });

  it('says by name each picture it shows that was not picked, once', () => {
    const page =
      '<img src="images/Chart.jpg"><img src="images/Chart.jpg"><img src="map.png"><div style="background:url(bg.gif)"></div>';
    const out = HandoutFiles.inlinePictures(page, PICS);
    expect(out.missing).toEqual(['Chart.jpg', 'bg.gif']);
  });

  it('leaves every web, data and in-page address as it is', () => {
    const page =
      '<img src="https://example.org/map.png"><img src="//cdn.example.org/map.png"><img src="data:image/png;base64,Z"><a href="#map.png">x</a><script src="app.js"></script><a href="next.html">Next</a>';
    const out = HandoutFiles.inlinePictures(page, PICS);
    expect(out.html).toBe(page);
    expect(out.missing).toEqual([]);
  });
});

describe('a web page’s parts from the web', () => {
  it('are named by site, each once; a link the student clicks is not one', () => {
    const page = [
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora">',
      '<link rel="canonical" href="https://example.org/lesson">',
      '<script src="//cdn.jsdelivr.net/npm/x.js"></script>',
      '<img src="https://www.example.org/map.png"><img src="http://example.org/b.png" srcset="https://img.example.net/c.png 2x">',
      '<style>@import "https://fonts.googleapis.com/x"; body { background: url(https://bg.example.com/a.jpg) }</style>',
      '<a href="https://britannica.com">Read</a><img src="local.png"><img src="data:image/png;base64,AA">',
    ].join('\n');
    expect(HandoutFiles.webSites(page)).toEqual([
      'fonts.googleapis.com',
      'cdn.jsdelivr.net',
      'example.org',
      'img.example.net',
      'bg.example.com',
    ]);
  });

  it('are said plainly when the page is added', async () => {
    const out = await HandoutFiles.prepare([
      file(
        'Lesson 2.html',
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora"><p>Hi</p>',
        'text/html',
      ),
    ]);
    expect(out.ready[0].web).toEqual(['fonts.googleapis.com']);
    expect(HandoutFiles.sayAbout(out)).toBe(
      'On students’ screens, Lesson 2 won’t show its pictures, fonts or scripts from the web (fonts.googleapis.com). Handouts load nothing from the internet, to keep students’ information private.',
    );
  });
});

describe('prepare: the files a teacher picked', () => {
  it('a web page with its pictures, a text file and an EPUB, ready; the rest said plainly', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const out = await HandoutFiles.prepare([
      file('Lesson 3.html', '<h1>Lesson</h1><img src="map.png"><img src="chart.png">', 'text/html'),
      file('map.png', png, 'image/png'),
      file('unused.png', png, 'image/png'),
      file('notes.txt', 'Read pages 4 to 9.', 'text/plain'),
      file('Novel.epub', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])),
      file('Fake.epub', 'not a zip'),
      file('essay.docx', 'x'),
      file('empty.txt', ''),
      file('Lab.pdf', '%PDF-1.4', 'application/pdf'),
    ]);
    expect(out.ready.map(r => [r.kind, r.title, r.blob.type])).toEqual([
      ['html', 'Lesson 3', 'text/html'],
      ['txt', 'notes', 'text/plain'],
      ['epub', 'Novel', 'application/epub+zip'],
    ]);
    const html = await out.ready[0].blob.text();
    expect(html).toContain('<img src="data:image/png;base64,iVBORw==">');
    expect(out.ready[0].missing).toEqual(['chart.png']);
    expect(out.ready[0].bytes).toBe(out.ready[0].blob.size);
    expect(out.pdfs.map(f => f.name)).toEqual(['Lab.pdf']);
    expect(out.refused).toEqual([
      { name: 'essay.docx', why: 'kind' },
      { name: 'Fake.epub', why: 'not_epub' },
      { name: 'empty.txt', why: 'empty' },
    ]);
    expect(out.unused).toEqual(['unused.png']);
    expect(HandoutFiles.sayAbout(out)).toBe(
      'Lesson 3 was added, but this picture it shows was not chosen, so it won’t appear: chart.png. To include it, remove the page and add it again with its pictures. ' +
        'essay.docx can’t be added. Add a PDF, a web page, a text file or an EPUB. ' +
        'Fake.epub isn’t a working EPUB. Save it again, then add it. ' +
        'empty.txt is empty. ' +
        'This picture isn’t in any page you chose, so it wasn’t added: unused.png.',
    );
  });

  it('pictures with no web page are not added, and it says so', async () => {
    const out = await HandoutFiles.prepare([file('map.png', 'x', 'image/png')]);
    expect(out.ready).toEqual([]);
    expect(out.noPage).toBe(true);
    expect(HandoutFiles.sayAbout(out)).toBe('Pictures go with a web page. Choose the page and its pictures together.');
  });

  it('a file over 20 MB is refused, a web page too once its pictures are inside', async () => {
    const big = file('Big.epub', new Uint8Array(HandoutFiles.MAX_BYTES + 1));
    const page = file('Page.html', '<img src="huge.png">' + 'x'.repeat(HandoutFiles.MAX_BYTES - 100));
    const pic = file('huge.png', new Uint8Array(200));
    const out = await HandoutFiles.prepare([big, page, pic]);
    expect(out.ready).toEqual([]);
    expect(out.refused).toEqual([
      { name: 'Big.epub', why: 'too_large' },
      { name: 'Page.html', why: 'too_large' },
    ]);
    expect(HandoutFiles.sayAbout(out)).toContain('Big.epub is over 20 MB, too large to add.');
  });
});

/* ── Demo Mode ─────────────────────────────────────────────── */

describe('in Demo Mode', () => {
  const CID = 'hf-demo';
  const SID = 'hf-cece';
  const AID = 'hf-lesson';
  let store;
  let wasDemo;

  beforeEach(() => {
    wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    clearClass(CID);
    seedClass(CID, {
      students: [{ id: SID, firstName: 'Cece', lastName: 'Lee' }],
      assessments: [
        { id: AID, title: 'Lesson 1.1', date: '2026-11-11', dueDate: '2026-11-18', type: 'summative', tagIds: [] },
      ],
      courseConfigs: { student_page_enabled: true },
    });
    COURSES[CID] = { id: CID, name: 'Socials 10', block: 'A', gradingSystem: 'proficiency', gradeLevel: '10' };
    runInThisContext(queueSource, { filename: 'shared/photo-queue.js' });
    store = memoryStore();
    window.PhotoQueue.configure({ store });
  });

  afterEach(() => {
    window.PhotoQueue.release();
    window.isDemoMode = wasDemo;
    clearClass(CID);
    localStorage.clear();
  });

  it('keeps a web page, a text file and an EPUB on this device, with their own types, and opens each', async () => {
    const html = await addAssessmentHandoutFile(CID, AID, 'Practice Page', 'html', new Blob(['<p>Hi</p>']));
    const txt = await addAssessmentHandoutFile(
      CID,
      AID,
      'Notes',
      'txt',
      new Blob(['Read this.'], { type: 'text/plain' }),
    );
    const epub = await addAssessmentHandoutFile(
      CID,
      AID,
      'Novel',
      'epub',
      new Blob([new Uint8Array([0x50, 0x4b, 3, 4])]),
    );
    expect([html.ok, txt.ok, epub.ok]).toEqual([true, true, true]);
    expect(getAssessmentResources(CID, AID).map(r => [r.kind, r.title, r.bytes, r.status])).toEqual([
      ['html', 'Practice Page', 9, 'ready'],
      ['txt', 'Notes', 10, 'ready'],
      ['epub', 'Novel', 4, 'ready'],
    ]);
    // One record each in the photo queue, a handout with its type, never sent.
    expect(store.metas().map(m => [m.kind, m.mime])).toEqual([
      ['handout', 'text/html'],
      ['handout', 'text/plain'],
      ['handout', 'application/epub+zip'],
    ]);
    expect((await window.PhotoQueue.send()).note).toBe('not_configured');
    const opened = await openAssessmentHandoutFile(CID, html.resource.id);
    expect(opened.kind).toBe('html');
    expect(opened.title).toBe('Practice Page');
    expect(opened.blob.type).toBe('text/html');
    expect(await opened.blob.text()).toBe('<p>Hi</p>');
    expect((await openAssessmentHandoutFile(CID, epub.resource.id)).blob.type).toBe('application/epub+zip');
    // A link's or an unknown id: nothing.
    expect(await openAssessmentHandoutFile(CID, 'nope')).toBeNull();
    // Remove: off the assessment, and its file leaves the device.
    await removeAssessmentResource(CID, txt.resource.id);
    expect(store.count()).toBe(2);
    expect(getAssessmentResources(CID, AID).map(r => r.kind)).toEqual(['html', 'epub']);
  });

  it('refuses another kind, an empty file and one over 20 MB', async () => {
    expect(await addAssessmentHandoutFile(CID, AID, 'x', 'docx', new Blob(['x']))).toEqual({
      ok: false,
      reason: 'not_a_file_kind',
    });
    expect(await addAssessmentHandoutFile(CID, AID, 'x', 'txt', new Blob([]))).toEqual({ ok: false, reason: 'empty' });
    const big = { size: 20971521, type: 'text/plain' };
    expect(await addAssessmentHandoutFile(CID, AID, 'x', 'txt', big)).toEqual({ ok: false, reason: 'too_large' });
    expect(getAssessmentResources(CID, AID)).toEqual([]);
  });

  it('Preview as Student’s view lists each file under For This Assignment, a row that opens it', async () => {
    await addAssessmentHandoutFile(CID, AID, 'Practice Page', 'html', new Blob(['<p>Hi</p>']));
    await addAssessmentHandoutFile(CID, AID, 'Notes', 'txt', new Blob(['x']));
    await addAssessmentHandoutFile(CID, AID, 'Novel', 'epub', new Blob(['PK']));
    const reply = StudentView.reply(CID, SID);
    expect(reply.assessments[0].resources.map(r => [r.kind, r.title, r.url, r.page_count])).toEqual([
      ['html', 'Practice Page', null, null],
      ['txt', 'Notes', null, null],
      ['epub', 'Novel', null, null],
    ]);
    const built = StudentView.fromCache(CID, SID);
    const p = built.view.work.find(x => x.id === AID);
    expect(p.resources).toEqual([
      { id: expect.any(String), kind: 'file', type: 'html', title: 'Practice Page' },
      { id: expect.any(String), kind: 'file', type: 'txt', title: 'Notes' },
      { id: expect.any(String), kind: 'file', type: 'epub', title: 'Novel' },
    ]);
    const seg = StudentPageView.segmentOf(p, built.view);
    const { document } = parseHTML(
      '<main>' + StudentPageView.html(built.view, { segment: seg, pick: AID }) + '</main>',
    );
    const card = document.querySelector('.sp-piece[data-piece="' + AID + '"]');
    // A file is not a page to swipe through: no carousel, only its row.
    expect(card.querySelector('.sp-car')).toBeNull();
    const rows = [...card.querySelectorAll('.sp-res-row')];
    expect(rows.map(r => [r.tagName, r.getAttribute('data-act'), r.textContent.replace(/\s+/g, ' ').trim()])).toEqual([
      ['BUTTON', 'handout-file', 'Practice Page Web Page'],
      ['BUTTON', 'handout-file', 'Notes Text File'],
      ['BUTTON', 'handout-file', 'Novel Book'],
    ]);
    expect(rows[0].getAttribute('data-resource')).toBe(p.resources[0].id);
  });

  it('the view leaves out any other kind', () => {
    const view = StudentView.fromPage(
      {
        ok: true,
        v: 1,
        student: { enrollment_id: SID, first_name: 'Cece' },
        course: { name: 'Socials 10', block: 'A', grading_system: 'proficiency' },
        tags: {},
        rubrics: [],
        assessments: [
          {
            id: AID,
            title: 'Lesson 1.1',
            date: '2026-11-11',
            due_date: '2026-11-18',
            tag_ids: [],
            resources: [
              { id: 'f1', kind: 'html', title: '' },
              { id: 'f2', kind: 'exe', title: 'Bad' },
              { id: 'f3', kind: 'file', title: 'Bad' },
            ],
          },
        ],
      },
      null,
    );
    expect(view.work.find(x => x.id === AID).resources).toEqual([
      { id: 'f1', kind: 'file', type: 'html', title: 'Handout' },
    ]);
  });
});

/* ── Signed in ─────────────────────────────────────────────── */

describe('signed in, in a class whose student page is on', () => {
  const CID = 'e0000000-0000-4000-8000-000000000001';
  const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const LESSON = id(300);
  let fake;
  let original;
  let uploads;
  let signed;
  let seq;
  let store;
  let rows;
  const newId = () => 'f0000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
  const callsTo = name => fake.calls.filter(c => c.name === name).map(c => c.params);

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
    fake = makeFakeSupabase();
    fake.on('get_class_bundle', () => {
      const bundle = syntheticClass();
      bundle.version = 1;
      Object.assign(bundle.gradebook.course, { student_page_enabled: true, return_grades: 'on_return' });
      return { data: bundle, error: null };
    });
    fake.on('list_course_grade_returns', () => ({ data: {}, error: null }));
    fake.on('list_course_resources', () => ({ data: [...rows.values()].map(r => ({ ...r })), error: null }));
    fake.on('start_handout_file', p => {
      const rid = newId();
      const row = {
        id: rid,
        assessment_id: p.p_assessment_id,
        kind: p.p_kind,
        title: p.p_title,
        url: null,
        page_count: null,
        bytes: p.p_bytes,
        status: 'uploading',
        position: rows.size + 1,
        path: `${CID}/${rid}.${p.p_kind}`,
      };
      rows.set(rid, row);
      return { data: { ...row, bucket: 'handout-files' }, error: null };
    });
    fake.on('finish_handout_file', p => {
      const row = rows.get(p.p_resource_id);
      if (!row) return { data: { id: p.p_resource_id, status: 'gone' }, error: null };
      if (uploads.some(u => u.path === row.path)) row.status = 'ready';
      return { data: { ...row, ...(row.status === 'ready' ? {} : { missing: true }) }, error: null };
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
    globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['<p>from the server</p>']) }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
    runInThisContext(queueSource, { filename: 'shared/photo-queue.js' });
    store = memoryStore();
    window.PhotoQueue.configure({ store });
    _workQueueWired = false;
    saveCourses({ [CID]: { id: CID, name: 'Socials 10' } });
    saveConfig({ activeCourse: CID });
  });

  afterEach(() => {
    if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
    _loadRetryTimer = null;
    window.v2Queue.clear();
    window.PhotoQueue.release();
    globalThis.getSupabase = original.getSupabase;
    globalThis.fetch = original.fetch;
    _useSupabase = original.useSupabase;
    _teacherId = original.teacher;
    _REFRESH_QUIET_MS = original.quiet;
    _resMissing = false;
    globalThis.__FV_CLASS_BUNDLE = false;
    localStorage.clear();
    delete _cache.students[CID];
    delete _classVersion[CID];
  });

  it('starts with a key, sends the file to its one path in handout-files with its type, then hands it in', async () => {
    await openClass();
    const res = await addAssessmentHandoutFile(CID, LESSON, 'Lesson 1.1 Practice', 'html', new Blob(['<p>Hi</p>']));
    expect(res.ok).toBe(true);
    expect(getAssessmentResources(CID, LESSON)[0]).toMatchObject({ kind: 'html', status: 'uploading', bytes: 9 });
    expect(getAssessmentResources(CID, LESSON, { ready: true })).toEqual([]);
    await quiet();
    const [start] = callsTo('start_handout_file');
    expect(start).toEqual({
      p_assessment_id: LESSON,
      p_title: 'Lesson 1.1 Practice',
      p_kind: 'html',
      p_bytes: 9,
      p_idempotency_key: expect.stringMatching(UUID),
    });
    const rid = [...rows.keys()][0];
    expect(uploads).toEqual([
      { bucket: 'handout-files', path: `${CID}/${rid}.html`, type: 'text/html', blobType: 'text/html', upsert: false },
    ]);
    const [finish] = callsTo('finish_handout_file');
    expect(finish).toEqual({ p_resource_id: rid, p_idempotency_key: expect.stringMatching(UUID) });
    expect(callsTo('finish_handout_upload')).toEqual([]);
    expect(store.count()).toBe(0);
    const [row] = getAssessmentResources(CID, LESSON, { ready: true });
    expect(row).toMatchObject({ id: rid, kind: 'html', status: 'ready' });
    // Opened through a 300-second link in handout-files, at its own name only.
    const opened = await openAssessmentHandoutFile(CID, rid);
    expect(await opened.blob.text()).toBe('<p>from the server</p>');
    expect(opened.blob.type).toBe('text/html');
    expect(signed).toEqual([{ bucket: 'handout-files', path: `${CID}/${rid}.html`, seconds: 300 }]);
  });

  it('a path that is not this class’s and this handout’s, of its kind, gives the upload up and sends nothing', async () => {
    await openClass();
    fake.on('start_handout_file', p => {
      const rid = newId();
      return { data: { id: rid, kind: p.p_kind, status: 'uploading', path: `${id(999)}/${rid}.html` }, error: null };
    });
    const res = await addAssessmentHandoutFile(CID, LESSON, 'Practice', 'html', new Blob(['x']));
    expect(res.ok).toBe(true);
    await quiet();
    expect(uploads).toEqual([]);
    expect(store.count()).toBe(0);
    expect(getAssessmentResources(CID, LESSON)).toEqual([]);
  });

  it('a file the server finds of another type or size is removed, here and there', async () => {
    await openClass();
    fake.on('finish_handout_file', p => ({ data: { ...rows.get(p.p_resource_id), bad: true }, error: null }));
    await addAssessmentHandoutFile(CID, LESSON, 'Notes', 'txt', new Blob(['x']));
    await quiet();
    expect(callsTo('remove_assessment_resource')).toHaveLength(1);
    expect(getAssessmentResources(CID, LESSON)).toEqual([]);
    expect(store.count()).toBe(0);
  });

  it('a file read from the server keeps its kind, size and path; a name not its own is not opened', async () => {
    await openClass();
    const rid = newId();
    rows.set(rid, {
      id: rid,
      assessment_id: LESSON,
      kind: 'epub',
      title: 'Novel',
      url: null,
      page_count: null,
      bytes: 3000000,
      status: 'ready',
      position: 1,
      path: `${CID}/${rid}.epub`,
    });
    await refreshAssessmentResources(CID, true);
    expect(getAssessmentResources(CID, LESSON)).toMatchObject([{ id: rid, kind: 'epub', bytes: 3000000 }]);
    // A row naming another class's file is never signed.
    const other = newId();
    rows.set(other, { ...rows.get(rid), id: other, path: `${id(999)}/${other}.epub` });
    await refreshAssessmentResources(CID, true);
    expect(await openAssessmentHandoutFile(CID, other)).toBeNull();
    expect(signed).toEqual([]);
  });
});

/* ── shared/handout-viewer.js ─────────────────────────────────── */

describe('the viewer', () => {
  let doc;
  let stub;
  let listeners;
  let wasAdd;
  let wasRemove;

  beforeEach(() => {
    stub = globalThis.document;
    doc = parseHTML('<!DOCTYPE html><html><head></head><body><button id="row">Row</button></body></html>').document;
    globalThis.document = doc;
    listeners = [];
    wasAdd = window.addEventListener;
    wasRemove = window.removeEventListener;
    window.addEventListener = (type, fn) => {
      if (type === 'message') listeners.push(fn);
    };
    window.removeEventListener = (type, fn) => {
      listeners = listeners.filter(f => f !== fn);
    };
  });

  afterEach(() => {
    HandoutViewer.close();
    globalThis.document = stub;
    window.addEventListener = wasAdd;
    window.removeEventListener = wasRemove;
  });

  const tick = () => new Promise(r => setTimeout(r, 0));

  it('shows a text file as text, never as HTML', async () => {
    HandoutViewer.open({
      title: 'Notes',
      kind: 'txt',
      load: async () => new Blob(['<img src=x onerror=alert(1)> and <b>bold</b>']),
    });
    await tick();
    await tick();
    const pre = doc.querySelector('.hv-layer pre.hv-text');
    expect(pre.textContent).toBe('<img src=x onerror=alert(1)> and <b>bold</b>');
    expect(pre.querySelector('img, b')).toBeNull();
    expect(doc.querySelector('.hv-layer iframe')).toBeNull();
    expect(doc.querySelector('.hv-title').textContent).toBe('Notes');
    expect(doc.querySelector('.hv-sub').textContent).toBe('Text File');
  });

  it('puts a web page in the sealed frame, and hands it the page only when that frame is ready', async () => {
    HandoutViewer.open({
      title: 'Practice Page',
      kind: 'html',
      load: async () => new Blob(['<p>Hi</p><script>x()</script>']),
    });
    await tick();
    await tick();
    const frame = doc.querySelector('.hv-layer iframe.hv-frame');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals');
    expect(frame.getAttribute('sandbox')).not.toMatch(/same-origin|top-navigation|popups/);
    expect(frame.getAttribute('src')).toBe('/shared/handout-frame.html');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    const sent = [];
    const win = { postMessage: (m, to) => sent.push([m, to]) };
    Object.defineProperty(frame, 'contentWindow', { value: win });
    // Anyone else saying "ready" is not read.
    listeners.forEach(fn => fn({ source: {}, data: { fv: 'handout-frame', ready: true } }));
    expect(sent).toEqual([]);
    listeners.forEach(fn => fn({ source: win, data: { fv: 'handout-frame', ready: true } }));
    expect(sent).toEqual([[{ fv: 'handout-show', mode: 'page', html: '<p>Hi</p><script>x()</script>' }, '*']]);
    // Sent once: a second "ready" (the page navigating itself) gets nothing.
    listeners.forEach(fn => fn({ source: win, data: { fv: 'handout-frame', ready: true } }));
    expect(sent).toHaveLength(1);
    // The page is never drawn here.
    expect(doc.querySelector('.hv-layer p:not(.hv-sub):not(.hv-msg)')).toBeNull();
  });

  it('opens a web link only when the student presses Open Website, and only one the frame names', async () => {
    HandoutViewer.open({ title: 'Practice Page', kind: 'html', load: async () => new Blob(['<p>Hi</p>']) });
    await tick();
    await tick();
    const frame = doc.querySelector('.hv-layer iframe.hv-frame');
    const win = { postMessage: () => {} };
    Object.defineProperty(frame, 'contentWindow', { value: win });
    const opened = [];
    const wasOpen = window.open;
    window.open = (...a) => opened.push(a);
    try {
      const say = (source, data) => listeners.forEach(fn => fn({ source, data }));
      // From anyone but the frame, or not a web address: nothing.
      say({}, { fv: 'handout-link', url: 'https://example.org/a' });
      say(win, { fv: 'handout-link', url: 'javascript:alert(1)' });
      say(win, { fv: 'handout-link', url: 'data:text/html,hi' });
      expect(doc.querySelector('.hv-ask')).toBeNull();
      // From the frame: the student is asked, with the address in front of them; nothing opens yet.
      say(win, { fv: 'handout-link', url: 'https://example.org/read?x=1' });
      expect(doc.querySelector('.hv-ask-words').textContent).toBe('Open this website in a new tab?');
      expect(doc.querySelector('.hv-ask-url').textContent).toBe('https://example.org/read?x=1');
      expect(opened).toEqual([]);
      doc.querySelector('.hv-ask-no').click();
      expect(doc.querySelector('.hv-ask')).toBeNull();
      expect(opened).toEqual([]);
      say(win, { fv: 'handout-link', url: 'https://example.org/read?x=1' });
      doc.querySelector('.hv-ask-go').click();
      expect(opened).toEqual([['https://example.org/read?x=1', '_blank', 'noopener,noreferrer']]);
      expect(doc.querySelector('.hv-ask')).toBeNull();
    } finally {
      window.open = wasOpen;
    }
  });

  it('Back closes it and gives the keyboard back; a sign-out closes it too', async () => {
    const row = doc.getElementById('row');
    let closed = 0;
    HandoutViewer.open({
      title: 'Notes',
      kind: 'txt',
      returnTo: row,
      load: async () => new Blob(['x']),
      onClose: () => closed++,
    });
    expect(HandoutViewer.isOpen()).toBe(true);
    doc.querySelector('.hv-back').click();
    expect(doc.querySelector('.hv-layer')).toBeNull();
    expect(closed).toBe(1);
    expect(listeners).toEqual([]);
    HandoutViewer.open({ title: 'Notes', kind: 'txt', load: async () => new Blob(['x']) });
    HandoutViewer.close();
    expect(HandoutViewer.isOpen()).toBe(false);
  });

  it('a file that did not come says so, with Try Again', async () => {
    let n = 0;
    HandoutViewer.open({ title: 'Notes', kind: 'txt', load: async () => (++n === 1 ? null : new Blob(['now'])) });
    await tick();
    expect(doc.querySelector('.hv-msg').textContent).toBe(
      'The handout didn’t load. Check your internet and try again.',
    );
    doc.querySelector('.hv-retry').click();
    await tick();
    await tick();
    expect(doc.querySelector('.hv-text').textContent).toBe('now');
  });

  it('reads a book’s size from its zip directory, and will not open one that would unzip past 100 MB', async () => {
    const enc = s => new TextEncoder().encode(s);
    const zip = fflate.zipSync({ 'a.txt': enc('hello'), 'b.txt': enc('world!') });
    expect(HandoutViewer.unzippedSize(zip)).toBe(11);
    // The directory says one entry is 200 MB: refused before anything is inflated.
    const big = zip.slice();
    const dv = new DataView(big.buffer);
    let at = -1;
    for (let i = 0; i < big.length - 4; i++) if (dv.getUint32(i, true) === 0x02014b50) at = at < 0 ? i : at;
    dv.setUint32(at + 24, 200 * 1024 * 1024, true);
    expect(() => HandoutViewer.unzippedSize(big)).toThrow('too_large');
    expect(() => HandoutViewer.readBook(big, fflate)).toThrow('too_large');
    expect(() => HandoutViewer.unzippedSize(enc('not a zip at all, no directory here'))).toThrow('not a zip');
    // Opened, it says so plainly; Save to Phone still works.
    HandoutViewer.open({ title: 'Huge', kind: 'epub', load: async () => new Blob([big]) });
    await tick();
    await tick();
    await tick();
    expect(doc.querySelector('.hv-msg').textContent).toBe('This book is too large to open here; use Save to Phone.');
    expect(doc.querySelector('.hv-save').disabled).toBe(false);
    expect(doc.querySelector('.hv-layer iframe')).toBeNull();
  });

  it('reads an EPUB’s chapters in reading order, its pictures and styles inside them, its scripts left out', () => {
    const enc = s => new TextEncoder().encode(s);
    const zip = fflate.zipSync({
      mimetype: enc('application/epub+zip'),
      'META-INF/container.xml': enc(
        '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
      'OEBPS/content.opf': enc(
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>' +
          '<item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/>' +
          '<item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/>' +
          '<item id="css" href="style.css" media-type="text/css"/>' +
          '<item id="pic" href="img/map.png" media-type="image/png"/>' +
          '</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
      ),
      'OEBPS/style.css': enc('p { color: navy; } .bg { background: url(img/map.png); }'),
      'OEBPS/img/map.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'OEBPS/text/one.xhtml': enc(
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../style.css"/></head><body><h1>One</h1><img src="../img/map.png"/><script>bad()</script></body></html>',
      ),
      'OEBPS/text/two.xhtml': enc('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Two</p></body></html>'),
    });
    const wasP = globalThis.DOMParser;
    const wasS = globalThis.XMLSerializer;
    globalThis.DOMParser = parseHTML('<html></html>').DOMParser;
    globalThis.XMLSerializer = class {
      serializeToString(n) {
        return n.outerHTML != null ? n.outerHTML : n.textContent;
      }
    };
    try {
      const book = HandoutViewer.readBook(zip, fflate);
      expect(book.chapters.map(c => c.path)).toEqual(['OEBPS/text/one.xhtml', 'OEBPS/text/two.xhtml']);
      expect(book.chapters[0].html).toContain('One');
      expect(book.chapters[0].html).toContain('src="data:image/png;base64,iVBORw=="');
      expect(book.chapters[0].html).not.toContain('bad()');
      expect(book.chapters[0].css).toContain('color: navy');
      expect(book.chapters[0].css).toContain('url("data:image/png;base64,iVBORw==")');
      expect(book.chapters[1].html).toContain('Two');
      expect(() => HandoutViewer.readBook(fflate.zipSync({ 'a.txt': enc('x') }), fflate)).toThrow();
    } finally {
      globalThis.DOMParser = wasP;
      globalThis.XMLSerializer = wasS;
    }
  });
});

/* ── The student page: a real card opens a file through `handout-file` ── */

describe('on a real card', () => {
  const TODAY = new Date().toLocaleDateString('en-CA');
  const RES = '00000099-0000-4000-8000-000000000001';

  async function realCard(kind) {
    const { openStudentPage } = await import('./helpers/student-page-context.js');
    const { WORK, fakeStudentSubmit, sampleCard } = await import('./helpers/fake-student-submit.js');
    const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
    fn.state.dirty = reply => {
      reply.assessments.forEach(a => {
        a.resources = a.id === WORK.quick ? [{ id: RES, kind, title: 'Lesson Page', url: null, page_count: null }] : [];
      });
      return reply;
    };
    const page = openStudentPage({ objectUrls: true });
    const asked = [];
    page.server = body => {
      if (body.route !== 'handout-file') return fn.handle(body);
      asked.push(body);
      return { ok: true, kind, bytes: 20, title: 'Lesson Page', url: 'https://x.supabase.co/sign/file?t=1' };
    };
    page.storage = async () => ({ status: 200, blob: new Blob(['<p>Hi</p>'], { type: 'text/html' }) });
    await page.start('#P3R8-WDK4');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    await page.settle();
    return { page, asked, WORK };
  }

  it('a tap asks handout-file for this piece and resource, fetches the one link, and opens it sealed', async () => {
    const { page, asked, WORK } = await realCard('html');
    const sel = '.sp-piece[data-piece="' + WORK.quick + '"] [data-act="handout-file"]';
    const row = page.root().querySelector(sel);
    expect(row).toBeTruthy();
    expect(row.textContent.replace(/\s+/g, ' ').trim()).toBe('Lesson Page Web Page');
    await page.click(sel);
    await page.settle();
    expect(asked).toEqual([
      expect.objectContaining({ route: 'handout-file', resource_id: RES, assessment_id: WORK.quick }),
    ]);
    expect(page.storageCalls.map(c => c.url)).toEqual(['https://x.supabase.co/sign/file?t=1']);
    const doc = page.run('document');
    const frame = doc.querySelector('.hv-layer iframe.hv-frame');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals');
    expect(frame.getAttribute('src')).toBe('/shared/handout-frame.html');
    // Opened again in the session: what was fetched is kept.
    doc.querySelector('.hv-back').click();
    expect(doc.querySelector('.hv-layer')).toBeNull();
    await page.click(sel);
    await page.settle();
    expect(asked).toHaveLength(1);
  });

  it('a text file is shown as text', async () => {
    const { page, WORK } = await realCard('txt');
    await page.click('.sp-piece[data-piece="' + WORK.quick + '"] [data-act="handout-file"]');
    await page.settle();
    const doc = page.run('document');
    expect(doc.querySelector('.hv-layer pre.hv-text').textContent).toBe('<p>Hi</p>');
    expect(doc.querySelector('.hv-layer iframe')).toBeNull();
  });
});
