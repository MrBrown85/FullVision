/**
 * Quizzes' data layer (shared/data-quizzes.js, slice Q2b of
 * docs/plans/quizzes-plan.md), built to the Q1 contract
 * (migrations/local-test/quizzes-contract.md on the quizzes-q1 branch).
 *
 * 1. Demo Mode keeps a quiz in the contract's shapes: the round trip keeps
 *    every field, the answer key is kept apart from the questions, and
 *    Demo Mode refuses what save_quiz refuses.
 * 2. The key never reaches the student's side: the demo student's view of
 *    a quiz piece (StudentView.reply, what Preview as Student and the
 *    student page draw from) holds no right answer, no points key and no
 *    tolerance, Draft or assigned.
 * 3. Signed in: nothing is offered or sent until the server has list_quiz;
 *    a save carries a key made on this device; a local assessment id waits
 *    behind its create and never reaches the server; a refused save keeps
 *    the questions with a plain sentence matched on the server's exact word.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, signIn, seedClass, clearClass, settle, serverSaysStudentPageOn } from './helpers/pin-save-paths.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = U(1);
const AVA = U(11);
const T1 = U(41);
const T2 = U(42);
const AID = U(31);
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const C3 = '33333333-3333-4333-8333-333333333333';
const MARK = 'ZEBRA-KEY-MARKER';

/** A quiz with one question of every kind, the "why" lines holding a marker. */
function payload(extra) {
  return {
    ...QuizData.defaults(),
    questions: [
      {
        kind: 'choice',
        prompt: 'Which is a producer?',
        choices: [
          { id: C1, text: 'Grass' },
          { id: C2, text: 'Hawk' },
          { id: C3, text: 'Fox' },
        ],
        multiple: false,
        points: 1,
        tag_id: T1,
        key: { answer: [C1], tolerance: null, why: MARK + ' grass makes its own food.' },
      },
      {
        kind: 'choice',
        prompt: 'Which two are consumers?',
        choices: [
          { id: C1, text: 'Grass' },
          { id: C2, text: 'Hawk' },
          { id: C3, text: 'Fox' },
        ],
        multiple: true,
        points: 2,
        tag_id: T2,
        key: { answer: [C2, C3], tolerance: null, why: null },
      },
      {
        kind: 'true_false',
        prompt: 'A hawk is a producer.',
        multiple: false,
        points: 1,
        tag_id: null,
        key: { answer: false, tolerance: null, why: null },
      },
      {
        kind: 'number',
        prompt: 'Average height at week 4, in cm?',
        multiple: false,
        points: 2,
        tag_id: T1,
        key: { answer: 12.5, tolerance: 0.1, why: null },
      },
      {
        kind: 'text',
        prompt: 'What would you test next?',
        multiple: false,
        points: 2,
        tag_id: T2,
        key: { answer: null, tolerance: null, why: null },
      },
    ],
    ...extra,
  };
}

function seed(extra) {
  seedClass(CID, {
    students: [{ id: AVA, firstName: 'Ava', lastName: 'Adams' }],
    learningMaps: {
      subjects: [],
      sections: [
        { id: U(51), name: 'Question', tags: [{ id: T1, label: 'Question', text: 'Ask questions' }] },
        { id: U(52), name: 'Patterns', tags: [{ id: T2, label: 'Patterns', text: 'Find patterns' }] },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [{ id: AID, title: 'Food Webs Check', tagIds: [T1, T2], date: '2026-11-10', isDraft: true }],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
    ...extra,
  });
}

let wasDemo;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T18:00:00.000Z'));
  wasDemo = window.isDemoMode;
  localStorage.clear();
  // What this page has learned of the server is per page load.
  _quizProbe = {};
  _quizHeld = {};
});
afterEach(() => {
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  vi.useRealTimers();
});

