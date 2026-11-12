/**
 * photo: the tests that were tests/photo-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { parseHTML } from 'linkedom';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mount, unmount } from './helpers/gradebook-dom.js';
import { U, clearClass, click, confirmOk, seedClass, toastText } from './helpers/pin-save-paths.js';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { damagedPdf, lockedPdf, pagesPdf } from './fixtures/pdf-fixtures.mjs';

describe('photo-delete-warnings', () => {
  /**
   * S8-F1 (teacher deletes): the plain "photos go for good" lines a teacher
   * reads before deleting (docs/plans/student-page-build-plan.md S8; the
   * wording is Colin's ruling 102).
   *
   * - The Gradebook column menu's Delete Assessment (teacher/page-gradebook.js)
   *   names the photos students sent for it, counting students, not pages.
   * - Deleting a withdrawn student permanently, and Delete Class
   *   (teacher/dash-class-manager.js), name photos when that student or class
   *   has any; the withdrawn student's Download Records says the photos are not
   *   in its file.
   *
   * Sent work is read through shared/data.js's read side (getCourseSubmissions),
   * filled here as Demo Mode fills it (saveDemoStudentWork). With the class's
   * build switch off, nothing sent, or a signed-in teacher's class (the read
   * side has nothing for it until S5-W1), every dialog reads exactly as it did
   * before this change: the first block of each pins that. Send Work is not
   * asked: photos sent before a teacher turned it off are deleted all the same,
   * so the dialogs still say so.
   */

  const CID = U(1);
  const AVA = U(11);
  const BEN = U(12);
  const CARA = U(13);
  const LAB = U(31);
  const QUIZ = U(32);

  const TODAY_ASSESS =
    'All scores, statuses, and observations linked to this assessment will be removed. You can undo this for a few seconds.';
  const TODAY_STUDENT =
    'Their scores, observations, goals, reflections and reports in this class are deleted. This cannot be undone.';
  const TODAY_CLASS =
    'Permanently delete Science 8 with all its students, assessments, and scores? It disappears now and is erased for good after 30 days.';

  const WORK = [
    { id: LAB, title: 'Cell Lab', tagIds: [], date: '2026-10-10', type: 'summative' },
    { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [], date: '2026-10-11' },
  ];

  const page = (sid, n) => ({
    id: sid + '-p' + n,
    page: n,
    path: 'cell-lab-cece-' + n + '.jpg',
    thumb_path: 'cell-lab-cece-' + n + '-thumb.jpg',
    bytes: 1000,
    thumb_bytes: 100,
    width: 900,
    height: 1200,
    rotation: 0,
    sha256: 'x',
  });
  const sub = (sid, aid, pages, more) => ({
    id: 'sub-' + sid + '-' + aid + '-' + ((more && more.version) || 1),
    assessment_id: aid,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    is_late: false,
    note: null,
    followed_plan: null,
    created_at: '2026-10-10T16:00:00.000Z',
    sent_at: '2026-10-10T16:02:00.000Z',
    files: Array.from({ length: pages }, (_, i) => page(sid, i + 1)),
    ...more,
  });

  /* Ava sent two pages for the lab and has a second version; Ben sent one,
   added by the teacher; Cara's was handed in on paper, with no photo. */
  const SENT = [
    sub(AVA, LAB, 2),
    sub(AVA, LAB, 1, { version: 2 }),
    sub(BEN, LAB, 1, { sent_by: 'teacher' }),
    sub(CARA, LAB, 0, { on_paper: true }),
  ];

  let wasDemo;

  /* The class, as Demo Mode holds it: `on` the build switch, `send` Send Work,
   `sent` the submissions. */
  function seed({ on = true, send = true, sent = SENT, demo = true } = {}) {
    window.isDemoMode = () => demo;
    if (demo) localStorage.setItem('gb-demo-mode', '1');
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
        { id: CARA, firstName: 'Cara', lastName: 'Chen' },
      ],
      assessments: WORK,
      courseConfigs: on ? { student_page_enabled: true, return_grades: 'on_return' } : {},
    });
    // Saved as Demo Mode saves it; read back below only when demo is true.
    window.isDemoMode = () => true;
    saveDemoStudentWork(CID, {
      course: { send_work: send, keep_photos_until: 'end_of_year' },
      assessments: [{ id: LAB, students_send: 'photos', after_due: 'keep', accept_until: null }],
      submissions: sent,
    });
    window.isDemoMode = () => demo;
  }

  beforeEach(() => {
    wasDemo = window.isDemoMode;
  });

  afterEach(() => {
    window.isDemoMode = wasDemo;
    clearClass(CID);
    localStorage.clear();
  });

  /* ── The Gradebook's column menu ─────────────────────────────────────── */

  function rightClick(target, x) {
    const e = new document.defaultView.Event('contextmenu', { bubbles: true, cancelable: true });
    e.clientX = x;
    e.clientY = 0;
    target.dispatchEvent(e);
  }
  /* The column menu's Delete Assessment for `aid`, picked: the dialog's words.
   linkedom draws no layout, so each column is given 100px. */
  function deleteAssessDialog(aid) {
    const head = document.querySelector('.gb-grid-colhead[data-aid="' + aid + '"]');
    const heads = Array.from(head.parentNode.querySelectorAll('.gb-grid-colhead'));
    head.parentNode.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100 * heads.length, height: 0 });
    heads[0].getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 0 });
    rightClick(head, 100 * heads.indexOf(head) + 10);
    click(document.querySelector('.gb-ctx-menu [data-ctx="deleteAssess"]'));
    const card = document.querySelector('.confirm-card');
    return {
      title: card.querySelector('.confirm-title').textContent,
      message: card.querySelector('.confirm-message').textContent,
    };
  }

  describe('Gradebook: Delete Assessment', () => {
    afterEach(() => unmount());

    describe('reads as it always has', () => {
      it.each([
        ['with the build switch off', { on: false }],
        ['with nothing sent', { sent: [] }],
        ['with nothing sent and Send Work off', { sent: [], send: false }],
        ['when only a paper copy was handed in', { sent: [sub(CARA, LAB, 0, { on_paper: true })] }],
        ['for a signed-in teacher’s class', { demo: false }],
      ])('%s', (_, opts) => {
        mount(() => seed(opts), { course: CID });
        const d = deleteAssessDialog(LAB);
        expect(d.title).toBe('Delete “Cell Lab”?');
        expect(d.message).toBe(TODAY_ASSESS);
      });

      it('for a piece nobody sent work for, in a class where others did', () => {
        mount(() => seed(), { course: CID });
        expect(deleteAssessDialog(QUIZ).message).toBe(TODAY_ASSESS);
      });
    });

    describe('a signed-in class whose work this session has not read (S9-W1)', () => {
      const NOTE = 'All scores, statuses, and observations linked to this assessment will be removed';
      const asked = async known => {
        const was = globalThis.readStudentWorkForDelete;
        let release;
        globalThis.readStudentWorkForDelete = vi.fn(() => new Promise(r => (release = r)));
        try {
          mount(() => seed({ sent: [] }), { course: CID });
          const head = document.querySelector('.gb-grid-colhead[data-aid="' + LAB + '"]');
          const heads = Array.from(head.parentNode.querySelectorAll('.gb-grid-colhead'));
          head.parentNode.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100 * heads.length, height: 0 });
          heads[0].getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 0 });
          rightClick(head, 100 * heads.indexOf(head) + 10);
          click(document.querySelector('.gb-ctx-menu [data-ctx="deleteAssess"]'));
          // Nothing is said until the class's work has been read.
          expect(document.querySelector('.confirm-card')).toBeNull();
          release({ known });
          await Promise.resolve();
          await Promise.resolve();
          const card = document.querySelector('.confirm-card');
          return card && card.querySelector('.confirm-message').textContent;
        } finally {
          globalThis.readStudentWorkForDelete = was;
        }
      };

      it('waits for the read, and says photos go when that read failed', async () => {
        expect(await asked(false)).toBe(
          NOTE +
            ", and any photos students sent for it. You can undo this for a few seconds. After that, deleted photos can't come back.",
        );
      });

      it('waits for the read, and reads as it always has when nothing was sent', async () => {
        expect(await asked(true)).toBe(TODAY_ASSESS);
      });
    });

    describe('names the photos when students have sent work for it', () => {
      it('counts students, not pages or versions, and a paper copy is no photo', () => {
        mount(() => seed(), { course: CID });
        const d = deleteAssessDialog(LAB);
        expect(d.title).toBe('Delete “Cell Lab”?');
        expect(d.message).toBe(
          "All scores, statuses, and observations linked to this assessment will be removed, and the photos 2 students sent for it. You can undo this for a few seconds. After that, deleted photos can't come back.",
        );
      });

      it('one student', () => {
        mount(() => seed({ sent: [sub(BEN, LAB, 3)] }), { course: CID });
        expect(deleteAssessDialog(LAB).message).toBe(
          "All scores, statuses, and observations linked to this assessment will be removed, and the photos 1 student sent for it. You can undo this for a few seconds. After that, deleted photos can't come back.",
        );
      });

      it('a linked copy in another class is still named, between the two sentences', () => {
        mount(() => seed(), { course: CID });
        const note = AssessmentCopy.deleteNote;
        AssessmentCopy.deleteNote = () => ' It is also in Science 8 B; that copy stays.';
        try {
          expect(deleteAssessDialog(LAB).message).toBe(
            "All scores, statuses, and observations linked to this assessment will be removed, and the photos 2 students sent for it. It is also in Science 8 B; that copy stays. You can undo this for a few seconds. After that, deleted photos can't come back.",
          );
        } finally {
          AssessmentCopy.deleteNote = note;
        }
      });

      it('with Send Work turned off after the photos were sent', () => {
        mount(() => seed({ send: false }), { course: CID });
        expect(deleteAssessDialog(LAB).message).toBe(
          "All scores, statuses, and observations linked to this assessment will be removed, and the photos 2 students sent for it. You can undo this for a few seconds. After that, deleted photos can't come back.",
        );
      });

      it('Delete still waits for its few seconds, as the words say', () => {
        mount(() => seed(), { course: CID });
        deleteAssessDialog(LAB);
        confirmOk();
        expect(toastText()).toBe('Deleted “Cell Lab”');
        expect(getAssessments(CID).map(a => a.id)).toEqual([LAB, QUIZ]);
      });
    });
  });

  /* ── Class Settings: deleting a withdrawn student, and Delete Class ──── */

  describe('Class Settings', () => {
    let stubDocument;
    let originalToast;

    function open(opts) {
      seed(opts);
      COURSES[CID].archived = true;
      DashClassManager.configure({ activeCourse: CID, onRender: function () {}, onCourseChange: function () {} });
      DashClassManager.openClassManager();
    }
    const dialog = () => document.querySelector('.confirm-card');
    const message = () => dialog().querySelector('.confirm-message').textContent;
    const keepCopy = () => dialog().querySelector('.cm-keep-copy-text').textContent;

    function deleteWithdrawn(sid) {
      withdrawStudent(CID, sid);
      DashClassManager.handleAction('cmDeleteWithdrawn', { dataset: { sid: sid } });
    }

    beforeEach(() => {
      stubDocument = globalThis.document;
      const dom = parseHTML('<!DOCTYPE html><html><body><div id="main"></div></body></html>');
      globalThis.document = dom.document;
      originalToast = globalThis.showUndoToast;
      globalThis.showUndoToast = function () {};
    });

    afterEach(() => {
      DashClassManager.resetState();
      globalThis.document = stubDocument;
      globalThis.showUndoToast = originalToast;
    });

    describe('read as they always have', () => {
      it.each([
        ['with the build switch off', { on: false }],
        ['with nothing sent', { sent: [] }],
        ['with nothing sent and Send Work off', { sent: [], send: false }],
        ['for a signed-in teacher’s class', { demo: false }],
      ])('%s', (_, opts) => {
        open(opts);
        deleteWithdrawn(AVA);
        expect(dialog().querySelector('.confirm-title').textContent).toBe('Delete Ava Adams Permanently?');
        expect(message()).toBe(TODAY_STUDENT);
        expect(keepCopy()).toBe('Keep a copy firstA CSV of Ava Adams’s scores and observations in Science 8.');
        document.getElementById('confirm-cancel-btn').onclick();

        DashClassManager.handleAction('cmDeleteCourse', { dataset: { cid: CID } });
        expect(dialog().querySelector('.confirm-title').textContent).toBe('Delete Class');
        expect(message()).toBe(TODAY_CLASS);
      });

      it('for a student with no photos, in a class where others sent some', () => {
        open();
        deleteWithdrawn(CARA);
        expect(message()).toBe(TODAY_STUDENT);
        expect(keepCopy()).toBe('Keep a copy firstA CSV of Cara Chen’s scores and observations in Science 8.');
      });
    });

    describe('name the photos when there are some', () => {
      it('Delete Permanently, and beside Download Records', () => {
        open();
        deleteWithdrawn(AVA);
        expect(dialog().querySelector('.confirm-title').textContent).toBe('Delete Ava Adams Permanently?');
        expect(message()).toBe(
          'Their scores, observations, goals, reflections, reports and photos of their work in this class are deleted. This cannot be undone.',
        );
        expect(keepCopy()).toBe(
          'Keep a copy firstA CSV of Ava Adams’s scores and observations in Science 8.Photos of their work are not in this file.',
        );
        expect(dialog().querySelector('#cm-keep-copy-btn').textContent).toBe('Download Records');
      });

      it('a student whose only photos were added by the teacher', () => {
        open();
        deleteWithdrawn(BEN);
        expect(message()).toMatch(/reports and photos of their work in this class are deleted/);
        expect(keepCopy()).toMatch(/Photos of their work are not in this file\.$/);
      });

      it('Delete Class', () => {
        open();
        DashClassManager.handleAction('cmDeleteCourse', { dataset: { cid: CID } });
        expect(dialog().querySelector('.confirm-title').textContent).toBe('Delete Class');
        expect(message()).toBe(
          "Permanently delete Science 8 with all its students, assessments, scores and photos of student work? It disappears now and is erased for good after 30 days. Deleted photos can't come back.",
        );
      });

      it('with Send Work turned off after the photos were sent', () => {
        open({ send: false });
        deleteWithdrawn(AVA);
        expect(message()).toBe(
          'Their scores, observations, goals, reflections, reports and photos of their work in this class are deleted. This cannot be undone.',
        );
        expect(keepCopy()).toMatch(/Photos of their work are not in this file\.$/);
        document.getElementById('confirm-cancel-btn').onclick();

        DashClassManager.handleAction('cmDeleteCourse', { dataset: { cid: CID } });
        expect(message()).toBe(
          "Permanently delete Science 8 with all its students, assessments, scores and photos of student work? It disappears now and is erased for good after 30 days. Deleted photos can't come back.",
        );
      });

      it('Delete Class names photos sent for any piece, by a student since withdrawn too', () => {
        open({ sent: [sub(CARA, QUIZ, 1)] });
        withdrawStudent(CID, CARA);
        DashClassManager.handleAction('cmDeleteCourse', { dataset: { cid: CID } });
        expect(message()).toMatch(/scores and photos of student work\?/);
      });
    });
  });
});

