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
import './setup.js';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, unmount } from './helpers/gradebook-dom.js';
import { U, seedClass, clearClass, click, confirmOk, toastText } from './helpers/pin-save-paths.js';

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