describe('the contract’s rules, as Demo Mode refuses them', () => {
  const tags = [T1, T2];
  it('a whole quiz of every kind passes', () => {
    expect(QuizData.problem(payload(), tags)).toBeNull();
  });
  it.each([
    ['a Choice with no right answer', p => (p.questions[0].key.answer = [])],
    ['one right answer named twice on Multiple Answers', p => (p.questions[1].key.answer = [C2, C2])],
    ['two right answers on a single Choice', p => (p.questions[0].key.answer = [C1, C2])],
    ['a right answer that is not one of its choices', p => (p.questions[0].key.answer = [U(99)])],
    ['a Number with no answer', p => (p.questions[3].key.answer = null)],
    ['a Number past 10^12', p => (p.questions[3].key.answer = 1e12 + 1)],
    ['a tolerance below 0', p => (p.questions[3].key.tolerance = -1)],
    ['a tolerance on a Choice', p => (p.questions[0].key.tolerance = 1)],
    ['True or False with no answer', p => (p.questions[2].key.answer = null)],
    ['an answer on a Text question', p => (p.questions[4].key.answer = 'x')],
    ['a blank prompt', p => (p.questions[0].prompt = '   ')],
    ['a prompt of 1001 characters', p => (p.questions[0].prompt = 'a'.repeat(1001))],
    ['one choice', p => (p.questions[0].choices = [{ id: C1, text: 'Grass' }])],
    ['a blank choice', p => (p.questions[0].choices[1].text = ' ')],
    [
      'a choice id that is not a version-4 UUID',
      p => (p.questions[0].choices[1].id = '00000000-0000-1000-8000-000000000031'),
    ],
    ['points over 100', p => (p.questions[0].points = 101)],
    ['points below 0', p => (p.questions[0].points = -1)],
    ['a competency not on the piece', p => (p.questions[0].tag_id = U(77))],
    ['Multiple Answers on True or False', p => (p.questions[2].multiple = true)],
    ['a "why" of 501 characters', p => (p.questions[0].key.why = 'w'.repeat(501))],
    ['tries of 3', p => (p.tries = 3)],
    ['an unknown key', p => (p.timer = 10)],
    ['Until with no date', p => (p.after_due = 'until')],
  ])('%s is bad_quiz', (_, change) => {
    const p = payload();
    change(p);
    expect(QuizData.problem(p, tags)).toMatchObject({ message: 'bad_quiz' });
  });
  it('101 questions is too_many_questions', () => {
    const p = payload();
    p.questions = Array.from({ length: 101 }, () => structuredClone(p.questions[2]));
    expect(QuizData.problem(p, tags)).toEqual({ message: 'too_many_questions', detail: '' });
  });
});

describe('in Demo Mode', () => {
  beforeEach(() => {
    window.isDemoMode = () => true;
    localStorage.setItem('fv-build-quizzes', '1');
    seed();
  });

  it('save and read again keep every field, in the order written', () => {
    expect(
      QuizData.save(CID, AID, payload({ tries: 2, counts: 'latest', shows: 'right', add_total: true }), [T1, T2]),
    ).toEqual({
      ok: true,
    });
    const back = QuizData.get(CID, AID);
    expect(back.quiz).toMatchObject({ tries: 2, counts: 'latest', shows: 'right', add_total: true, after_due: 'keep' });
    const sent = payload().questions;
    expect(back.questions).toHaveLength(5);
    back.questions.forEach((q, i) => {
      expect(q.kind).toBe(sent[i].kind);
      expect(q.prompt).toBe(sent[i].prompt);
      expect(q.points).toBe(sent[i].points);
      expect(q.tag_id).toBe(sent[i].tag_id);
      expect(q.multiple).toBe(sent[i].multiple);
      expect(q.position).toBe(i + 1);
      expect(q.choices).toEqual(sent[i].choices || null);
      expect(q.key.answer).toEqual(sent[i].key.answer);
      expect(q.key.tolerance).toEqual(sent[i].key.tolerance);
      expect(q.key.why).toEqual(sent[i].key.why);
    });
    // Saved again with their ids, nothing changes.
    const again = payload();
    again.questions.forEach((q, i) => (q.id = back.questions[i].id));
    QuizData.save(CID, AID, again, [T1, T2]);
    expect(QuizData.get(CID, AID).questions.map(q => q.id)).toEqual(back.questions.map(q => q.id));
  });

  it('the answer key is kept apart from the questions', () => {
    QuizData.save(CID, AID, payload(), [T1, T2]);
    const questions = localStorage.getItem('gb-quizzes-' + CID);
    const keys = localStorage.getItem('gb-quiz-keys-' + CID);
    expect(questions).not.toContain(MARK);
    expect(questions).not.toContain('"answer"');
    expect(questions).not.toContain('tolerance');
    expect(keys).toContain(MARK);
  });

  it('refuses what the server refuses, and keeps nothing of it', () => {
    const p = payload();
    p.questions[0].key.answer = [];
    expect(QuizData.save(CID, AID, p, [T1, T2])).toMatchObject({ ok: false, error: { message: 'bad_quiz' } });
    expect(QuizData.get(CID, AID).quiz).toBeNull();
  });

  it('null takes the quiz off the piece, key and all', () => {
    QuizData.save(CID, AID, payload(), [T1, T2]);
    QuizData.save(CID, AID, null, []);
    expect(QuizData.get(CID, AID)).toEqual({ quiz: null, questions: [], archived: [] });
    expect(localStorage.getItem('gb-quiz-keys-' + CID)).toBe('{}');
  });

  it('with the Student Page off nothing is offered', () => {
    saveCourseConfig(CID, {});
    expect(quizzesOffered(CID)).toBe(false);
  });

  it('the demo student’s view of a quiz piece holds no right answer, no points key and no tolerance', () => {
    QuizData.save(CID, AID, payload(), [T1, T2]);
    const look = () => {
      const view = JSON.stringify(StudentView.reply(CID, AVA));
      expect(view).not.toContain(MARK);
      expect(view).not.toContain('tolerance');
      expect(view).not.toContain('12.5');
      expect(view).not.toContain(C1);
      expect(view).not.toContain('Which is a producer?');
      expect(view).not.toContain('"key"');
    };
    look(); // a Draft
    const list = getAssessments(CID);
    list[0].isDraft = false;
    saveAssessments(CID, list);
    look(); // assigned
    // Nothing the student page's code reads opens the quiz stores.
    for (const file of [
      'shared/student-view.js',
      's/app.js',
      's/student-data.js',
      's/page-view.js',
      'teacher/preview-student.js',
    ]) {
      const src = readFileSync(resolve(root, file), 'utf-8');
      expect(src, file).not.toMatch(/gb-quiz|QuizData|quiz_key|list_quiz/);
    }
  });
});

