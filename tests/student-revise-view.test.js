/**
 * Revisions on the student's page, from the teacher's cache (S11-F2;
 * shared/student-view.js on shared/data.js's Revisions, PR 1084): what
 * Preview as Student shows, and that the student's own device draws the
 * same HTML from the same replies.
 *
 * The board's worked example (Socials 10, graded by both): the first
 * version is Developing + and Proficient, 2.7 · 67%; the revision is
 * Proficient and Proficient, 3.0 · 75%.
 * - Needs Revision while nothing is in, the grade kept (there is no Hide in
 *   this build: Colin, Nov 11);
 * - Sent again once the revision is in; a draft regrade changes nothing a
 *   student sees, and the grade they have is still 2.7 · 67%;
 * - once returned the new grade replaces the old, and Before and After
 *   shows both;
 * - Take Back gives the grade back and the revision is gone.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';
import { openStudentPage } from './helpers/student-page-context.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf-8');

const CID = U(1);
const PIECE = U(31);
const SUPPORT = U(41);
const LETTER = U(42);
const JORDAN = U(100);
const FIX = 'Add a third reason from Bourassa to the letter.';
const NOTE = 'I added how conscription split families in Quebec as the third reason.';
const PAGES = [{ path: 'revised-letter-1.jpg', thumb_path: 'revised-letter-1-thumb.jpg' }];
let wasDemo;
let n = 0;
const key = () => 'k' + ++n;
const at = iso => vi.setSystemTime(new Date(iso));

function seed({ holds = true } = {}) {
  seedClass(CID, {
    students: [{ id: JORDAN, firstName: 'Jordan', lastName: 'Reyes' }],
    learningMaps: {
      subjects: [],
      sections: [
        {
          id: U(51),
          name: 'Conscription',
          tags: [
            { id: SUPPORT, label: 'Support and Opposition', text: 'Explain who supported and opposed it' },
            { id: LETTER, label: 'Letter to the Editor', text: 'Argue a position with reasons' },
          ],
        },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      {
        id: PIECE,
        title: '2.6 The Conscription Crisis',
        tagIds: [LETTER, SUPPORT],
        date: '2026-10-20',
        dueDate: '2026-10-30',
      },
    ],
    courseConfigs: holds ? { student_page_enabled: true, return_grades: 'on_return' } : { student_page_enabled: true },
  });
  COURSES[CID].gradingSystem = 'both';
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: [{ id: PIECE, students_send: 'photos' }],
    submissions: [
      {
        id: 'sub-jordan-v1',
        assessment_id: PIECE,
        enrollment_id: JORDAN,
        version: 1,
        state: 'sent',
        sent_by: 'student',
        on_paper: false,
        is_late: false,
        note: null,
        // Midday, so the day is the same wherever the test runs.
        sent_at: '2026-10-30T19:41:00.000Z',
        created_at: '2026-10-30T19:40:00.000Z',
        files: [{ id: 'f1', page: 1, path: 'letter-1.jpg', thumb_path: 'letter-1-thumb.jpg' }],
      },
    ],
  });
}

function gradeFirstVersion() {
  at('2026-11-01T18:00:00.000Z');
  Grader.setLevel(CID, JORDAN, PIECE, SUPPORT, 3, 0);
  Grader.setLevel(CID, JORDAN, PIECE, LETTER, 2, 1);
  Grader.returnGrades(CID, PIECE, [JORDAN]);
}
async function askForRevision(over = {}) {
  at('2026-11-02T18:00:00.000Z');
  return returnForRevision(
    CID,
    JORDAN,
    PIECE,
    { what_to_fix: FIX, revise_by: '2026-11-10', criterion_ids: [], keep_grade: true, ...over },
    key(),
  );
}
function sendRevision() {
  at('2026-11-09T19:12:00.000Z');
  return sendStudentRevision(CID, JORDAN, PIECE, PAGES, NOTE, JORDAN);
}
function regrade() {
  at('2026-11-10T16:00:00.000Z');
  Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
}

const preview = () => StudentView.fromCache(CID, JORDAN);
const pieceIn = view => view.work.find(p => p.id === PIECE);

const DOC = parseHTML('<!doctype html><html><body></body></html>').document;
function drawn(view, ui) {
  const box = DOC.createElement('div');
  box.innerHTML = StudentPageView.html(view, ui);
  return box;
}
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const parts = r => [...r.querySelectorAll('.sp-ba-name, .sp-level, .sp-ba-same')].map(words);

// The student's own device: s/student-data.js, calc.js and student-view.js on their own.
let side = null;
function studentSide() {
  if (side) return side;
  const page = openStudentPage();
  ['shared/constants.js', 'shared/calc.js', 'shared/student-view.js', 's/page-view.js'].forEach(f =>
    vm.runInContext(read(f), page.ctx, { filename: f }),
  );
  side = page;
  return side;
}
function phoneHtml(reply, feedback, ui) {
  const page = studentSide();
  page.ctx.__reply = JSON.parse(JSON.stringify(reply));
  page.ctx.__feedback = JSON.parse(JSON.stringify(feedback));
  page.ctx.__ui = ui;
  return page.run(
    'StudentData.use(StudentData.fromServer(__reply)); StudentPageView.html(StudentView.fromPage(__reply, StudentData.page(), null, __feedback), __ui)',
  );
}
const UIS = [
  { tab: 'assignments', segment: 'todo' },
  { tab: 'assignments', segment: 'sent' },
  { tab: 'assignments', segment: 'back' },
  { tab: 'assignments', all: true },
  { tab: 'assignments', all: true, filter: 'revise' },
  { tab: 'assignments', segment: 'todo', feedback: PIECE, pick: PIECE },
  { tab: 'assignments', segment: 'back', feedback: PIECE, pick: PIECE },
  { tab: 'assignments', segment: 'back', feedback: PIECE, pick: PIECE, compare: true },
];
function sameOnBoth() {
  const built = preview();
  UIS.forEach(ui =>
    expect(StudentPageView.html(built.view, ui), JSON.stringify(ui)).toBe(phoneHtml(built.reply, built.feedback, ui)),
  );
  return built;
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  vi.useFakeTimers({ toFake: ['Date'] });
  localStorage.clear();
  seed();
});
afterEach(() => {
  vi.useRealTimers();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  clearProfCache();
});

describe('the loop in Preview as Student, and the same HTML on the student’s device', () => {
  it('Needs Revision with the grade kept: What to Fix and the date, the grade still 2.7 · 67%', async () => {
    gradeFirstVersion();
    expect((await askForRevision()).result).toBe('made');
    const { view } = sameOnBoth();
    const p = pieceIn(view);
    expect(p.kind).toBe('revise');
    expect(p.result.text).toBe('2.7 · 67%');
    expect(p.revision).toMatchObject({ state: 'open', whatToFix: FIX, reviseBy: '2026-11-10' });
    expect(view.counts.toDo).toBe(1);
    const box = drawn(view, UIS[0]);
    expect(words(box.querySelector('.sp-flag-revise'))).toBe('Revise by Tue, Nov 10');
    expect(words(box.querySelector('.sp-revise-fix'))).toBe(FIX);
    // Preview has no `work` reply: no Send My Revision there, as there is no Send My Work.
    expect(box.querySelector('[data-act="revise-open"]')).toBeNull();
    expect(box.innerHTML).not.toMatch(/Colin|Brown/);
  });

  it('sent, then a draft regrade: Sent again, and the student still has 2.7 · 67%', async () => {
    gradeFirstVersion();
    await askForRevision();
    expect(sendRevision().ok).toBe(true);
    let p = pieceIn(sameOnBoth().view);
    expect(p.kind).toBe('sent');
    expect(p.revision).toMatchObject({ state: 'sent', note: NOTE, sentAt: '2026-11-09T19:12:00.000Z' });
    regrade();
    const { view, feedback } = sameOnBoth();
    p = pieceIn(view);
    // A draft is never the student's: grading reads as sent, and the result is the grade they were given.
    expect(feedback.assessments[0].revision.state).toBe('sent');
    expect(p.kind).toBe('sent');
    expect(p.result.text).toBe('2.7 · 67%');
    expect(p.revision.before).toBeNull();
  });

  it('returned: 3.0 · 75% replaces 2.7 · 67%, and Before and After shows both, row by row', async () => {
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    regrade();
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    const { view } = sameOnBoth();
    const p = pieceIn(view);
    expect(p.kind).toBe('back');
    expect(p.result.text).toBe('3.0 · 75%');
    const box = drawn(view, UIS[7]);
    expect(words(box.querySelector('.sp-fb-sub'))).toBe('Science 8 · Revision returned Nov 10');
    expect(parts(box.querySelector('.sp-ba-result .sp-ba-row'))).toEqual(['Your Result', '2.7 · 67%', '3.0 · 75%']);
    expect([...box.querySelectorAll('.sp-ba-rows:not(.sp-ba-result) .sp-ba-row')].map(parts)).toEqual([
      // In the page's own order of competencies (the reply sends them sorted).
      ['Support and Opposition', 'No change', 'Proficient'],
      ['Letter to the Editor', 'Developing +', 'Proficient'],
    ]);
    expect([...box.querySelectorAll('.sp-ba-sent')].map(words)).toEqual(['Sent Oct 30', 'Sent Nov 9']);
    expect([...box.querySelectorAll('.sp-ba-words')].map(words)).toEqual([FIX, NOTE]);
    // Reading the first version's result left every number as it was.
    expect(withReturnedOnly(() => formatLevel(CID, getOverallProficiency(CID, JORDAN)))).toBe('3.0 · 75%');
  });

  it('Take Back: the revision is gone and the grade is the student’s as it was', async () => {
    gradeFirstVersion();
    const made = await askForRevision();
    expect((await cancelRevision(CID, made.request.id, key())).result).toBe('cancelled');
    const p = pieceIn(sameOnBoth().view);
    expect(p.revision).toBeNull();
    expect(p.kind).toBe('back');
    expect(p.result.text).toBe('2.7 · 67%');
  });

  it('with Send Work off nothing about revisions shows, and the page is as it was', async () => {
    gradeFirstVersion();
    await askForRevision();
    const on = StudentPageView.html(preview().view, UIS[0]);
    const work = JSON.parse(localStorage.getItem('gb-student-work-' + CID));
    work.course.send_work = false;
    localStorage.setItem('gb-student-work-' + CID, JSON.stringify(work));
    const { view, feedback } = preview();
    expect(feedback.assessments).toEqual([]);
    expect(pieceIn(view).revision).toBeNull();
    expect(pieceIn(view).kind).toBe('back');
    const html = UIS.map(ui => StudentPageView.html(view, ui)).join('');
    expect(html).not.toMatch(/Needs Revision|sp-revise|Before and After/);
    expect(on).toMatch(/sp-revise/);
  });

  it('on the student’s device, working the first version out puts the page back as it was', async () => {
    gradeFirstVersion();
    await askForRevision();
    sendRevision();
    regrade();
    Grader.returnGrades(CID, PIECE, [JORDAN]);
    const built = preview();
    phoneHtml(built.reply, built.feedback, UIS[7]);
    const page = studentSide();
    expect(page.run('StudentData.page() !== null && StudentData.page().grades')).toBeTruthy();
    // The piece reads its own returned grade again after Before and After was worked out.
    expect(
      page.run(
        'clearProfCache(); var _p = StudentData.page(); _p.course.id + "|" + assessmentCellValue(_p.course.id, _p.student.id, _p.assessments[0]).text',
      ),
    ).toMatch(/\|3\.0 · 75%$/);
  });
});
