/**
 * The assessment form asks before a save that moves grades, and offers
 * Undo after it (teacher/grade-change.js; Colin, Nov 16: "when doing things
 * that change grade math, give teachers a warning prompt before making
 * changes, provide undo as well"). The same rule as the Assignments List:
 * a Factor always; a Category in a Letter or Both class, or into or out of
 * a 0% category; a Date Assigned across the end of a reporting term.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  click,
  settle,
  confirmOk,
  toastText,
  openAssignments,
  closePages,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const LABS = U(21);
const QUIZZES = U(22);
const PRACTICE = U(23); // 0%
const QUIZ = U(32);
const Q = U(41);
let wasDemo;
let session = null;

const QUIZ_ROW = {
  id: QUIZ,
  title: 'Cell Quiz',
  tagIds: [Q],
  date: '2026-09-20',
  categoryId: QUIZZES,
  scoreMode: 'points',
  maxPoints: 10,
  display_order: 1,
};

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
    courseConfigs: {
      reportingTerms: [
        { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-09-30' },
        { ordinal: 2, label: 'Term 2', starts_on: '2026-10-01', ends_on: '2027-01-31' },
      ],
    },
    assessments: [structuredClone(QUIZ_ROW)],
  });
  _rememberServerState('assessments', CID, [structuredClone(QUIZ_ROW)]);
}

const form = () => document.getElementById('new-assess-form');
const field = id => document.getElementById(id);
const piece = () => getAssessments(CID).find(a => a.id === QUIZ);
const question = () => {
  const card = document.querySelector('.confirm-card');
  return card
    ? [card.querySelector('.confirm-title').textContent, card.querySelector('.confirm-message').textContent]
    : null;
};
const updates = () =>
  session
    .since()
    .filter(([name]) => name === 'update_assessment')
    .map(([, p]) => p.p_patch);

function openForm() {
  openAssignments(seed, CID, {});
  click(document.querySelector('[data-action="editAssess"][data-aid="' + QUIZ + '"]'));
  expect(form().style.display).toBe('block');
}
function choose(select, value) {
  Array.from(select.querySelectorAll('option')).forEach(o => {
    if (o.getAttribute('value') === value) o.setAttribute('selected', '');
    else o.removeAttribute('selected');
  });
}
const save = () => click(form().querySelector('[data-action="saveEditAssess"]'));

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => false;
  localStorage.clear();
  session = signIn();
});
afterEach(() => {
  if (typeof dismissUndoToast === 'function') dismissUndoToast();
  closePages();
  clearClass(CID);
  session.signOut();
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('Save Changes on the assessment form', () => {
  it('a Factor asks first; Cancel keeps the form open and saves nothing', async () => {
    openForm();
    await settle();
    session.since();
    field('af-weight').value = '2';
    save();
    expect(question()).toEqual([
      'Change the Factor?',
      '“Cell Quiz” will count 2× as much as work at Factor 1×. This changes students’ grades. You can undo it.',
    ]);
    document.getElementById('confirm-cancel-btn').onclick();
    await settle();
    expect(updates()).toEqual([]);
    expect(piece().weight).toBeUndefined();
    expect(form().style.display).toBe('block');
    expect(field('af-weight').value).toBe('2');
  });

  it('Save Changes saves it, and Undo puts the Factor back without asking', async () => {
    openForm();
    await settle();
    session.since();
    field('af-weight').value = '2';
    save();
    confirmOk();
    await settle();
    expect(updates()).toEqual([{ weight: '2' }]);
    expect(form().style.display).toBe('none');
    expect(toastText()).toBe('Changed the Factor of “Cell Quiz”.');
    executeUndo();
    expect(question()).toBeNull();
    await settle();
    expect(updates()).toEqual([{ weight: '1' }]);
    expect(piece().weight).toBeUndefined();
  });

  it('several changes that move grades: one question, and Undo puts back only those', async () => {
    openForm();
    await settle();
    session.since();
    field('af-title').value = 'Cell Quiz 2';
    field('af-weight').value = '3';
    choose(field('af-category'), PRACTICE);
    field('af-date-assigned').value = '2026-10-02';
    save();
    expect(question()).toEqual([
      'Change How This Counts?',
      '“Cell Quiz” will count 3× as much as work at Factor 1×. ' +
        '“Cell Quiz” moves from Quizzes to Practice. Practice counts 0%, so it will count toward no grade. ' +
        '“Cell Quiz” moves out of Term 1’s grades. This changes students’ grades. You can undo it.',
    ]);
    expect(document.getElementById('confirm-ok-btn').textContent).toBe('Save Changes');
    confirmOk();
    await settle();
    expect(updates()).toEqual([
      { title: 'Cell Quiz 2', category_id: PRACTICE, date_assigned: '2026-10-02', weight: '3' },
    ]);
    expect(toastText()).toBe('Changed how “Cell Quiz” counts.');
    executeUndo();
    await settle();
    expect(updates()).toEqual([{ category_id: QUIZZES, date_assigned: '2026-09-20', weight: '1' }]);
    expect(piece().title).toBe('Cell Quiz 2');
  });

  it('a change that moves no grade saves at once, with no question and no Undo', async () => {
    openForm();
    await settle();
    session.since();
    field('af-title').value = 'Cell Quiz 2';
    // Proficiency class, between two categories that count; a date in the same term.
    choose(field('af-category'), LABS);
    field('af-date-assigned').value = '2026-09-25';
    save();
    expect(question()).toBeNull();
    await settle();
    expect(updates()).toEqual([{ title: 'Cell Quiz 2', category_id: LABS, date_assigned: '2026-09-25' }]);
    expect(toastText()).toBeNull();
  });

  it('in a Letter class any Category move asks', () => {
    openForm();
    COURSES[CID].gradingSystem = 'letter';
    COURSES[CID].gradeLevel = '11';
    choose(field('af-category'), LABS);
    save();
    expect(question()).toEqual([
      'Change the Category?',
      '\u201cCell Quiz\u201d moves from Quizzes to Labs. This changes students\u2019 grades. You can undo it.',
    ]);
    document.getElementById('confirm-cancel-btn').onclick();
  });
});