describe('signed in', () => {
  let session;
  let teacher;
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    teacher = _teacherId;
    _teacherId = 'teacher-a';
    window.isDemoMode = () => false;
    session = signIn();
    seed();
    serverSaysStudentPageOn(CID, true);
    localStorage.setItem('fv-build-quizzes', '1');
    window.v2Queue.clear();
  });
  afterEach(() => {
    window.v2Queue.clear();
    serverSaysStudentPageOn(CID, false);
    session.signOut();
    _teacherId = teacher;
  });

  it('with the switch off nothing is asked or sent, and no key is written', async () => {
    localStorage.removeItem('fv-build-quizzes');
    const keys = Object.keys(localStorage._store).sort();
    expect(await probeQuizzes(CID)).toBe(false);
    expect(QuizData.save(CID, AID, payload(), [T1, T2])).toEqual({ ok: false });
    await settle();
    expect(session.fake.calls.map(c => c.name)).toEqual([]);
    expect(Object.keys(localStorage._store).sort()).toEqual(keys);
  });

  it('a server without list_quiz is offered nothing and sent nothing, and asked once', async () => {
    session.fake.on('list_quiz', () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.list_quiz' },
    }));
    expect(await probeQuizzes(CID)).toBe(false);
    expect(await probeQuizzes(CID)).toBe(false);
    expect(quizzesOffered(CID)).toBe(false);
    expect(QuizData.save(CID, AID, payload(), [T1, T2])).toEqual({ ok: false });
    await settle();
    expect(session.fake.calls.map(c => c.name)).toEqual(['list_quiz']);
  });

  it('a server with list_quiz answers "not found" to the probe: offered', async () => {
    session.fake.on('list_quiz', () => ({ data: null, error: { code: 'P0002', message: 'not found' } }));
    expect(await probeQuizzes(CID)).toBe(true);
    expect(quizzesOffered(CID)).toBe(true);
  });

  it('a save goes out with a key made on this device, the whole quiz, and the same key on a retry', async () => {
    session.fake.on('list_quiz', () => ({ data: null, error: { code: 'P0002', message: 'not found' } }));
    await probeQuizzes(CID);
    session.fake.failNext('save_quiz', 1);
    QuizData.save(CID, AID, payload(), [T1, T2]);
    for (let i = 0; i < 4; i++) {
      await window.v2Queue.flush();
      await settle();
    }
    const saves = session.fake.calls.filter(c => c.name === 'save_quiz').map(c => c.params);
    expect(saves.length).toBeGreaterThanOrEqual(2);
    expect(saves[0].p_assessment_id).toBe(AID);
    expect(saves[0].p_idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(saves.map(p => p.p_idempotency_key)).size).toBe(1);
    expect(saves[0].p_quiz).toEqual(payload());
    // Landed: nothing is kept back on this device.
    expect(localStorage.getItem('gb-quiz-unsent-' + CID)).toBeNull();
  });

  it('an assessment with a local id: the save waits for its create and goes with the server id', async () => {
    session.fake.on('list_quiz', () => ({ data: null, error: { code: 'P0002', message: 'not found' } }));
    await probeQuizzes(CID);
    const list = getAssessments(CID);
    const local = uid();
    list.push({ id: local, title: 'New Quiz', tagIds: [T1], date: '2026-11-18' });
    saveAssessments(CID, list);
    QuizData.save(CID, local, payload(), [T1, T2]);
    for (let i = 0; i < 6; i++) {
      await window.v2Queue.flush();
      await settle();
    }
    const sent = session.fake.calls.filter(c => c.name === 'save_quiz').map(c => c.params.p_assessment_id);
    expect(sent.length).toBeGreaterThan(0);
    sent.forEach(id => expect(id).toMatch(/^[0-9a-f]{8}-/));
    expect(sent).not.toContain(local);
    const made = session.fake.calls.find(c => c.name === 'create_assessment');
    expect(made).toBeTruthy();
    expect(session.fake.calls.indexOf(made)).toBeLessThan(session.fake.calls.findIndex(c => c.name === 'save_quiz'));
  });

  it('a local id with no create waiting is never sent; the quiz is kept here', async () => {
    session.fake.on('list_quiz', () => ({ data: null, error: { code: 'P0002', message: 'not found' } }));
    await probeQuizzes(CID);
    QuizData.save(CID, 'c-lost', payload(), [T1, T2]);
    await window.v2Queue.flush();
    await settle();
    expect(session.fake.count('save_quiz')).toBe(0);
    expect(QuizData.unsent(CID, 'c-lost').payload).toEqual(payload());
  });

  it('a refused save keeps the questions and says why, in the teacher’s words', async () => {
    session.fake.on('list_quiz', () => ({ data: null, error: { code: 'P0002', message: 'not found' } }));
    session.fake.on('save_quiz', () => ({
      data: null,
      error: { code: '22023', message: 'kind_locked', details: 'question 2: kind' },
    }));
    await probeQuizzes(CID);
    QuizData.save(CID, AID, payload(), [T1, T2]);
    for (let i = 0; i < 3; i++) {
      await window.v2Queue.flush();
      await settle();
    }
    const kept = QuizData.unsent(CID, AID);
    expect(kept.payload).toEqual(payload());
    expect(kept.message).toBe(
      'Students have answered a question here, so its type and Multiple Answers cannot change.',
    );
  });
});

