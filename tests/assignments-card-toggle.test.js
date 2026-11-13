/**
 * Opening or closing a card on the Assignments page draws or empties that
 * card alone (docs/plans/speed-assessment.md, section 4, item 1). It used
 * to redraw the whole page: 260 ms of script on a class of 30.
 *
 * Each test holds two things: the page after the click is what a whole
 * redraw draws (byte for byte, the toolbar and the list), and the cards
 * that did not change are the same elements as before, so nothing else
 * was drawn again. And render() works each card's counts out once a draw.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, seedClass, clearClass, click, openAssignments, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const ESSAY = U(31); // levels on a competency, in Unit 1
const LAB = U(33); // a rubric, in Unit 1
const QUIZ = U(32); // points, ungrouped
const EXIT = U(34); // Complete/Incomplete, in Unit 2
const QUESTION = U(41);
const RUBRIC = U(71);
const SAFETY = U(72);
const UNIT1 = 'm-unit1';
const UNIT2 = 'm-unit2';
const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };

const entry = (sid, aid, tid, score) => ({
  id: sid + ':' + aid + ':' + tid,
  assessmentId: aid,
  tagId: tid,
  score,
  date: '2026-10-10',
  type: 'summative',
  note: '',
  created: '2026-10-10T17:00:00.000Z',
});

const seed = () => {
  seedClass(CID, {
    students: [
      { id: AVA, firstName: 'Ava', lastName: 'Adams' },
      { id: BEN, firstName: 'Ben', lastName: 'Brown' },
      { id: CARA, firstName: 'Cara', lastName: 'Chen' },
    ],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    rubrics: [
      {
        id: RUBRIC,
        name: 'Lab Skills',
        criteria: [{ id: SAFETY, name: 'Safety', tagIds: [QUESTION], levels: WORDS, checks: [] }],
      },
    ],
    modules: [
      { id: UNIT1, name: 'Unit 1', color: '#6366f1' },
      { id: UNIT2, name: 'Unit 2', color: '#0891b2' },
    ],
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [QUESTION], date: '2026-10-10', type: 'summative', moduleId: UNIT1 },
      { id: LAB, title: 'Lab', rubricId: RUBRIC, tagIds: [], date: '2026-10-12', type: 'summative', moduleId: UNIT1 },
      { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
      {
        id: EXIT,
        title: 'Exit Ticket',
        scoreMode: 'complete',
        maxPoints: 1,
        tagIds: [QUESTION],
        date: '2026-10-13',
        moduleId: UNIT2,
      },
    ],
    scores: { [AVA]: [entry(AVA, ESSAY, QUESTION, 3), entry(AVA, QUIZ, QUESTION, 7)] },
    // Drafts and Returned marks are drawn, so what a card draws to return is kept too.
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
};

const toolbar = () => document.getElementById('page-toolbar-mount').innerHTML;
const main = () => document.getElementById('main').innerHTML;
const card = aid => document.getElementById('ac-' + aid);
const header = aid => card(aid).querySelector('.assess-header');
const isOpen = aid => card(aid).classList.contains('open');
const settled = () => new Promise(r => setTimeout(r, 10));

// Where two pictures part, or '' when they are the same.
function around(a, b) {
  if (a === b) return '';
  let i = 0;
  while (a[i] === b[i]) i++;
  return 'redrawn: ' + a.slice(Math.max(0, i - 120), i + 120) + '\nkept: ' + b.slice(Math.max(0, i - 120), i + 120);
}

/* The page as it is, then as a whole redraw draws it: the two must match. */
function sameAsRedraw() {
  const now = { toolbar: toolbar(), main: main() };
  window.PageAssignments.render();
  expect(around(toolbar(), now.toolbar)).toBe('');
  expect(around(main(), now.main)).toBe('');
}

/* The same for the toolbar and the card headers alone: a grid graded in
   place holds its own edits (a class or an attribute's order), which a
   redraw writes afresh. */
function sameHeadsAsRedraw() {
  const heads = () =>
    Array.from(document.querySelectorAll('#main .assess-header'))
      .map(h => h.outerHTML)
      .join('\n');
  const now = { toolbar: toolbar(), heads: heads() };
  window.PageAssignments.render();
  expect(around(toolbar(), now.toolbar)).toBe('');
  expect(around(heads(), now.heads)).toBe('');
}

let wasDemo;
beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
});
// The page's own timers run out before it closes: the next test loads a new
// copy of the page, and an old copy's timer would write into its page.
afterEach(async () => {
  await settled();
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  vi.restoreAllMocks();
});

