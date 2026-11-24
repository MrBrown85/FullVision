/**
 * A quiz goes with its copy (shared/data-quizzes.js copyQuiz and
 * teacher/assessment-copy.js carryQuiz, slice Q7 of docs/plans/quizzes-plan.md).
 *
 * 1. Copy to Another Class, Add From Another Class (Copy Assessment) and
 *    Duplicate each carry the quiz: questions, key and settings, a new id for
 *    every question, never a student's tries.
 * 2. Each question's competency is matched by name in the other class by
 *    AssessmentCopy.mapTags; one with no match counts toward no competency
 *    and the teacher is told how many, in one sentence.
 * 3. Signed in, the copy's quiz is a new save (updated_at null, a new key)
 *    queued under the new piece's outbox key: it waits for the piece's own
 *    create, and a local id never reaches the server.
 * 4. With the quizzes switch off the three paths do what they did before:
 *    the same calls, the same saved objects, the same localStorage.
 * 5. A piece with no quiz is copied as it always was.
 */
import './setup.js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  click,
  settle,
  openAssignments,
  closePages,
  serverSaysStudentPageOn,
} from './helpers/pin-save-paths.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const SRC = U(1);
const DST = U(2);
const AID = U(31);
const PLAIN = U(32);
const T1 = U(41); // Questioning, in both classes
const T2 = U(42); // Patterns, only here
const D1 = U(61); // Questioning, in the other class
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const PAGE = { student_page_enabled: true, return_grades: 'on_return' };
const settled = () => new Promise(r => setTimeout(r, 10));

function map(id, label, tagId) {
  return {
    subjects: [],
    sections: [{ id: id, name: 'Section', tags: [{ id: tagId, label: label, text: label + ' text' }] }],
    _customized: true,
    _version: 1,
    _flatVersion: 2,
  };
}

function questions() {
  return [
    {
      kind: 'choice',
      prompt: 'Which is a producer?',
      choices: [
        { id: C1, text: 'Grass' },
        { id: C2, text: 'Hawk' },
      ],
      multiple: false,
      points: 2,
      tag_id: T1,
      key: { answer: [C1], tolerance: null, why: 'Grass makes its own food.' },
    },
    {
      kind: 'number',
      prompt: 'Average height at week 4, in cm?',
      multiple: false,
      points: 3,
      tag_id: T2,
      key: { answer: 12.5, tolerance: 0.1, why: null },
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
      kind: 'text',
      prompt: 'What would you test next?',
      multiple: false,
      points: 2,
      tag_id: T2,
      key: { answer: null, tolerance: null, why: null },
    },
  ];
}

const SETTINGS = {
  shuffle_questions: false,
  shuffle_choices: true,
  tries: 2,
  counts: 'latest',
  shows: 'right',
  add_total: true,
  after_due: 'until',
  accept_until: '2026-12-01',
};

function plant() {
  // The source's learning map holds both competencies; the other class has only Questioning.
  const both = map(U(51), 'Questioning', T1);
  both.sections.push({ id: U(52), name: 'Patterns', tags: [{ id: T2, label: 'Patterns', text: 'Patterns text' }] });
  seedClass(SRC, {
    learningMaps: both,
    assessments: [
      { id: AID, title: 'Food Webs Check', tagIds: [T1, T2], date: '2026-11-10' },
      { id: PLAIN, title: 'Light Lab', tagIds: [T1], date: '2026-11-11' },
    ],
    courseConfigs: PAGE,
  });
  seedClass(DST, { learningMaps: map(U(62), 'Questioning', D1), assessments: [], courseConfigs: PAGE });
  COURSES[DST] = { ...COURSES[DST], name: 'Science 8 B' };
  localStorage.setItem('fv-build-quizzes', '1');
}

/* The two classes under the Assignments page: its document holds the dialogs
   (Check Before Adding) and the Duplicate button. The page clears
   localStorage, then plants the classes. */
function seedBoth() {
  openAssignments(plant, SRC);
}

/* The source piece with a quiz (Demo Mode: kept apart in this device's own store). */
function giveQuiz() {
  const res = QuizData.save(SRC, AID, { updated_at: null, ...SETTINGS, questions: questions() }, [T1, T2]);
  expect(res.ok).toBe(true);
}