describe('photo-readers', () => {
  /**
   * shared/photo-readers.js: the PDF reader behind PhotoShrink's openPdf seam.
   *
   * The real pdf.js from vendor/pdfjs/ runs here (in Node, on the main thread)
   * against small real PDFs made by tests/fixtures/pdf-fixtures.mjs: page
   * counts, the 21-page refusal, a locked PDF, a damaged one and a file that
   * is not a PDF. Drawing a page needs a real canvas, so the page sizes come
   * from a stand-in library here, and a real two-page PDF becoming two real
   * JPEG pages under the live CSP is in e2e/pdf-pages.spec.js.
   */

  const source = readFileSync(new URL('../shared/photo-readers.js', import.meta.url), 'utf-8');
  runInThisContext(source, { filename: 'shared/photo-readers.js' });
  const PR = window.PhotoReaders;
  const PS = window.PhotoShrink;

  let pdfjs;
  beforeAll(async () => {
    // In Node pdf.js runs its worker on the main thread when it finds it here.
    globalThis.pdfjsWorker = await import('../vendor/pdfjs/pdf.worker.min.js');
    pdfjs = await import('../vendor/pdfjs/pdf.min.js');
  }, 60_000);

  const asFile = (bytes, name = 'Lab Report.pdf') => new File([bytes], name, { type: 'application/pdf' });

  /* A surface for PhotoShrink that is never asked to draw: every case here
   is refused, or counted, before a page is drawn. */
  const noSurface = {
    decode() {
      throw new Error('not asked');
    },
    canvas() {
      throw new Error('not asked');
    },
  };

  let loads;
  beforeEach(() => {
    loads = 0;
    PR.configure({
      load: url => {
        loads++;
        expect(url).toBe('/vendor/pdfjs/pdf.min.js');
        return Promise.resolve(pdfjs);
      },
    });
  });

  describe('loading', () => {
    it('fetches nothing when the file loads; the library is fetched on the first PDF, once', async () => {
      // A fresh copy, as a page that has just loaded it.
      const fresh = new Function('window', source.replace('window.PhotoReaders =', 'return'))({});
      expect(fresh.loaded()).toBe(false);
      expect(loads).toBe(0);
      await PR.openPdf(asFile(pagesPdf(2))).then(doc => doc.close());
      await PR.openPdf(asFile(pagesPdf(2))).then(doc => doc.close());
      expect(loads).toBe(1);
      expect(PR.loaded()).toBe(true);
    });

    it('a library that cannot be fetched is refused as no_decoder, and the next PDF tries again', async () => {
      let tries = 0;
      PR.configure({
        load: () => {
          tries++;
          return Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
        },
      });
      const res = await PS.prepare(asFile(pagesPdf(2)), { openPdf: PR.openPdf, surface: noSurface });
      expect(res).toMatchObject({ ok: false, reason: 'no_decoder', kind: 'pdf' });
      await PS.prepare(asFile(pagesPdf(2)), { openPdf: PR.openPdf, surface: noSurface });
      expect(tries).toBe(2);
    });

    it('something that is not pdf.js is refused as no_decoder', async () => {
      PR.configure({ load: () => Promise.resolve({ default: {} }) });
      const res = await PS.prepare(asFile(pagesPdf(2)), { openPdf: PR.openPdf, surface: noSurface });
      expect(res).toMatchObject({ ok: false, reason: 'no_decoder' });
    });

    it('points pdf.js at the worker beside it', () => {
      expect(PR.WORKER_URL).toBe('/vendor/pdfjs/pdf.worker.min.js');
      expect(readFileSync(new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url)).length).toBeGreaterThan(0);
    });
  });

  describe('the real pdf.js', () => {
    it('opens a two-page PDF as two pages', async () => {
      const doc = await PR.openPdf(asFile(pagesPdf(2)), { longSide: 2000 });
      expect(doc.pages).toBe(2);
      expect(typeof doc.page).toBe('function');
      doc.close();
      await expect(doc.page(1)).rejects.toMatchObject({ reason: 'unreadable' });
    });

    it('a 21-page PDF is refused before any page is drawn', async () => {
      const res = await PS.prepare(asFile(pagesPdf(21)), { openPdf: PR.openPdf, surface: noSurface });
      expect(res).toMatchObject({ ok: false, reason: 'too_many_pages', pageCount: 21, limit: 20 });
    });

    it('a 20-page PDF is not refused for its length', async () => {
      const doc = await PR.openPdf(asFile(pagesPdf(20)));
      expect(doc.pages).toBe(20);
      doc.close();
    });

    it('a PDF locked with a password is refused plainly, and says it is locked', async () => {
      const res = await PS.prepare(asFile(lockedPdf()), { openPdf: PR.openPdf, surface: noSurface });
      expect(res).toMatchObject({ ok: false, reason: 'unreadable', kind: 'pdf', locked: true });
    });

    it('a damaged PDF is refused plainly', async () => {
      const res = await PS.prepare(asFile(damagedPdf()), { openPdf: PR.openPdf, surface: noSurface });
      expect(res).toMatchObject({ ok: false, reason: 'unreadable', kind: 'pdf' });
      expect(res.locked).toBeUndefined();
    });

    it('a file named .pdf that is not one is refused plainly', async () => {
      const res = await PS.prepare(asFile(new TextEncoder().encode('Just a note.'), 'notes.pdf'), {
        openPdf: PR.openPdf,
        surface: noSurface,
      });
      expect(res).toMatchObject({ ok: false, reason: 'unreadable', kind: 'pdf' });
    });

    it('the fixtures are real PDFs: the locked one opens with its password', async () => {
      const task = pdfjs.getDocument({ data: lockedPdf(), password: 'secret', verbosity: 0 });
      const doc = await task.promise;
      const text = await (await doc.getPage(2)).getTextContent();
      expect(text.items.map(i => i.str).join('')).toBe('Page 2');
      await task.destroy();
    });
  });

  /* A stand-in pdf.js for drawing: pages of given sizes in points, and a
   record of what was rendered and destroyed. */
  function standIn(sizes, { failPage } = {}) {
    const log = { rendered: [], destroyed: 0, cleaned: 0, released: [] };
    const lib = {
      GlobalWorkerOptions: { workerSrc: '' },
      AnnotationMode: { ENABLE_STORAGE: 3 },
      getDocument(opts) {
        log.options = opts;
        return {
          promise: Promise.resolve({
            numPages: sizes.length,
            getPage: n =>
              Promise.resolve({
                getViewport: ({ scale }) => ({ width: sizes[n - 1][0] * scale, height: sizes[n - 1][1] * scale }),
                render: params => {
                  log.rendered.push({ n, w: params.canvas.width, h: params.canvas.height, intent: params.intent });
                  return { promise: n === failPage ? Promise.reject(new Error('bad stream')) : Promise.resolve() };
                },
                cleanup: () => log.cleaned++,
              }),
          }),
          destroy: () => {
            log.destroyed++;
            return Promise.resolve();
          },
        };
      },
    };
    const canvas = (w, h) => {
      const el = {
        width: w,
        height: h,
        getContext: () => ({ fillRect() {}, fillStyle: '' }),
      };
      log.released.push(el);
      return el;
    };
    return { lib, log, canvas };
  }

  describe('drawing a page', () => {
    it('draws each page with its long side at longSide, white first, as it would print', async () => {
      const { lib, log, canvas } = standIn([
        [612, 792],
        [842, 595],
      ]);
      PR.configure({ load: () => Promise.resolve(lib), canvas });
      const doc = await PR.openPdf(asFile(pagesPdf(2)), { longSide: 2000 });
      const one = await doc.page(1);
      const two = await doc.page(2);
      expect([one.width, one.height]).toEqual([1545, 2000]);
      expect([two.width, two.height]).toEqual([2000, 1413]);
      expect(one.source.width).toBe(1545);
      expect(log.rendered.map(r => r.intent)).toEqual(['print', 'print']);
      expect(log.cleaned).toBe(2);
      expect(lib.GlobalWorkerOptions.workerSrc).toBe('/vendor/pdfjs/pdf.worker.min.js');
      // The page's fonts are drawn as shapes, and no form script runs.
      expect(log.options).toMatchObject({ disableFontFace: true, enableXfa: false, wasmUrl: '/vendor/pdfjs/wasm/' });
      one.close();
      expect(one.source.width).toBe(0);
      doc.close();
      doc.close();
      expect(log.destroyed).toBe(1);
    });

    it('a tiny page is enlarged at most MAX_SCALE times', async () => {
      const { lib, canvas } = standIn([[100, 50]]);
      PR.configure({ load: () => Promise.resolve(lib), canvas });
      const doc = await PR.openPdf(asFile(pagesPdf(1)), { longSide: 2000 });
      const page = await doc.page(1);
      expect([page.width, page.height]).toEqual([100 * PR.MAX_SCALE, 50 * PR.MAX_SCALE]);
    });

    it('a page that fails to draw is refused as unreadable, and its canvas is freed', async () => {
      const { lib, log, canvas } = standIn(
        [
          [612, 792],
          [612, 792],
        ],
        { failPage: 2 },
      );
      PR.configure({ load: () => Promise.resolve(lib), canvas });
      const doc = await PR.openPdf(asFile(pagesPdf(2)));
      await expect(doc.page(2)).rejects.toMatchObject({ reason: 'unreadable' });
      expect(log.released[0].width).toBe(0);
    });
  });
});
