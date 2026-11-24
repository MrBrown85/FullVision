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
  // A returned piece that is not a quiz.
  {
    id: 'essay',
    title: 'Returned Essay',
    date: '2026-10-01',
    dueDate: '2026-10-02',
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
  {
    id: 'q4',
    position: 4,
    kind: 'number',
    prompt: 'Added later: 2 plus 2?',
    points: 1,
    multiple: false,
    choices: null,
    key: { answer: 4, tolerance: 0, why: 'LATER-WHY' },
  },
];
// Jordan's own order is q3, q1, q2 (q4 was added after: it comes last).
const TRY = {
  attempt_id: 't1',
  try: 1,
  sent_at: '2026-10-11T18:00:00Z',
  reopened_at: null,
  marked_at: '2026-11-03T18:00:00Z',
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

function seed(held = HELD, row = { is_draft: false, returned_at: '2026-11-04T18:00:00Z' }) {
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
  cells[S1].essay = structuredClone(cells[S1][AID]);
  seedClass(CID, {
    students: [{ id: S1, firstName: 'Jordan', lastName: 'Reyes' }],
    assessments: structuredClone(ASSESSMENTS),
    scores: _gradebookCellsToScoreCache(CID, structuredClone(ASSESSMENTS), cells).scores,
    learningMaps: { sections: [{ id: 'sec1', name: 'Questioning', tags: [{ id: 't1', label: 'Questioning' }] }] },
    courseConfigs: structuredClone(held),
    gradeReturns: { [AID]: { [S1]: row }, essay: { [S1]: row } },
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
              {
                enrollment_id: S1,
                sent: 1,
                in_progress: false,
                reopened: false,
                tries: opts.tries || [structuredClone(TRY)],
              },
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
    probeQuizzes: globalThis.probeQuizzes,
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
  const row = screen().querySelector('.sp-ml-row[data-act="feedback"][data-piece="' + AID + '"]');
  // A piece not returned has no Your Feedback to open: nothing of a quiz either.
  if (row) click(row);
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

/* The server's rules, case by case (migrations/2026112407_quiz_returned.sql, quiz_result): the same cases the
   harness (migrations/local-test/quiz_returned.py) runs, so the preview and the server agree. */
const RETURNED = '2026-11-04T18:00:00Z';
const BEFORE = '2026-11-03T18:00:00Z';
const AFTER = '2026-11-05T18:00:00Z';
const offered = () => {
  openFeedback();
  const on = !!seeQuiz();
  PreviewStudent.close();
  return on;
};
const try1 = more => ({ ...structuredClone(TRY), ...more });

describe('rule 3: confirmed, and returned since', () => {
  it('keeping changes until Return: the marking must not be after the return', () => {
    teacher({ tries: [try1({ marked_at: BEFORE })] });
    expect(offered()).toBe(true);
    teacher({ tries: [try1({ marked_at: RETURNED })] });
    expect(offered()).toBe(true); // equal is not after
    teacher({ tries: [try1({ marked_at: AFTER })] });
    expect(offered()).toBe(false); // confirmed since the last Return: waits for the next
    teacher({ tries: [try1({ marked_at: null })] });
    expect(offered()).toBe(false);
  });

  it('keeping changes until Return: a draft over a returned grade still shows the returned marking', () => {
    seed(HELD, {
      is_draft: true,
      returned_at: RETURNED,
      returned_copy: { v: 1, value: null, modifier: 0, comment: null, tags: { t1: lv(3) }, criteria: {}, checks: [] },
    });
    teacher({ tries: [try1({ marked_at: BEFORE })] });
    expect(offered()).toBe(true);
    teacher({ tries: [try1({ marked_at: AFTER })] });
    expect(offered()).toBe(false);
  });

  it('a grade never returned, in either kind of class, is not returned', () => {
    seed(HELD, { is_draft: true });
    teacher();
    expect(offered()).toBe(false);
    seed({ student_page_enabled: true, return_grades: 'on_save' }, { is_draft: true });
    teacher();
    expect(offered()).toBe(false);
  });

  it('returning every save at once: the times are not compared, only that no draft waits', () => {
    seed({ student_page_enabled: true, return_grades: 'on_save' });
    teacher({ tries: [try1({ marked_at: AFTER })] });
    expect(offered()).toBe(true); // the scores landed first, the marking after
    seed({ student_page_enabled: true, return_grades: 'on_save' }, { is_draft: true, returned_at: RETURNED });
    teacher({ tries: [try1({ marked_at: BEFORE })] });
    expect(offered()).toBe(false); // a draft is waiting
  });
});

describe('rule 2: the student can no longer answer', () => {
  const sent = more => try1(more);
  const reopenedSent = more =>
    try1({ try: 2, attempt_id: 't2', reopened_at: '2026-10-20T18:00:00Z', marked: null, ...more });
  it('counts only ordinary tries: a sent reopened try is not one of the allowed', () => {
    // Two allowed; one ordinary and one made by Reopen, both sent: one ordinary try is left.
    teacher({ quiz: { tries: 2 }, tries: [sent(), reopenedSent()] });
    expect(offered()).toBe(false);
    // One allowed; the ordinary try sent, then a Reopen try sent: none left.
    teacher({ quiz: { tries: 1 }, tries: [sent(), reopenedSent()] });
    expect(offered()).toBe(true);
    // Two ordinary tries sent of two.
    teacher({ quiz: { tries: 2 }, tries: [sent({ marked: null }), sent({ try: 2, attempt_id: 't2' })] });
    expect(offered()).toBe(true);
  });

  it('an unsent ordinary try counts as a try used, and holds nothing back once the quiz has closed', () => {
    // Open, one allowed, an ordinary try started and not sent: the student can still answer it.
    teacher({ quiz: { tries: 1 }, student: { in_progress: true, sent: 0 }, tries: [sent()] });
    expect(offered()).toBe(false);
    // Closed (after the due date): the unsent try does not hold it back.
    teacher({ quiz: { tries: 1, after_due: 'stop' }, student: { in_progress: true }, tries: [sent()] });
    expect(offered()).toBe(true);
    // Two allowed, one sent and one started, open: still answerable.
    teacher({ quiz: { tries: 2 }, student: { in_progress: true }, tries: [sent()] });
    expect(offered()).toBe(false);
    // Two allowed, one sent and one started, closed: the started one is a try used, but closing is enough.
    teacher({ quiz: { tries: 2, after_due: 'stop' }, student: { in_progress: true }, tries: [sent()] });
    expect(offered()).toBe(true);
  });

  it('a reopened unsent try holds it back, closed or not', () => {
    teacher({ quiz: { tries: 1 }, student: { reopened: true }, tries: [sent()] });
    expect(offered()).toBe(false);
    teacher({ quiz: { tries: 1, after_due: 'stop' }, student: { reopened: true }, tries: [sent()] });
    expect(offered()).toBe(false);
  });

  it('unlimited tries are never out: only a closed quiz returns', () => {
    teacher({ quiz: { tries: 0 }, tries: [sent()] });
    expect(offered()).toBe(false);
    teacher({ quiz: { tries: 0, after_due: 'stop' }, tries: [sent()] });
    expect(offered()).toBe(true);
    teacher({ quiz: { tries: 0, after_due: 'until', accept_until: '2026-11-09' }, tries: [sent()] });
    expect(offered()).toBe(true);
    teacher({ quiz: { tries: 0, after_due: 'until', accept_until: '2026-11-30' }, tries: [sent()] });
    expect(offered()).toBe(false);
  });
});

describe('rule 4: the key only for a question the marking saw', () => {
  it('a question added since has no right answer and no why, with answers on', () => {
    teacher({ quiz: { shows: 'answers' } });
    openFeedback();
    click(seeQuiz());
    const text = words(screen().querySelector('.sp-quiz'));
    expect(text).toContain('Question 4');
    expect(text).toContain('Added later: 2 plus 2?');
    expect(text).not.toContain('LATER-WHY');
    expect(text).not.toContain('Right answer: 4');
    // The questions it did see still carry theirs.
    expect(text).toContain('Right answer: Grass');
  });
});

describe('the Returned date is the student’s own day', () => {
  it('an evening return in Vancouver reads as that evening, not the next day’s UTC date', () => {
    const was = process.env.TZ;
    process.env.TZ = 'America/Vancouver';
    try {
      // 2026-11-25T03:30Z is 7:30 pm on Nov 24 in Vancouver.
      seed(HELD, { is_draft: false, returned_at: '2026-11-25T03:30:00Z' });
      teacher({ tries: [try1({ marked_at: BEFORE })] });
      openFeedback();
      click(seeQuiz());
      const line = words(screen().querySelector('.sp-quiz-class'));
      expect(line).toContain('Returned Nov 24');
      expect(line).not.toContain('Nov 25');
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
  });
});

describe('what the preview reads from the teacher’s side', () => {
  it('asks list_quiz_tries only for the pieces that are quizzes', async () => {
    teacher();
    globalThis.getQuizTries = () => null;
    const asked = [];
    globalThis.loadQuizTries = (cid, aid) => {
      asked.push(aid);
      return Promise.resolve(null);
    };
    globalThis.loadQuiz = () => Promise.resolve(null);
    globalThis.probeQuizzes = () => Promise.resolve(true);
    // getQuiz answers for the quiz piece only (teacher() above), and the essay is returned too.
    PreviewStudent.open(CID, S1, null, null);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(asked).toEqual([AID]);
  });
});