describe('Assignments: one card opens and closes on its own', () => {
  it('opening a card draws its body and leaves every other card as it was', async () => {
    openAssignments(seed, CID, {});
    await settled();
    const others = [LAB, QUIZ, EXIT].map(card);
    const list = document.querySelector('#main .settings-grid');
    click(header(ESSAY));
    expect(isOpen(ESSAY)).toBe(true);
    expect(card(ESSAY).querySelector('.rsg-criterion-row, .ldg-row')).not.toBe(null);
    // Nothing else was drawn again.
    expect(document.querySelector('#main .settings-grid') === list).toBe(true);
    expect([LAB, QUIZ, EXIT].every((aid, i) => card(aid) === others[i])).toBe(true);
    expect(document.querySelector('[data-action="collapseAllAssess"]').getAttribute('aria-pressed')).toBe('false');
    sameAsRedraw();
  });

  it('closing it empties the body and sets Collapse again', async () => {
    openAssignments(seed, CID, { open: ESSAY });
    await settled();
    const lab = card(LAB);
    click(header(ESSAY));
    expect(isOpen(ESSAY)).toBe(false);
    expect(card(ESSAY).querySelector('.assess-body').innerHTML).toBe('');
    expect(card(LAB) === lab).toBe(true);
    expect(document.querySelector('[data-action="collapseAllAssess"]').getAttribute('aria-pressed')).toBe('true');
    sameAsRedraw();
  });

  it('a rubric card shows the hover bar while open, and hides it once closed', async () => {
    openAssignments(seed, CID, {});
    await settled();
    click(header(LAB));
    expect(document.getElementById('rsg-descriptor-bar').style.display).toBe('flex');
    click(header(LAB));
    expect(document.getElementById('rsg-descriptor-bar').style.display).toBe('none');
    sameAsRedraw();
  });

  it('what an opened card draws to return is remembered: an event that changes nothing rewrites none of it', async () => {
    openAssignments(seed, CID, {});
    await settled();
    click(header(ESSAY));
    const marks = Array.from(card(ESSAY).querySelectorAll('[data-ret-aid]'));
    expect(marks.length).toBeGreaterThan(0);
    const inside = marks.map(m => m.firstChild);
    click(document.getElementById('main'));
    await settled();
    expect(marks.every((m, i) => m.firstChild === inside[i] && m.isConnected)).toBe(true);
  });

  it('Expand and Collapse draw only the cards that change', async () => {
    openAssignments(seed, CID, { open: ESSAY });
    await settled();
    const essay = card(ESSAY);
    const grid = essay.querySelector('.assess-body').firstElementChild;
    click(document.querySelector('[data-action="expandAllAssess"]'));
    expect([ESSAY, LAB, QUIZ, EXIT].every(isOpen)).toBe(true);
    // The card already open keeps what it drew.
    expect(card(ESSAY) === essay).toBe(true);
    expect(essay.querySelector('.assess-body').firstElementChild === grid).toBe(true);
    sameAsRedraw();
    const quiz = card(QUIZ);
    click(document.querySelector('[data-action="collapseAllAssess"]'));
    expect([ESSAY, LAB, QUIZ, EXIT].some(isOpen)).toBe(false);
    expect(card(QUIZ) === quiz).toBe(true);
    sameAsRedraw();
  });

  it('a card in a closed folder redraws the page, as the folder opens or closes with it', async () => {
    openAssignments(seed, CID, {});
    await settled();
    click(document.querySelector('.mod-folder-header[data-uid="' + UNIT2 + '"]'));
    expect(document.querySelector('.mod-folder[data-module-id="' + UNIT2 + '"]').classList.contains('open')).toBe(
      false,
    );
    const quiz = card(QUIZ);
    click(header(EXIT));
    expect(isOpen(EXIT)).toBe(true);
    // The folder shows its open card.
    expect(document.querySelector('.mod-folder[data-module-id="' + UNIT2 + '"]').classList.contains('open')).toBe(true);
    expect(card(QUIZ) === quiz).toBe(false);
    sameAsRedraw();
    click(header(EXIT));
    expect(document.querySelector('.mod-folder[data-module-id="' + UNIT2 + '"]').classList.contains('open')).toBe(
      false,
    );
    sameAsRedraw();
  });

  it('one student: a card closes and opens again on its own', async () => {
    openAssignments(seed, CID, { student: AVA });
    await settled();
    expect([ESSAY, LAB, QUIZ, EXIT].every(isOpen)).toBe(true);
    const lab = card(LAB);
    click(header(ESSAY));
    expect(isOpen(ESSAY)).toBe(false);
    expect(card(LAB) === lab).toBe(true);
    sameAsRedraw();
    const quiz = card(QUIZ);
    click(header(ESSAY));
    expect(isOpen(ESSAY)).toBe(true);
    expect(card(QUIZ) === quiz).toBe(true);
    sameAsRedraw();
  });
});