const acceptDialog = async () => {
  await settled();
  const ok = document.querySelector('[data-copy-ok]');
  if (ok) ok.click();
  await settled();
};

const source = () => getAssessments(SRC).find(a => a.id === AID);

/* Copy to Another Class: the saved piece, linked, then copied. */
async function copyToDst() {
  const a = { ...source(), copyGroup: AssessmentCopy.newCopyGroup() };
  saveAssessments(
    SRC,
    getAssessments(SRC).map(x => (x.id === AID ? a : x)),
  );
  const done = AssessmentCopy.copyToClasses(SRC, a, [{ cid: DST }]);
  await acceptDialog();
  await done;
  await settle();
  return getAssessments(DST)[0];
}

let wasDemo;
let toasts;
beforeEach(() => {
  // A fixed Date, as the fixture was recorded with: nothing time-derived differs between runs or zones.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T18:00:00.000Z'));
  wasDemo = window.isDemoMode;
  localStorage.clear();
  _quizProbe = {};
  _quizHeld = {};
  toasts = [];
  globalThis.showSyncToast = msg => toasts.push(msg);
});
afterEach(() => {
  vi.useRealTimers();
  closePages();
  clearClass(SRC);
  clearClass(DST);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  globalThis.showSyncToast = () => {};
});

describe('in Demo Mode', () => {
  beforeEach(() => {
    window.isDemoMode = () => true;
    seedBoth();
  });

  it('Copy to Another Class carries the questions, the key and the settings', async () => {
    giveQuiz();
    const copy = await copyToDst();
    expect(copy.title).toBe('Food Webs Check');
    expect(copy.id).not.toBe(AID);
    const got = QuizData.get(DST, copy.id);
    expect(got.quiz).toMatchObject(SETTINGS);
    expect(got.questions).toHaveLength(4);
    const was = questions();
    got.questions.forEach((q, i) => {
      expect(q.kind).toBe(was[i].kind);
      expect(q.prompt).toBe(was[i].prompt);
      expect(q.points).toBe(was[i].points);
      expect(q.multiple).toBe(was[i].multiple);
      expect(q.key).toEqual(was[i].key);
      if (was[i].choices) expect(q.choices).toEqual(was[i].choices);
      // A new question: never the source's id.
      expect(q.id).toBeTruthy();
    });
    // The source's own quiz is as it was.
    expect(QuizData.get(SRC, AID).questions.map(q => q.prompt)).toEqual(was.map(q => q.prompt));
    expect(got.questions.map(q => q.id)).not.toEqual(QuizData.get(SRC, AID).questions.map(q => q.id));
  });

  it('each question’s competency is matched by name; one with no match counts toward none, and the teacher is told how many', async () => {
    giveQuiz();
    const copy = await copyToDst();
    // Questioning is in both classes under another id; Patterns is only here.
    expect(copy.tagIds).toEqual([D1]);
    const tags = QuizData.get(DST, copy.id).questions.map(q => q.tag_id);
    expect(tags).toEqual([D1, null, null, null]);
    const said = toasts.filter(t => /Counts Toward No Competency/.test(t));
    expect(said).toEqual([
      '2 quiz questions are set to Counts Toward No Competency in Science 8 B, because their competencies aren’t there.',
    ]);
  });

  it('one question is told in the singular', async () => {
    const q = questions().slice(0, 2);
    QuizData.save(SRC, AID, { updated_at: null, ...SETTINGS, questions: q }, [T1, T2]);
    await copyToDst();
    expect(toasts.filter(t => /Counts Toward/.test(t))).toEqual([
      '1 quiz question is set to Counts Toward No Competency in Science 8 B, because its competency isn’t there.',
    ]);
  });

  it('nothing is said when every competency matched', async () => {
    const q = questions().filter(x => x.tag_id !== T2);
    QuizData.save(SRC, AID, { updated_at: null, ...SETTINGS, questions: q }, [T1, T2]);
    await copyToDst();
    expect(toasts.filter(t => /Counts Toward/.test(t))).toEqual([]);
  });

  it('Add From Another Class (Copy Assessment) carries the quiz', async () => {
    giveQuiz();
    const done = AssessmentCopy.addFrom(SRC, [AID], DST);
    await acceptDialog();
    await done;
    await settle();
    const copy = getAssessments(DST)[0];
    const got = QuizData.get(DST, copy.id);
    expect(got.quiz).toMatchObject(SETTINGS);
    expect(got.questions.map(q => q.prompt)).toEqual(questions().map(q => q.prompt));
    expect(got.questions[0].key.answer).toEqual([C1]);
    expect(got.questions.map(q => q.tag_id)).toEqual([D1, null, null, null]);
  });

  it('Duplicate carries the quiz, with the same competencies', async () => {
    giveQuiz();
    await settled();
    const button = document.querySelector('[data-action="dupeAssess"][data-aid="' + AID + '"]');
    expect(button).toBeTruthy();
    click(button);
    await settled();
    const dupe = getAssessments(SRC).find(a => a.title === 'Food Webs Check (Copy)');
    expect(dupe).toBeTruthy();
    const got = QuizData.get(SRC, dupe.id);
    expect(got.quiz).toMatchObject(SETTINGS);
    expect(got.questions.map(q => q.tag_id)).toEqual([T1, T2, null, T2]);
    expect(got.questions.map(q => q.prompt)).toEqual(questions().map(q => q.prompt));
    expect(got.questions[2].key.answer).toBe(false);
    expect(toasts).toEqual([]);
  });

  it('a piece with no quiz is copied as before, and no quiz is made for it', async () => {
    const a = { ...getAssessments(SRC).find(x => x.id === PLAIN), copyGroup: AssessmentCopy.newCopyGroup() };
    const done = AssessmentCopy.copyToClasses(SRC, a, [{ cid: DST }]);
    await acceptDialog();
    await done;
    await settle();
    const copy = getAssessments(DST)[0];
    expect(copy.title).toBe('Light Lab');
    expect(QuizData.get(DST, copy.id).quiz).toBeNull();
    expect(localStorage.getItem('gb-quizzes-' + DST)).toBeNull();
    expect(toasts.filter(t => /quiz/i.test(t))).toEqual([]);
  });

  it('a class that can’t take quizzes is told the quiz did not come along', async () => {
    giveQuiz();
    setStudentPageSwitch(DST, false);
    expect(getCourseConfig(DST).student_page_enabled).toBeFalsy();
    const copy = await copyToDst();
    expect(QuizData.get(DST, copy.id)).toBeNull();
    expect(localStorage.getItem('gb-quizzes-' + DST)).toBeNull();
    expect(toasts.some(t => /did not come along because Science 8 B can’t take quizzes right now\./.test(t))).toBe(
      true,
    );
  });

  it('no tries or answers are read or written: the other class holds only the quiz and its key', async () => {
    giveQuiz();
    await copyToDst();
    const kept = Object.keys(localStorage._store).filter(k => /quiz/.test(k));
    expect(kept.sort()).toEqual(
      [
        'fv-build-quizzes',
        'gb-quiz-keys-' + SRC,
        'gb-quiz-keys-' + DST,
        'gb-quizzes-' + DST,
        'gb-quizzes-' + SRC,
      ].sort(),
    );
    const store = JSON.parse(localStorage.getItem('gb-quizzes-' + DST));
    Object.values(store.quizzes).forEach(one => {
      expect(Object.keys(one).sort()).toEqual(['questions', 'quiz']);
    });
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
    seedBoth();
    serverSaysStudentPageOn(SRC, true);
    serverSaysStudentPageOn(DST, true);
    window.v2Queue.clear();
    // What the source quiz is, as list_quiz answers it.
    session.fake.on('list_quiz', params => {
      if (params.p_assessment_id !== AID) return { data: null, error: { code: 'P0002', message: 'not found' } };
      return {
        data: {
          quiz: { assessment_id: AID, ...SETTINGS, updated_at: '2026-11-18T10:00:00.123456+00:00' },
          questions: questions().map((q, i) => ({
            ...q,
            id: U(700 + i),
            position: i + 1,
            answered: true,
            archived_at: null,
          })),
          archived: [
            { ...questions()[0], id: U(799), position: null, answered: true, archived_at: '2026-11-17T10:00:00Z' },
          ],
        },
        error: null,
      };
    });
  });
  afterEach(() => {
    window.v2Queue.clear();
    serverSaysStudentPageOn(SRC, false);
    serverSaysStudentPageOn(DST, false);
    session.signOut();
    _teacherId = teacher;
  });

  const flushAll = async () => {
    for (let i = 0; i < 8; i++) {
      await window.v2Queue.flush();
      await settle();
    }
  };

  it('the copy’s quiz waits for the copy’s own create, even when the create has to be tried again', async () => {
    session.fake.failNext('create_assessment', 1);
    await copyToDst();
    await flushAll();
    const names = session.fake.calls.map(c => c.name);
    expect(names.filter(n => n === 'create_assessment').length).toBeGreaterThanOrEqual(2);
    expect(names.indexOf('save_quiz')).toBeGreaterThan(names.lastIndexOf('create_assessment'));
    const sent = session.fake.calls.filter(c => c.name === 'save_quiz').map(c => c.params.p_assessment_id);
    // The id the create answered, never the one made on this device.
    expect(sent).toEqual([getAssessments(DST)[0].id]);
    expect(sent[0]).toMatch(/^[0-9a-f]{8}-/);
  });

  it('the copy’s quiz is a new save, with a new key, updated_at null and the other class’s competency', async () => {
    await copyToDst();
    await flushAll();
    const names = session.fake.calls.map(c => c.name);
    const create = names.indexOf('create_assessment');
    const save = names.indexOf('save_quiz');
    expect(create).toBeGreaterThanOrEqual(0);
    expect(save).toBeGreaterThan(create);
    const saves = session.fake.calls.filter(c => c.name === 'save_quiz');
    expect(saves).toHaveLength(1);
    const p = saves[0].params;
    expect(p.p_assessment_id).toMatch(/^[0-9a-f]{8}-/);
    expect(p.p_assessment_id).not.toBe(AID);
    expect(p.p_idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(p.p_quiz.updated_at).toBeNull();
    expect(p.p_quiz).toMatchObject(SETTINGS);
    // The active questions only, no source id, no attempt or answer anywhere, the other class’s competency.
    expect(p.p_quiz.questions).toHaveLength(4);
    p.p_quiz.questions.forEach(q => {
      expect(q.id).toBeUndefined();
      expect(Object.keys(q).sort()).toEqual(
        (q.kind === 'choice'
          ? ['choices', 'key', 'kind', 'multiple', 'points', 'prompt', 'tag_id']
          : ['key', 'kind', 'multiple', 'points', 'prompt', 'tag_id']
        ).sort(),
      );
    });
    expect(p.p_quiz.questions[0].tag_id).toMatch(/^[0-9a-f]{8}-/);
    expect(p.p_quiz.questions.map(q => q.tag_id).slice(1)).toEqual([null, null, null]);
    // Nothing of any student's tries or answers is read or written.
    expect(names.some(n => /attempt|tries|answer|confirm_quiz|mark_quiz|reopen/.test(n))).toBe(false);
    // The only quiz read is the source's; the other reads are the probe for list_quiz itself.
    const read = session.fake.calls.filter(c => c.name === 'list_quiz').map(c => c.params.p_assessment_id);
    expect(read.filter(id => id !== AID && id !== '00000000-0000-4000-8000-000000000000')).toEqual([]);
  });

  it('a source with no quiz: the copy makes no save_quiz and no extra call', async () => {
    session.fake.on('list_quiz', () => ({ data: { quiz: null, questions: [], archived: [] }, error: null }));
    await copyToDst();
    await flushAll();
    expect(session.fake.count('save_quiz')).toBe(0);
  });

  it('Duplicate carries the quiz too, after the duplicate’s create', async () => {
    await settled();
    click(document.querySelector('[data-action="dupeAssess"][data-aid="' + AID + '"]'));
    await flushAll();
    const names = session.fake.calls.map(c => c.name);
    expect(names.indexOf('save_quiz')).toBeGreaterThan(names.indexOf('create_assessment'));
    const p = session.fake.calls.find(c => c.name === 'save_quiz').params;
    expect(p.p_quiz.updated_at).toBeNull();
    expect(p.p_quiz.questions.map(q => q.tag_id)).toEqual([T1, T2, null, T2]);
    expect(p.p_assessment_id).not.toBe(AID);
    expect(p.p_assessment_id).toMatch(/^[0-9a-f]{8}-/);
  });
});

/* With the switch off the three paths do what they did before this slice:
   the same RPCs with the same argument names, the same saved pieces, the same
   localStorage keys, the same toasts. tests/fixtures/quiz-copy-flag-off.json
   was recorded on main before this slice was written (QUIZ_COPY_RECORD=1
   writes it); the same test passes there. A class holding a quiz written
   while the switch was on keeps it apart and copies none of it. */
describe('with the quizzes switch off', () => {
  const FIXTURE = resolve(root, 'tests/fixtures/quiz-copy-flag-off.json');
  const recorded = {};
  let session;
  let teacher;

  const snap = copy => {
    const ids = [AID, PLAIN, SRC, DST];
    const plain = v =>
      JSON.parse(
        JSON.stringify(v, (k, x) => (k === 'created' ? '<now>' : k === 'copyGroup' && x ? '<group>' : x)).replace(
          /"(aaaaaaaa|[0-9a-f]{8})-[0-9a-f-]{27}"|"[cs](?=[a-z0-9]*\d)[a-z0-9]{8,}"/g,
          m => (ids.some(id => m === '"' + id + '"') ? m : '"<id>"'),
        ),
      );
    return plain({
      calls: session.fake.calls
        .filter(c => !/^((save|patch)_teacher_preferences|get_|list_)/.test(c.name))
        .map(c => [c.name, Object.keys(c.params || {}).sort()]),
      saved: copy,
      // Only the keys this slice could add to: the pieces and the quizzes. Others (the sync queue,
      // settings, the learning map) are written by background timers and say nothing about a copy.
      keys: Object.keys(localStorage._store)
        .filter(k => /^gb-(assessments|quiz)/.test(k))
        .map(k => k.replace(/[cs](?=[a-z0-9]*\d)[a-z0-9]{8,}$/, '<id>'))
        .sort(),
      toasts: toasts,
    });
  };

  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    teacher = _teacherId;
    _teacherId = 'teacher-a';
    window.isDemoMode = () => false;
    session = signIn();
    seedBoth();
    localStorage.removeItem('fv-build-quizzes');
    serverSaysStudentPageOn(SRC, true);
    serverSaysStudentPageOn(DST, true);
    window.v2Queue.clear();
    // A quiz written while the switch was on: kept apart, never copied.
    localStorage.setItem(
      'gb-quizzes-' + SRC,
      JSON.stringify({ quizzes: { [AID]: { quiz: SETTINGS, questions: [] } } }),
    );
  });
  afterEach(() => {
    window.v2Queue.clear();
    serverSaysStudentPageOn(SRC, false);
    serverSaysStudentPageOn(DST, false);
    session.signOut();
    _teacherId = teacher;
    if (process.env.QUIZ_COPY_RECORD && Object.keys(recorded).length === 3) {
      writeFileSync(FIXTURE, JSON.stringify(recorded, null, 2) + '\n');
    }
  });

  const flushAll = async () => {
    for (let i = 0; i < 6; i++) {
      await window.v2Queue.flush();
      await settle();
    }
  };
  const check = (name, got) => {
    if (process.env.QUIZ_COPY_RECORD) {
      recorded[name] = got;
      return;
    }
    expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf-8'))[name]);
  };

  it('Copy to Another Class: the same calls and the same saved piece', async () => {
    const copy = await copyToDst();
    await flushAll();
    check('copyToClasses', snap(copy));
    expect(Object.keys(localStorage._store).some(k => k === 'gb-quizzes-' + DST)).toBe(false);
  });

  it('Add From Another Class (Copy Assessment): the same calls and the same saved piece', async () => {
    const done = AssessmentCopy.addFrom(SRC, [AID], DST);
    await acceptDialog();
    await done;
    await flushAll();
    check('addFrom', snap(getAssessments(DST)[0]));
    expect(Object.keys(localStorage._store).some(k => k === 'gb-quizzes-' + DST)).toBe(false);
  });

  it('Duplicate: the same calls and the same saved piece', async () => {
    await settled();
    click(document.querySelector('[data-action="dupeAssess"][data-aid="' + AID + '"]'));
    await flushAll();
    check('duplicate', snap(getAssessments(SRC).find(a => a.title === 'Food Webs Check (Copy)')));
    expect(Object.keys(localStorage._store).filter(k => /^gb-quizzes-/.test(k))).toEqual(['gb-quizzes-' + SRC]);
  });
});
