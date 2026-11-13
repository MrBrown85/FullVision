/**
 * One score entered in the gradebook draws again only what it changes: the
 * cell, its student's Overall, the Class Average row and, where they
 * change, the piece's "N to return", Return N Graded and "N to grade"
 * (page-gradebook.js, _redrawStudent). Closing the grader writes only the
 * parts of the page that differ from what is on it, and nothing when
 * nothing does (_redraw, GradebookChrome.patch). Before, each did the whole page: about
 * 3,000 cells on a class the size of History 12, laid out three times.
 *
 * What the teacher sees must not change. So each case here checks two
 * things: that the other students' rows are the very same elements as
 * before (they were not drawn again), and that the page then reads exactly
 * as a whole redraw of it does.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, closePages, click, key, leave } from './helpers/pin-save-paths.js';
import { mount, unmount, showCompetencies } from './helpers/gradebook-dom.js';
import { runInThisContext } from 'vm';
import { readFileSync } from 'fs';

const CID = U(1);
const [AVA, BEN, CARA, DEV] = [U(11), U(12), U(13), U(14)];
const ESSAY = U(31); // levels on two competencies
const QUIZ = U(32); // points, out of 10
const EXIT = U(33); // Complete / Incomplete
const TALK = U(34); // pair work: Ava and Ben are graded together
const LAB = U(35); // a rubric
const [QUESTION, PLAN] = [U(41), U(42)];
const [RUBRIC, SAFETY, METHOD] = [U(71), U(72), U(73)];
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

function seedWith(config) {
  return () => {
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
        { id: CARA, firstName: 'Cara', lastName: 'Chen' },
        { id: DEV, firstName: 'Dev', lastName: 'Dhillon' },
      ],
      learningMaps: {
        subjects: [],
        sections: [
          { id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] },
          { id: U(52), name: 'Plan', tags: [{ id: PLAN, label: 'Plan', text: 'Plan a test' }] },
        ],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      rubrics: [
        {
          id: RUBRIC,
          name: 'Lab Skills',
          criteria: [
            { id: SAFETY, name: 'Safety', tagIds: [QUESTION], levels: WORDS, checks: [] },
            { id: METHOD, name: 'Method', tagIds: [PLAN], levels: WORDS, checks: [] },
          ],
        },
      ],
      assessments: [
        { id: ESSAY, title: 'Essay', tagIds: [QUESTION, PLAN], date: '2026-10-10', type: 'summative' },
        { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
        { id: EXIT, title: 'Exit Ticket', scoreMode: 'complete', maxPoints: 1, tagIds: [QUESTION], date: '2026-10-12' },
        {
          id: TALK,
          title: 'Pair Talk',
          tagIds: [QUESTION],
          date: '2026-10-13',
          type: 'summative',
          collaboration: 'pair',
          pairs: [[AVA, BEN]],
        },
        { id: LAB, title: 'Lab', rubricId: RUBRIC, tagIds: [], date: '2026-10-14', type: 'summative' },
      ],
      scores: {
        [AVA]: [entry(AVA, ESSAY, QUESTION, 3), entry(AVA, QUIZ, QUESTION, 7), entry(AVA, LAB, SAFETY, 2)],
        [CARA]: [entry(CARA, ESSAY, QUESTION, 2)],
      },
      courseConfigs: config,
    });
    // Cara sent her Essay and it is not graded in full: "N to grade".
    saveDemoStudentWork(CID, {
      course: { send_work: true },
      assessments: [ESSAY, QUIZ, EXIT, TALK, LAB].map(id => ({ id, students_send: 'photos', after_due: 'stop' })),
      submissions: [
        {
          id: 'w1',
          assessment_id: QUIZ,
          enrollment_id: DEV,
          version: 1,
          state: 'sent',
          sent_by: 'student',
          on_paper: false,
          is_late: false,
          note: null,
          sent_at: '2026-11-12T19:00:00Z',
          created_at: '2026-11-12T19:00:00Z',
          files: [],
        },
      ],
    });
  };
}

// The classes a score can draw differently in: grades shown at once, and
// held as drafts until returned with the student page and Send Work on.
const CLASSES = [
  ['a plain class', {}],
  ['a class that holds grades until they are returned', { student_page_enabled: true, return_grades: 'on_return' }],
];

const main = () => document.getElementById('main').innerHTML;
const row = sid => document.querySelector('#gb-data tr[data-sid="' + sid + '"]');
const compCell = (aid, sid, tid) =>
  document.querySelector(
    '#gb-data td.gb-score[data-aid="' +
      aid +
      '"][data-sid="' +
      sid +
      '"]' +
      (tid ? '[data-tid="' + tid + '"]' : '[data-pts="1"]'),
  );
const scoresCell = (aid, sid) =>
  document.querySelector('#gb-data td.gb-scores-cell[data-aid="' + aid + '"][data-sid="' + sid + '"]');
function select(cell) {
  document.querySelectorAll('#gb-data .gb-focus').forEach(el => el.classList.remove('gb-focus'));
  cell.classList.add('gb-focus');
  cell.focus();
  return cell;
}

/* What the page reads, with the selected cell kept: a redraw of the whole
   page selects the same cell again. The data area's scroll is linkedom's
   (it has none): a whole redraw writes its "undefined" into the headers. */
