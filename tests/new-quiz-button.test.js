/**
 * + New Quiz on the Assignments page (Colin, Nov 24): a quiz is started by
 * name, beside + New Assessment. Underneath it is a new assessment with
 * They Answer a Quiz chosen. It shows only where the quizzes switch is on,
 * the quiz builder is loaded and the class's Student Page is on.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, seedClass, clearClass, click, openAssignments, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const T1 = U(41);
const settled = () => new Promise(r => setTimeout(r, 10));
const later = () => new Promise(r => setTimeout(r, 450));
let wasDemo;

function seed(config) {
  return () => {
    seedClass(CID, {
      students: [{ id: U(11), firstName: 'Ava', lastName: 'Adams' }],
      learningMaps: {
        subjects: [],
        sections: [{ id: U(51), name: 'Question', tags: [{ id: T1, label: 'Questioning', code: 'QP1', text: 'Ask' }] }],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [{ id: U(31), title: 'Essay', tagIds: [T1], date: '2026-10-10' }],
      courseConfigs: config || {},
    });
    localStorage.setItem('fv-build-quizzes', '1');
  };
}
const quizBtn = () => document.querySelector('[data-action="newQuiz"]');
const dialog = () => document.querySelector('.confirm-overlay');
const dialogBtn = which => dialog().querySelector('[data-i="' + which + '"]');

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
});
afterEach(() => {
  document.querySelectorAll('.confirm-overlay').forEach(o => o.remove());
  closePages();
  clearClass(CID);
  vi.restoreAllMocks();
  window.isDemoMode = wasDemo;
  localStorage.clear();
});

describe('the + New Quiz button', () => {
  it('sits just left of + New Assessment when quizzes are on', async () => {
    openAssignments(seed({ student_page_enabled: true }), CID);
    await settled();
    const btns = Array.from(document.querySelectorAll('.assess-toolbar-actions .tb-action-btn')).map(b =>
      b.textContent.trim(),
    );
    expect(btns.slice(-2)).toEqual(['+ New Quiz', '+ New Assessment']);
    expect(quizBtn().className).toBe('tb-action-btn');
  });

  it('is not there with the Student Page off, in the toolbar or the empty class', async () => {
    openAssignments(seed({}), CID);
    await settled();
    expect(quizBtn()).toBeNull();
    expect(document.querySelector('[data-action="showNewForm"]')).toBeTruthy();
    document.getElementById('main').innerHTML = '';
    closePages();
    clearClass(CID);
    openAssignments(() => {
      seed({})();
      seedClass(CID, { students: [], assessments: [], courseConfigs: {} });
    }, CID);
    await settled();
    expect(quizBtn()).toBeNull();
  });

  it('appears when the Student Page is turned on and the page is drawn again', async () => {
    openAssignments(seed({}), CID);
    await settled();
    expect(quizBtn()).toBeNull();
    setStudentPageSwitch(CID, true);
    window.PageAssignments.render();
    await settled();
    expect(quizBtn()).toBeTruthy();
    setStudentPageSwitch(CID, false);
    window.PageAssignments.render();
    await settled();
    expect(quizBtn()).toBeNull();
  });

  it('shows in an empty class with the Student Page on', async () => {
    openAssignments(
      () => seedClass(CID, { students: [], assessments: [], courseConfigs: { student_page_enabled: true } }),
      CID,
    );
    await settled();
    expect(document.querySelector('.assess-list-empty [data-action="newQuiz"]')).toBeTruthy();
  });

  it('is not there when the quizzes switch is off', async () => {
    const on = BuildFlags.on;
    vi.spyOn(BuildFlags, 'on').mockImplementation(n => (n === 'quizzes' ? false : on(n)));
    openAssignments(seed({ student_page_enabled: true }), CID);
    await settled();
    expect(quizBtn()).toBeNull();
    expect(document.querySelector('[data-action="showNewForm"]')).toBeTruthy();
  });

  it('is not there when the quiz builder is not loaded', async () => {
    const qb = window.QuizBuilder;
    window.QuizBuilder = undefined;
    try {
      openAssignments(seed({ student_page_enabled: true }), CID);
      await settled();
      expect(quizBtn()).toBeNull();
    } finally {
      window.QuizBuilder = qb;
    }
  });

  it('opens the form with They Answer a Quiz chosen and the title Quiz, Student Page on', async () => {
    openAssignments(seed({ student_page_enabled: true }), CID);
    await settled();
    click(quizBtn());
    await later();
    expect(document.getElementById('af-title').value).toBe('Quiz');
    expect(QuizBuilder.picked()).toBe(true);
    expect(QuizBuilder._model().qs.length).toBe(1);
    expect(dialog()).toBeNull();
  });
});