// Ben's essay is in, on Send Work: the Essay has one to grade.
const withWork = () => {
  seed();
  const file = p => ({
    id: 'f' + p,
    page: p,
    path: [CID, ESSAY, BEN, 's1', 'f' + p].join('/') + '.jpg',
    thumb_path: [CID, ESSAY, BEN, 's1', 'f' + p].join('/') + '-thumb.jpg',
    sha256: ('h' + p).padEnd(64, '0'),
    bytes: 400000,
    thumb_bytes: 20000,
    width: 1546,
    height: 2000,
    rotation: 0,
    added_by: 'teacher',
  });
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: [ESSAY, LAB, QUIZ, EXIT].map(id => ({ id, students_send: 'photos', after_due: 'stop' })),
    submissions: [
      {
        id: 's1',
        assessment_id: ESSAY,
        enrollment_id: BEN,
        version: 1,
        state: 'sent',
        sent_by: 'teacher',
        on_paper: false,
        is_late: false,
        note: null,
        sent_at: '2026-11-13T19:00:00Z',
        created_at: '2026-11-13T19:00:00Z',
        files: [file(1), file(2)],
      },
    ],
  });
};

describe('Assignments: a card opened or closed brings its header counts up to date, as a redraw did', () => {
  it('a student marked Missing in a grid: the Missing count shows once another card opens', async () => {
    openAssignments(seed, CID, { open: ESSAY });
    await settled();
    click(card(ESSAY).querySelector('[data-action="toggleStudentStatus"][data-sid="' + CARA + '"][data-status="NS"]'));
    await settled();
    expect(card(ESSAY).querySelector('.assess-missing')).toBe(null);
    click(header(QUIZ));
    expect(card(ESSAY).querySelector('.assess-missing').textContent).toBe('1 missing');
    sameHeadsAsRedraw();
  });

  it('work graded in a grid: To Grade and Grade Submissions follow once another card opens', async () => {
    openAssignments(withWork, CID, { open: ESSAY });
    await settled();
    expect(card(ESSAY).querySelector('.assess-to-grade').textContent).toBe('1 to grade');
    expect(document.querySelector('.assess-tograde-n').textContent).toBe('1');
    const row = card(ESSAY).querySelector('.rsg-criterion-row[data-student="' + BEN + '"]');
    click(row.querySelector('.rsg-level.l3'));
    await settled();
    click(header(QUIZ));
    expect(card(ESSAY).querySelector('.assess-to-grade')).toBe(null);
    expect(card(ESSAY).querySelector('.assess-grade-work-btn')).toBe(null);
    expect(document.querySelector('.assess-tograde-n').textContent).toBe('0');
    sameHeadsAsRedraw();
  });

  it('with To Grade on, the page is drawn again, so a card with nothing left to grade leaves', async () => {
    openAssignments(withWork, CID, { open: ESSAY });
    await settled();
    click(document.querySelector('[data-action="setToGradeShow"][data-show="tograde"]'));
    await settled();
    expect(Array.from(document.querySelectorAll('#main .assess-card')).map(c => c.id)).toEqual(['ac-' + ESSAY]);
    const row = card(ESSAY).querySelector('.rsg-criterion-row[data-student="' + BEN + '"]');
    click(row.querySelector('.rsg-level.l3'));
    await settled();
    click(header(ESSAY));
    expect(document.querySelectorAll('#main .assess-card').length).toBe(0);
    sameAsRedraw();
  });
});

describe('Assignments: a draw works each card’s counts out once', () => {
  it('drafts and work to grade: one count a card, not three or four', async () => {
    openAssignments(withWork, CID, {});
    await settled();
    // The whole class on screen is the list every card's count is over.
    const whole = ids => Array.isArray(ids) && ids.length === 3;
    let drafts = 0;
    let work = 0;
    const draftsIn = GraderWork.draftsIn;
    const workCounts = GraderWork.workCounts;
    vi.spyOn(GraderWork, 'draftsIn').mockImplementation(function (cid, aid, ids) {
      if (whole(ids)) drafts++;
      return draftsIn.apply(this, arguments);
    });
    vi.spyOn(GraderWork, 'workCounts').mockImplementation(function (cid, aid, ids) {
      if (whole(ids)) work++;
      return workCounts.apply(this, arguments);
    });
    window.PageAssignments.render();
    expect(drafts).toBe(4);
    expect(work).toBe(4);
  });
});
