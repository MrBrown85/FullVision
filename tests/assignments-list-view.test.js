/**
 * The Assignments page's List view (teacher/assign-list.js; Colin, Nov 16:
 * "Bulk edit assignments, like schoology. Assignments listed, can filter,
 * change order, but along the row there are options to change the
 * settings"). Mockup approved Nov 16.
 *
 * Signed in, every change goes out the way the form's Save Changes sends
 * it: one update_assessment per piece that changed, with only the fields
 * that changed. Students Send is kept with the class's student work
 * (saveAssessmentStudentWork). Sorting changes nothing until Keep This
 * Order; a move by the handle numbers the class 1..n.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  click,
  fire,
  key,
  tick,
  settle,
  confirmOk,
  openAssignments,
  closePages,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const LABS = U(21);
const QUIZZES = U(22);
const PRACTICE = U(23); // 0%: counts toward nothing
const CELLS = U(61);
const CHEM = U(62);
const LAB = U(31);
const QUIZ = U(32);
const TEST = U(33);
const HUNT = U(34);
const Q = U(41);
let wasDemo;
let session = null;

const ASSESSMENTS = [
  { id: LAB, title: 'Cell Lab', tagIds: [Q], date: '2026-09-10', categoryId: LABS, moduleId: CELLS, display_order: 1 },
  {
    id: QUIZ,
    title: 'Cell Quiz',
    tagIds: [Q],
    date: '2026-09-20',
    dueDate: '2026-09-22',
    categoryId: QUIZZES,
    moduleId: CELLS,
    scoreMode: 'points',
    maxPoints: 10,
    display_order: 2,
  },
  {
    id: TEST,
    title: 'Atoms Test',
    tagIds: [Q],
    date: '2026-10-05',
    dueDate: '2026-10-05',
    categoryId: QUIZZES,
    moduleId: CHEM,
    scoreMode: 'points',
    maxPoints: 50,
    weight: 2,
    display_order: 3,
  },
  {
    id: HUNT,
    title: 'Element Hunt',
    tagIds: [Q],
    date: '2026-10-12',
    categoryId: PRACTICE,
    scoreMode: 'complete',
    maxPoints: 1,
    display_order: 4,
  },
];

function seed() {
  seedClass(CID, {
    students: [{ id: U(11), firstName: 'Ava', lastName: 'Adams' }],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    categories: [
      { id: LABS, name: 'Labs', weight: 50, displayOrder: 0 },
      { id: QUIZZES, name: 'Quizzes', weight: 50, displayOrder: 1 },
      { id: PRACTICE, name: 'Practice', weight: 0, displayOrder: 2 },
    ],
    modules: [
      { id: CELLS, name: 'Cells', sortOrder: 0 },
      { id: CHEM, name: 'Chemistry', sortOrder: 1 },
    ],
    courseConfigs: {
      reportingTerms: [
        { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-09-30' },
        { ordinal: 2, label: 'Term 2', starts_on: '2026-10-01', ends_on: '2027-01-31' },
      ],
    },
    assessments: structuredClone(ASSESSMENTS),
  });
  // The server holds these rows, as a load says, so a save sends only what changed.
  _rememberServerState('assessments', CID, structuredClone(ASSESSMENTS));
}

function openList() {
  AssignList.setView(true);
  openAssignments(seed, CID, {});
}

const main = () => document.getElementById('main');
const rowIds = () => Array.from(main().querySelectorAll('tr[data-alv-row]')).map(tr => tr.dataset.alvRow);
const ctl = (aid, k) => main().querySelector('[data-alv-f="' + aid + ':' + k + '"]');
const piece = aid => getAssessments(CID).find(a => a.id === aid);
const updates = () =>
  session
    .since()
    .filter(([name]) => name === 'update_assessment')
    .map(([, p]) => [p.p_id, p.p_patch]);

/* Choose an option the way a person does: the select's value, then change. */
function choose(select, value) {
  Array.from(select.querySelectorAll('option')).forEach(o => {
    if (o.getAttribute('value') === value) o.setAttribute('selected', '');
    else o.removeAttribute('selected');
  });
  fire(select, 'change');
}
function enter(input, value) {
  input.value = value;
  fire(input, 'change');
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => false;
  localStorage.clear();
  session = signIn();
});
afterEach(() => {
  closePages();
  clearClass(CID);
  session.signOut();
  session = null;
  AssignList.setView(false);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('Grade | Bulk Edit', () => {
  it('List draws one row per assessment in the class order, without Expand and Collapse', () => {
    AssignList.setView(false);
    openAssignments(seed, CID, {});
    expect(document.querySelector('.assess-view-seg')).not.toBeNull();
    expect(document.querySelector('.assess-seg-control')).not.toBeNull();
    click(document.querySelector('[data-alv-view="list"]'));
    expect(AssignList.on()).toBe(true);
    expect(rowIds()).toEqual([LAB, QUIZ, TEST, HUNT]);
    expect(document.querySelector('.assess-seg-control')).toBeNull();
    expect(main().querySelector('.assess-card')).toBeNull();
    // Scoring is shown, not changed.
    expect(ctl(QUIZ, 'title').closest('tr').querySelector('.alv-scoring').textContent).toBe('10 Points');
    click(document.querySelector('[data-alv-view="cards"]'));
    expect(main().querySelector('.assess-card')).not.toBeNull();
  });

  it('Open puts the assessment form above the List', () => {
    openList();
    click(ctl(QUIZ, 'open'));
    const form = document.getElementById('new-assess-form');
    expect(form.style.display).toBe('block');
    expect(form.querySelector('#af-title').value).toBe('Cell Quiz');
  });
});

describe('a change along a row', () => {
  it('saves only that field, as the form does', async () => {
    openList();
    await settle();
    session.since();
    enter(ctl(LAB, 'due'), '2026-09-14');
    await settle();
    expect(updates()).toEqual([[LAB, { due_date: '2026-09-14' }]]);
    choose(ctl(LAB, 'category'), QUIZZES);
    await settle();
    expect(updates()).toEqual([[LAB, { category_id: QUIZZES }]]);
    choose(ctl(QUIZ, 'module'), '');
    await settle();
    expect(updates()).toEqual([[QUIZ, { module_id: null }]]);
    enter(ctl(TEST, 'title'), '  Atoms Unit Test ');
    await settle();
    expect(updates()).toEqual([[TEST, { title: 'Atoms Unit Test' }]]);
    enter(ctl(TEST, 'date'), '2026-10-06');
    await settle();
    expect(updates()).toEqual([[TEST, { date_assigned: '2026-10-06' }]]);
    // Taking a due date off.
    enter(ctl(QUIZ, 'due'), '');
    await settle();
    expect(updates()).toEqual([[QUIZ, { due_date: null }]]);
    expect(piece(QUIZ).dueDate).toBeUndefined();
  });

  it('a blank Title or Date Assigned is not saved', async () => {
    openList();
    await settle();
    session.since();
    enter(ctl(LAB, 'title'), '   ');
    enter(ctl(LAB, 'date'), '');
    await settle();
    expect(updates()).toEqual([]);
    expect(ctl(LAB, 'title').value).toBe('Cell Lab');
  });

  it('the Factor steps by 0.5, takes a typed one, and its share shows the change', async () => {
    openList();
    await settle();
    session.since();
    const before = AssignList.shareText(CID, piece(QUIZ));
    click(ctl(QUIZ, 'up'));
    confirmOk();
    await settle();
    expect(updates()).toEqual([[QUIZ, { weight: '1.5' }]]);
    expect(ctl(QUIZ, 'factor').value).toBe('1.5');
    enter(ctl(QUIZ, 'factor'), '1');
    confirmOk();
    await settle();
    expect(updates()).toEqual([[QUIZ, { weight: '1' }]]);
    expect(piece(QUIZ).weight).toBeUndefined();
    enter(ctl(QUIZ, 'factor'), 'abc');
    await settle();
    expect(updates()).toEqual([]);
    expect(before).toBe(AssignList.shareText(CID, piece(QUIZ)));
    // Where the class shows a course %: the share, as the form's bar says it
    // (the category is in the row, so it is not named again).
    COURSES[CID].gradingSystem = 'letter';
    COURSES[CID].gradeLevel = '11';
    expect(AssignList.shareText(CID, piece(HUNT))).toBe('Its category counts 0%');
    expect(AssignList.shareText(CID, piece(QUIZ))).toBe('\u2248 9% of its category');
    expect(AssignList.shareText(CID, { ...piece(QUIZ), weight: 10 })).toBe('50% of its category');
  });
});

describe('the ticked rows', () => {
  it('Shift-click ticks a run; Set Category changes them all, and Undo puts each back', async () => {
    openList();
    await settle();
    session.since();
    tick(ctl(LAB, 'tick'), true);
    const box = ctl(TEST, 'tick');
    box.checked = true;
    box.setAttribute('checked', '');
    const e = new document.defaultView.Event('click', { bubbles: true, cancelable: true });
    e.shiftKey = true;
    box.dispatchEvent(e);
    expect(main().querySelector('.alv-bar-n').textContent).toBe('3 Selected');
    choose(main().querySelector('[data-alv-bulk="category"]'), PRACTICE);
    confirmOk();
    await settle();
    expect(updates()).toEqual([
      [LAB, { category_id: PRACTICE }],
      [QUIZ, { category_id: PRACTICE }],
      [TEST, { category_id: PRACTICE }],
    ]);
    expect(main().querySelector('.alv-bar-done').textContent).toBe('Set Category for 3 assessments.');
    click(main().querySelector('[data-alv-act="undo"]'));
    await settle();
    expect(updates()).toEqual([
      [LAB, { category_id: LABS }],
      [QUIZ, { category_id: QUIZZES }],
      [TEST, { category_id: QUIZZES }],
    ]);
  });

  it('Set Due Date, Set Module and Set Factor reach only the ticked rows', async () => {
    openList();
    await settle();
    session.since();
    tick(ctl(LAB, 'tick'), true);
    tick(ctl(HUNT, 'tick'), true);
    enter(main().querySelector('[data-alv-bulk="due"]'), '2026-12-01');
    await settle();
    expect(updates()).toEqual([
      [LAB, { due_date: '2026-12-01' }],
      [HUNT, { due_date: '2026-12-01' }],
    ]);
    choose(main().querySelector('[data-alv-bulk="module"]'), '-');
    choose(main().querySelector('[data-alv-bulk="factor"]'), '2');
    confirmOk();
    await settle();
    // Two changes before either is sent go out together.
    expect(updates()).toEqual([
      [LAB, { weight: '2', module_id: null }],
      [HUNT, { weight: '2' }],
    ]);
  });
});

describe('a change that moves grades asks first, and can be undone', () => {
  const question = () => {
    const card = document.querySelector('.confirm-card');
    return card
      ? [card.querySelector('.confirm-title').textContent, card.querySelector('.confirm-message').textContent]
      : null;
  };
  const cancel = () => document.getElementById('confirm-cancel-btn').onclick();

  it('a Factor asks; Cancel sends nothing and the row keeps what was saved', async () => {
    openList();
    await settle();
    session.since();
    click(ctl(QUIZ, 'up'));
    expect(question()).toEqual([
      'Change the Factor?',
      '“Cell Quiz” will count 1.5× as much as work at Factor 1×. This changes students’ grades. You can undo it.',
    ]);
    expect(ctl(QUIZ, 'factor').value).toBe('1');
    cancel();
    await settle();
    expect(question()).toBeNull();
    expect(updates()).toEqual([]);
    expect(piece(QUIZ).weight).toBeUndefined();
  });

  it('OK saves it, and Undo puts it back without asking', async () => {
    openList();
    await settle();
    session.since();
    enter(ctl(TEST, 'factor'), '3');
    confirmOk();
    await settle();
    expect(updates()).toEqual([[TEST, { weight: '3' }]]);
    expect(main().querySelector('.alv-undo-bar').textContent).toContain('Changed the Factor of “Atoms Test”.');
    click(main().querySelector('[data-alv-act="undo"]'));
    expect(question()).toBeNull();
    await settle();
    expect(updates()).toEqual([[TEST, { weight: '2' }]]);
    expect(main().querySelector('.alv-undo-bar')).toBeNull();
  });

  it('in a Letter class the question says how the share moves', () => {
    COURSES[CID] = { ...COURSES[CID] };
    openList();
    COURSES[CID].gradingSystem = 'letter';
    COURSES[CID].gradeLevel = '11';
    click(ctl(QUIZ, 'up'));
    expect(question()[1]).toBe(
      '“Cell Quiz” will count 1.5× as much as work at Factor 1×. Its share of its category goes from ≈ 9% to ≈ 13%. This changes students’ grades. You can undo it.',
    );
    cancel();
  });

  it('a Category asks when it moves grades: into or out of 0%, or any move in a Letter class', async () => {
    openList();
    await settle();
    session.since();
    // Proficiency, between two categories that count: no grade moves.
    choose(ctl(LAB, 'category'), QUIZZES);
    expect(question()).toBeNull();
    await settle();
    expect(updates()).toEqual([[LAB, { category_id: QUIZZES }]]);
    choose(ctl(LAB, 'category'), PRACTICE);
    expect(question()).toEqual([
      'Change the Category?',
      '“Cell Lab” moves from Quizzes to Practice. Practice counts 0%, so it will count toward no grade. This changes students’ grades. You can undo it.',
    ]);
    cancel();
    choose(ctl(HUNT, 'category'), LABS);
    expect(question()[1]).toBe(
      '“Element Hunt” moves from Practice to Labs. It will start counting toward grades. This changes students’ grades. You can undo it.',
    );
    cancel();
    COURSES[CID].gradingSystem = 'letter';
    choose(ctl(QUIZ, 'category'), LABS);
    expect(question()[0]).toBe('Change the Category?');
    cancel();
    await settle();
    expect(updates()).toEqual([]);
  });

  it('a Date Assigned asks only when it crosses the end of a term', async () => {
    openList();
    await settle();
    session.since();
    enter(ctl(LAB, 'date'), '2026-09-12');
    expect(question()).toBeNull();
    await settle();
    enter(ctl(LAB, 'date'), '2026-10-02');
    expect(question()).toEqual([
      'Change the Date Assigned?',
      '“Cell Lab” moves out of Term 1’s grades. This changes students’ grades. You can undo it.',
    ]);
    confirmOk();
    enter(ctl(TEST, 'date'), '2026-09-29');
    expect(question()[1]).toBe(
      '“Atoms Test” moves into Term 1’s grades. This changes students’ grades. You can undo it.',
    );
    cancel();
    await settle();
    expect(updates()).toEqual([
      [LAB, { date_assigned: '2026-09-12' }],
      [LAB, { date_assigned: '2026-10-02' }],
    ]);
  });

  it('ticked rows: one question for all, naming how many move', () => {
    openList();
    tick(ctl(LAB, 'tick'), true);
    tick(ctl(QUIZ, 'tick'), true);
    choose(main().querySelector('[data-alv-bulk="factor"]'), '1');
    // Neither moves: Factor 1 already.
    expect(question()).toBeNull();
    choose(main().querySelector('[data-alv-bulk="category"]'), PRACTICE);
    expect(question()).toEqual([
      'Change the Category?',
      '2 assessments move to Practice. Practice counts 0%, so they will count toward no grade. This changes students’ grades. You can undo it.',
    ]);
    expect(document.getElementById('confirm-ok-btn').textContent).toBe('Set Category');
    cancel();
  });

  it('Title, Module, Due Date and Students Send never ask', () => {
    openList();
    enter(ctl(LAB, 'title'), 'Cell Lab 2');
    choose(ctl(LAB, 'module'), CHEM);
    enter(ctl(LAB, 'due'), '2026-12-24');
    expect(question()).toBeNull();
    expect(['factor', 'category', 'date'].every(f => !GradeChange.moves(CID, piece(LAB), f, piece(LAB)[f])));
  });
});

describe('Students Send', () => {
  it('shows only with Send Work on, and saves as the form does', () => {
    // Demo Mode keeps the choices with its sample work.
    session.signOut();
    session = { signOut() {} };
    window.isDemoMode = () => true;
    openList();
    expect(ctl(LAB, 'send')).toBeNull();
    saveDemoStudentWork(CID, { course: { send_work: true }, assessments: [], submissions: [] });
    setStudentPageSwitch(CID, true, 'on_return');
    PageAssignments.render();
    expect(ctl(LAB, 'send')).not.toBeNull();
    choose(ctl(LAB, 'send'), 'photos_files');
    const w = getAssessmentStudentWork(CID, LAB);
    expect(w.students_send).toBe('photos_files');
    expect(w.group_work).toBe('each');
  });
});

describe('order', () => {
  it('sorting changes nothing until Keep This Order; empty due dates go last', async () => {
    openList();
    await settle();
    session.since();
    click(main().querySelector('[data-alv-sort="due"]'));
    click(main().querySelector('[data-alv-sort="due"]'));
    expect(rowIds()).toEqual([TEST, QUIZ, LAB, HUNT]);
    expect(main().querySelector('[data-alv-grip]')).toBeNull();
    await settle();
    expect(updates()).toEqual([]);
    click(main().querySelector('[data-alv-act="keepOrder"]'));
    await settle();
    expect(
      getAssessments(CID)
        .slice()
        .sort((a, b) => a.display_order - b.display_order)
        .map(a => a.id),
    ).toEqual([TEST, QUIZ, LAB, HUNT]);
    expect(updates().map(([id, p]) => [id, p.display_order])).toEqual([
      [LAB, 3],
      [TEST, 1],
    ]);
    expect(rowIds()).toEqual([TEST, QUIZ, LAB, HUNT]);
  });

  it('Up and Down on the handle move a row one place and save the order', async () => {
    openList();
    await settle();
    session.since();
    key(ctl(LAB, 'grip'), 'ArrowDown');
    await settle();
    expect(rowIds()).toEqual([QUIZ, LAB, TEST, HUNT]);
    expect(updates().map(([id, p]) => [id, p.display_order])).toEqual([
      [LAB, 2],
      [QUIZ, 1],
    ]);
    key(ctl(LAB, 'grip'), 'ArrowUp');
    expect(rowIds()).toEqual([LAB, QUIZ, TEST, HUNT]);
  });
});

describe('filters', () => {
  it('Module, Term, Scoring and No Due Date narrow the rows; Select All ticks only those shown', () => {
    openList();
    choose(main().querySelector('[data-alv-filter="module"]'), CELLS);
    expect(rowIds()).toEqual([LAB, QUIZ]);
    choose(main().querySelector('[data-alv-filter="module"]'), '-');
    expect(rowIds()).toEqual([HUNT]);
    choose(main().querySelector('[data-alv-filter="module"]'), '');
    choose(main().querySelector('[data-alv-filter="term"]'), '1');
    expect(rowIds()).toEqual([TEST, HUNT]);
    choose(main().querySelector('[data-alv-filter="scoring"]'), 'points');
    expect(rowIds()).toEqual([TEST]);
    choose(main().querySelector('[data-alv-filter="scoring"]'), '');
    tick(main().querySelector('[data-alv-filter="noDue"]'), true);
    expect(rowIds()).toEqual([HUNT]);
    tick(main().querySelector('[data-alv-act="tickAll"]'), true);
    expect(main().querySelector('.alv-bar-n').textContent).toBe('1 Selected');
    tick(main().querySelector('[data-alv-filter="noDue"]'), false);
    expect(main().querySelector('.alv-count').textContent).toBe('2 of 4');
  });
});