const read = () =>
  main()
    .replace(/ style="transform:translateX\(-undefinedpx\)"/g, '')
    .replace(/ style=""/g, '');
function sameAsWholeRedraw() {
  const now = read();
  PageGradebook.render();
  expect(now).toBe(read());
}

// The page sends its own input event on points typed (new Event): linkedom's, here.
function open(config) {
  mount(seedWith(config), { course: CID });
  globalThis.Event = document.defaultView.Event;
}

let wasDemo;
let nodeEvent;
beforeEach(() => {
  wasDemo = window.isDemoMode;
  nodeEvent = globalThis.Event;
  window.isDemoMode = () => true;
});
afterEach(() => {
  globalThis.Event = nodeEvent;
  closePages();
  unmount();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe.each(CLASSES)('in %s, one score draws only its student again', (_, config) => {
  // Each: what to do, the row that changes, and the rows that must not.
  const CASES = [
    ['a level typed in the Competencies view', true, () => key(select(compCell(ESSAY, DEV, QUESTION)), '4'), [DEV]],
    ['a level cleared', true, () => key(select(compCell(ESSAY, AVA, QUESTION)), 'Backspace'), [AVA]],
    ['+ on a level', true, () => key(select(compCell(ESSAY, AVA, QUESTION)), '+'), [AVA]],
    ['C on Complete / Incomplete', true, () => key(select(compCell(EXIT, CARA)), 'c'), [CARA]],
    [
      'points typed',
      true,
      () => {
        key(select(compCell(QUIZ, DEV)), '8');
        key(document.querySelector('.gb-pts-input'), 'Escape');
        key(select(compCell(QUIZ, DEV)), '9');
        const box = document.querySelector('.gb-pts-input');
        box.value = '9';
        leave(box);
      },
      [DEV],
    ],
    [
      'a level on pair work, which the partner gets too',
      true,
      () => key(select(compCell(TALK, AVA, QUESTION)), '3'),
      [AVA, BEN],
    ],
    [
      'Edit Score in the Scores view',
      false,
      () => {
        key(select(scoresCell(ESSAY, CARA)), '4');
        leave(document.querySelector('.gb-scores-input'));
      },
      [CARA],
    ],
  ];
  it.each(CASES)('%s', (_, competencies, act, changed) => {
    open(config);
    if (competencies) showCompetencies();
    const before = {};
    [AVA, BEN, CARA, DEV].forEach(sid => (before[sid] = row(sid)));
    act();
    [AVA, BEN, CARA, DEV].forEach(sid => {
      expect(row(sid) === before[sid], sid + "'s row was drawn again").toBe(true);
    });
    expect(document.activeElement.matches('#gb-data td.gb-focus'), 'the cell keeps the keyboard').toBe(true);
    sameAsWholeRedraw();
  });

  it('a first grade on held work adds a draft: "N to return" and Return N Graded follow', () => {
    open(config);
    showCompetencies();
    const pill = () => document.querySelector('.gb-to-return');
    const was = pill() ? pill().textContent : '';
    key(select(compCell(ESSAY, DEV, PLAN)), '3');
    if (config.return_grades) expect(pill().textContent).not.toBe(was);
    sameAsWholeRedraw();
  });

  it('a grade on sent work takes it off "N to grade"', () => {
    open(config);
    showCompetencies();
    const toGrade = () => document.querySelector('.gb-to-grade-btn');
    // Send Work shows only with the student page on.
    const on = !!config.student_page_enabled;
    expect(on ? toGrade().textContent : toGrade()).toBe(on ? '1 to grade' : null);
    key(select(compCell(QUIZ, DEV)), '6');
    const box = document.querySelector('.gb-pts-input');
    box.value = '6';
    leave(box);
    expect(toGrade()).toBeNull();
    sameAsWholeRedraw();
  });
});

describe('a sort by grade redraws the whole grid, as the order may change', () => {
  it('sorted by Overall', () => {
    open({});
    showCompetencies();
    click(document.querySelector('[data-action="toggleSort"][data-sortkey="overall"]'));
    const other = row(AVA);
    key(select(compCell(ESSAY, DEV, QUESTION)), '4');
    expect(row(AVA) === other).toBe(false);
    sameAsWholeRedraw();
  });
});

describe('closing the grader opened from the gradebook', () => {
  function openFromGradebook(seed, sid) {
    mount(seed, { course: CID });
    runInThisContext(readFileSync('teacher/page-assignments.js', 'utf-8'), { filename: 'teacher/page-assignments.js' });
    click(scoresCell(LAB, sid));
    expect(document.getElementById('grader-overlay')).not.toBeNull();
  }

  it.each(CLASSES)('in %s, writes nothing when nothing changed', (_, config) => {
    const real = window.PageAssignments;
    try {
      openFromGradebook(seedWith(config), AVA);
      const grid = document.getElementById('gb-data');
      const toolbar = document.querySelector('.gb-toolbar');
      const rows = [AVA, BEN, CARA, DEV].map(row);
      PageAssignments.closeGrader();
      expect(document.getElementById('gb-data')).toBe(grid);
      expect(document.querySelector('.gb-toolbar')).toBe(toolbar);
      expect([AVA, BEN, CARA, DEV].map(row)).toEqual(rows);
      expect(document.activeElement.matches('#gb-data td.gb-scores-cell[data-sid="' + AVA + '"]')).toBe(true);
      sameAsWholeRedraw();
    } finally {
      PageAssignments.destroy();
      window.PageAssignments = real;
    }
  });

  it.each(CLASSES)('in %s, a level changed draws only that student again', (_, config) => {
    const real = window.PageAssignments;
    try {
      openFromGradebook(seedWith(config), AVA);
      const grid = document.getElementById('gb-data');
      const others = [BEN, CARA, DEV].map(row);
      const ava = row(AVA);
      click(
        document.querySelector(
          '#grader-overlay [data-action="graderLevel"][data-critid="' + SAFETY + '"][data-level="4"]',
        ),
      );
      PageAssignments.closeGrader();
      expect(getScores(CID)[AVA].find(e => e.assessmentId === LAB && e.tagId === SAFETY).score).toBe(4);
      expect(document.getElementById('gb-data')).toBe(grid);
      expect([BEN, CARA, DEV].map(row)).toEqual(others);
      expect(row(AVA) === ava).toBe(false);
      sameAsWholeRedraw();
    } finally {
      PageAssignments.destroy();
      window.PageAssignments = real;
    }
  });
});