describe('each refusal the contract names, and the sentence the teacher sees', () => {
  it.each([
    [{ code: 'PT401', message: 'not authenticated' }, 'You were signed out. Sign in again, then save the quiz.'],
    [{ code: 'P0002', message: 'not found' }, 'This assessment is no longer there, so its quiz could not be saved.'],
    [
      { code: '22023', message: 'bad_quiz', detail: 'question 3: points' },
      'Question 3 could not be saved as written. Check its words, choices, right answer and points, then save again.',
    ],
    [{ code: '22023', message: 'bad_quiz' }, 'Check its words, choices, right answer and points, then save again.'],
    [{ code: '22023', message: 'not_offered' }, 'A quiz cannot go on a pair or group assessment, or on a DIBELS one.'],
    [{ code: '22023', message: 'too_many_questions' }, 'A quiz can have up to 100 questions.'],
    [
      { code: '22023', message: 'kind_locked' },
      'Students have answered a question here, so its type and Multiple Answers cannot change.',
    ],
    [
      { code: '22023', message: 'choices_locked' },
      'Students have answered a question here, so its choices can be reworded or reordered but not added or removed.',
    ],
    [{ code: '22023', message: 'has_tries' }, 'Students have started this quiz, so it cannot be turned off.'],
    // Anything else, a near miss included, gets the one general sentence.
    [
      { code: '22023', message: 'bad_quiz_x' },
      'This quiz was not saved. Your questions are kept here; save again to send them.',
    ],
    [
      { code: '22023', message: 'Kind_Locked' },
      'This quiz was not saved. Your questions are kept here; save again to send them.',
    ],
    [
      { message: 'network: failed to fetch' },
      'This quiz was not saved. Your questions are kept here; save again to send them.',
    ],
  ])('%o', (error, sentence) => {
    expect(QuizData.refusalText(error)).toBe(sentence);
  });
});
