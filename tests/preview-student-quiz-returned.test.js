/**
 * Preview as Student shows a returned quiz from the teacher's own data and sends nothing
 * (docs/plans/quizzes-plan.md Q5b). The class is preview-student.test.js's: Jordan's Quick Check is a returned
 * piece. The quiz, its key and Jordan's confirmed try are the teacher's cache (getQuiz, getQuizTries), stood in
 * for here; the preview works out what `quiz-result` would answer and reads it with the student page's own reader.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

globalThis.StudentQuestionKinds = globalThis.StudentQuestionKinds || {};
runInThisContext(readFileSync('s/quiz-model.js', 'utf8') + '\nglobalThis.StudentQuizModel = StudentQuizModel;');
runInThisContext(readFileSync('s/quiz-view.js', 'utf8') + '\nglobalThis.StudentQuizView = StudentQuizView;');

const CID = 'pq-class';
const S1 = 'pq-jordan';
const AID = 'quiz';
const HELD = { student_page_enabled: true, return_grades: 'on_return' };
const lv = value => ({ value, modifier: 0, comment: null });
const ASSESSMENTS = [
  {
    id: AID,
    title: 'Quick Check',
    date: '2026-10-10',
    dueDate: '2026-10-12',
    type: 'summative',
    weight: 1,
    tagIds: ['t1'],
  },
];
const CH = [
  { id: 'a', text: 'Grass' },
  { id: 'b', text: 'Hawk' },
];
const QUESTIONS = [
  {
    id: 'q1',
    position: 1,
    kind: 'choice',
    prompt: 'Which is a producer?',
    points: 1,
    multiple: false,
    choices: CH,
    key: { answer: ['a'], tolerance: null, why: 'Grass makes its own food.' },
  },
  {
    id: 'q2',
    position: 2,
    kind: 'number',
    prompt: 'Half of 7?',
    points: 2,
    multiple: false,
    choices: null,
    key: { answer: 3.5, tolerance: 0, why: null },
  },
  {
    id: 'q3',
    position: 3,
    kind: 'true_false',
    prompt: 'Hawks are producers.',
    points: 1,
    multiple: false,
    choices: null,
    key: { answer: false, tolerance: null, why: 'Hawks eat other animals.' },
  },
];
// Jordan's own order is q3, q1, q2.
const TRY = {
  attempt_id: 't1',
  try: 1,
  sent_at: '2026-10-11T18:00:00Z',
  question_order: { questions: ['q3', 'q1', 'q2'], choices: { q1: ['b', 'a'] } },
  marked: {
    earned: 1,
    possible: 4,
    questions: {
      q1: { earned: 0, result: 'wrong' },
      q2: { earned: 0, result: 'wrong' },
      q3: { earned: 1, result: 'right' },
    },
  },
  answers: [
    { question_id: 'q1', answer: ['b'] },
    { question_id: 'q3', answer: false },
  ],
};

let doc;
let stub;
let setup;

function seed() {
  localStorage.clear();
  clearClass(CID);
  const cells = {
    [S1]: {
      [AID]: {
        score: { value: 3, modifier: 0, comment: null, status: null },
        tag_scores: [Object.assign({ tag_id: 't1' }, lv(3))],
        rubric_scores: [],
      },
    },
  };
  seedClass(CID, {
    students: [{ id: S1, firstName: 'Jordan', lastName: 'Reyes' }],
    assessments: structuredClone(ASSESSMENTS),
    scores: _gradebookCellsToScoreCache(CID, structuredClone(ASSESSMENTS), cells).scores,
    learningMaps: { sections: [{ id: 'sec1', name: 'Questioning', tags: [{ id: 't1', label: 'Questioning' }] }] },
    courseConfigs: structuredClone(HELD),
    gradeReturns: { [AID]: { [S1]: { is_draft: false, returned_at: '2026-11-04T18:00:00Z' } } },
  });
  COURSES[CID] = { id: CID, name: 'Socials 10', block: 'C', gradingSystem: 'proficiency', gradeLevel: '10' };
  delete _returnedSets[CID];
  clearProfCache();
  localStorage.setItem('fv-build-quizzes', '1');
}

// What the teacher's cache holds for this quiz and this student.
function teacher(opts = {}) {
  const quiz = Object.assign(
    { tries: 1, counts: 'best', shows: 'answers', add_total: false, after_due: 'keep', accept_until: null },
    opts.quiz,
  );
  globalThis.quizzesOffered = () => true;
  globalThis.getQuiz = (cid, aid) =>
    cid === CID && aid === AID ? { quiz, questions: structuredClone(QUESTIONS) } : null;
  globalThis.getQuizTries = (cid, aid) =>
    cid === CID && aid === AID
      ? {
          students: [
            Object.assign(
              { enrollment_id: S1, sent: 1, in_progress: false, reopened: false, tries: [structuredClone(TRY)] },
              opts.student,
            ),
          ],
        }
      : null;
  globalThis.loadQuiz = () => Promise.resolve(null);
  globalThis.loadQuizTries = () => Promise.resolve(null);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T20:00:00Z'));
  stub = globalThis.document;
  setup = {
    quizzesOffered: globalThis.quizzesOffered,
    getQuiz: globalThis.getQuiz,
    getQuizTries: globalThis.getQuizTries,
    loadQuiz: globalThis.loadQuiz,
    loadQuizTries: globalThis.loadQuizTries,
  };
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
  );
  doc = dom.document;
  let active = null;
  Object.defineProperty(doc, 'activeElement', {
    configurable: true,
    get: () => (active && active.isConnected ? active : doc.body),
  });
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div')));
  proto.focus = function () {
    active = this;
  };
  if (!proto.scrollIntoView) proto.scrollIntoView = function () {};
  globalThis.document = doc;
  globalThis.CSS = globalThis.CSS || { escape: s => String(s) };
  seed();
});
afterEach(() => {
  PreviewStudent.close();
  Object.assign(globalThis, setup);
  globalThis.document = stub;
  clearClass(CID);
  vi.useRealTimers();
});

const overlay = () => doc.getElementById('preview-student');
const screen = () => overlay().querySelector('.ps-screen');
const words = el =>
  el
    ? el.innerHTML
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
function click(target) {
  target.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
}
function openFeedback() {
  PreviewStudent.open(CID, S1, null, null);
  click(screen().querySelector('.sp-tabs-bottom [data-tab="learning"]'));
  click(screen().querySelector('.sp-ml-row[data-act="feedback"][data-piece="' + AID + '"]'));
}
const seeQuiz = () => screen().querySelector('[data-act="quiz-open"]');

describe('Preview as Student, a returned quiz', () => {
  it('offers See Your Quiz on Your Feedback and shows the returned view from the teacher’s own data, in the student’s order', () => {
    teacher({ quiz: { add_total: true } });
    openFeedback();
    expect(words(seeQuiz())).toBe('See Your Quiz');
    click(seeQuiz());
    const text = words(screen().querySelector('.sp-quiz'));
    expect(screen().querySelector('.sp-quiz[data-quiz-mode="returned"]')).toBeTruthy();
    // Jordan's own order: q3, q1, q2.
    expect(text).toContain('Question 1 · Right Hawks are producers. You chose: False');
    expect(text).toContain(
      'Question 2 · Not Right Which is a producer? You chose: Hawk Right answer: Grass Grass makes its own food.',
    );
    expect(text).toContain('Question 3 · Not Right Half of 7? You didn’t answer this question. Right answer: 3.5');
    expect(text).toContain('Your Total 1 of 4');
    // The grade is the page's own.
    expect(screen().querySelector('.sp-quiz-top .sp-fb-big')).toBeTruthy();
  });

  it('shows the key only as the quiz allows', () => {
    teacher({ quiz: { shows: 'right' } });
    openFeedback();
    click(seeQuiz());
    expect(words(screen().querySelector('.sp-quiz'))).not.toMatch(/Right answer|Grass makes its own food/);
    PreviewStudent.close();
    teacher({ quiz: { shows: 'grade' } });
    openFeedback();
    click(seeQuiz());
    expect(screen().querySelector('.sp-quiz-ra')).toBeNull();
    expect(words(screen().querySelector('.sp-quiz'))).toContain(
      'Your teacher shows your result and comment for this quiz.',
    );
  });

  it('is not offered where quiz-result would say returned: false', () => {
    // No confirmed try.
    teacher();
    globalThis.getQuizTries = () => ({
      students: [
        { enrollment_id: S1, sent: 1, in_progress: false, reopened: false, tries: [{ ...TRY, marked: null }] },
      ],
    });
    openFeedback();
    expect(seeQuiz()).toBeNull();
    PreviewStudent.close();
    // Still open to the student: tries left (two allowed, one sent), a try started, or Reopen.
    teacher({ quiz: { tries: 2 } });
    openFeedback();
    expect(seeQuiz()).toBeNull();
    PreviewStudent.close();
    teacher({ student: { in_progress: true } });
    openFeedback();
    expect(seeQuiz()).toBeNull();
    PreviewStudent.close();
    teacher({ student: { reopened: true } });
    openFeedback();
    expect(seeQuiz()).toBeNull();
    PreviewStudent.close();
    // Unlimited tries are never out; only closed counts. Closed on its due date: it is.
    teacher({ quiz: { tries: 0 } });
    openFeedback();
    expect(seeQuiz()).toBeNull();
    PreviewStudent.close();
    teacher({ quiz: { tries: 0, after_due: 'stop' } });
    openFeedback();
    expect(words(seeQuiz())).toBe('See Your Quiz');
  });

  it('is not there with the switch off, or for a class with no quiz', () => {
    teacher();
    localStorage.removeItem('fv-build-quizzes');
    openFeedback();
    expect(seeQuiz()).toBeNull();
    PreviewStudent.close();
    seed();
    globalThis.getQuiz = () => null;
    openFeedback();
    expect(seeQuiz()).toBeNull();
  });

  it('sends nothing: no student route is called, and nothing is written', () => {
    teacher({ quiz: { add_total: true } });
    const before = JSON.stringify(Object.entries(localStorage));
    const ask = vi.fn(() => Promise.resolve({}));
    globalThis.fetch = ask;
    openFeedback();
    click(seeQuiz());
    click(screen().querySelector('[data-act="quiz-look"]'));
    click(screen().querySelector('[data-act="quiz-back"]'));
    expect(ask).not.toHaveBeenCalled();
    expect(JSON.stringify(Object.entries(localStorage))).toBe(before);
  });
});
