/**
 * The Quiz card's guards (teacher/quiz-builder.js and shared/data-quizzes.js,
 * slice Q2b), from the independent review of PR 1586:
 *
 * 1. A quiz goes only on a piece with no scores and no student work in, so
 *    this slice moves no grade: on a scored Points piece, Max Points and every
 *    grade stay as they were (read through calc.js's studentGradeSummary); a
 *    piece with photos in says so; a scoring the teacher chose is left alone.
 * 3. A save kept by an earlier page load never goes out with an updated_at it
 *    was not based on; the outbox's own answer lets it go.
 * 4. The quiz save goes after the form's own save of the piece (one outbox
 *    key), and its key follows a local id when the create lands.
 * 5. A refused Take the Quiz Off is shown and not sent again.
 * 6. Delete and Reset Demo Data take a Demo quiz with them.
 * 7. A failed read still shows the questions this device kept.
 * 9. A competency still waiting for its server id holds the save; the
 *    teacher's choice is never dropped.
 * 10. The Student Work answers wait while a saved quiz is read.
 * 11. The save is read when the form's check passes.
 */
import './setup.js';
import { readFileSync } from 'fs';
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
  fire,
  tick,
  settle,
  openAssignments,
  closePages,
  serverSaysStudentPageOn,
} from './helpers/pin-save-paths.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = U(1);
const T1 = U(41);
const T2 = U(42);
const PTS = U(32);
const LAB = U(33);
const NEWQ = U(34);
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const STUDENTS = [11, 12, 13, 14, 15].map(n => ({ id: U(n), firstName: 'S' + n, lastName: 'L' + n }));
const PAGE = { student_page_enabled: true, return_grades: 'on_return' };

const settled = () => new Promise(r => setTimeout(r, 10));
const form = () => document.getElementById('new-assess-form');
const mount = () => document.getElementById('quiz-mount');
const edit = aid => click(document.querySelector('[data-action="editAssess"][data-aid="' + aid + '"]'));

function question(prompt, extra) {
  return {
    kind: 'choice',
    prompt,
    choices: [
      { id: C1, text: 'A' },
      { id: C2, text: 'B' },
    ],
    multiple: false,
    points: 1,
    tag_id: T1,
    key: { answer: [C1], tolerance: null, why: null },
    ...extra,
  };
}

function seed(extra, after) {
  return () => {
    seedClass(CID, {
      students: STUDENTS,
      learningMaps: {
        subjects: [],
        sections: [
          { id: U(51), name: 'Question', tags: [{ id: T1, label: 'Questioning', code: 'QP1', text: 'Ask' }] },
          { id: U(52), name: 'Patterns', tags: [{ id: T2, label: 'Patterns', code: 'PA4', text: 'Find' }] },
        ],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [
        // The reviewer's case: Points, out of 10, every student scored.
        { id: PTS, title: 'Cell Structure Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [T1], date: '2026-10-11' },
        { id: LAB, title: 'Light Lab', tagIds: [T1], date: '2026-10-12' },
        { id: NEWQ, title: 'Food Webs Check', tagIds: [T1, T2], date: '2026-10-13' },
      ],
      scores: Object.fromEntries(
        STUDENTS.map((st, i) => [
          st.id,
          [{ id: U(200 + i), assessmentId: PTS, tagId: T1, score: 4 + i, type: 'summative', date: '2026-10-11' }],
        ]),
      ),
      courseConfigs: PAGE,
      ...(extra || {}),
    });
    localStorage.setItem('fv-build-quizzes', '1');
    if (after) after();
  };
}

let wasDemo;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T18:00:00.000Z'));
  wasDemo = window.isDemoMode;
  localStorage.clear();
  _quizProbe = {};
  _quizHeld = {};
});
afterEach(() => {
  closePages();
  clearClass(CID);
  vi.useRealTimers();
  window.isDemoMode = wasDemo;
  localStorage.clear();
});

describe('in Demo Mode', () => {
  beforeEach(() => {
    window.isDemoMode = () => true;
  });

  it('a scored Points piece: no quiz offered, Max Points and every grade as they were', async () => {
    openAssignments(seed(), CID);
    await settled();
    const grades = () => STUDENTS.map(st => JSON.stringify(studentGradeSummary(CID, st.id)));
    const before = grades();
    const scores = JSON.stringify(getScores(CID));
    edit(PTS);
    await settled();
    expect(mount().querySelector('[data-value="quiz"]')).toBeNull();
    expect(mount().querySelector('#quiz-not-offered').textContent).toBe(
      'This assessment already has scores, so a quiz cannot be added to it. Make a new assessment for the quiz.',
    );
    // Even asked directly, it is refused.
    QuizBuilder.takeAnswer('quiz', null, () => {});
    expect(QuizBuilder.picked()).toBe(false);
    expect(form().querySelector('#af-maxpoints').value).toBe('10');
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    expect(getAssessments(CID).find(a => a.id === PTS).maxPoints).toBe(10);
    expect(JSON.stringify(getScores(CID))).toBe(scores);
    expect(grades()).toEqual(before);
    expect(QuizData.get(CID, PTS).quiz).toBeNull();
  });

  it('a quiz piece that has a score: Max Points is never written by the quiz', async () => {
    openAssignments(
      seed(null, () => {
        const p = { updated_at: null, ...QuizData.defaults(), questions: [question('One'), question('Two')] };
        expect(QuizData.save(CID, PTS, p, [T1]).ok).toBe(true);
      }),
      CID,
    );
    await settled();
    edit(PTS);
    await settled();
    expect(QuizBuilder.picked()).toBe(true);
    const box = form().querySelector('#af-maxpoints');
    expect(box.value).toBe('10');
    expect(box.readOnly).toBe(false);
    expect(document.getElementById('quiz-maxpoints-hint')).toBeNull();
  });

  it('a piece with no scores on Points: the quiz sets Max Points, and the box says so', async () => {
    openAssignments(seed({ scores: {} }), CID);
    await settled();
    edit(PTS);
    await settled();
    click(mount().querySelector('[data-quiz-act="answer"][data-value="quiz"]'));
    await settled();
    expect(form().querySelector('#af-maxpoints').value).toBe('1');
    expect(document.getElementById('quiz-maxpoints-hint').textContent).toBe(
      "The quiz sets this: it is the total of its questions' points.",
    );
  });

  it('a piece with photos in: no quiz offered, said in a sentence', async () => {
    openAssignments(
      seed({ scores: {} }, () => {
        saveDemoStudentWork(CID, {
          course: { send_work: false },
          assessments: [{ id: LAB, students_send: 'photos', after_due: 'keep', accept_until: null }],
          submissions: [
            {
              id: U(300),
              assessment_id: LAB,
              enrollment_id: STUDENTS[0].id,
              version: 1,
              state: 'sent',
              sent_by: STUDENTS[0].id,
              on_paper: false,
              is_late: false,
              note: null,
              created_at: '2026-10-12T18:00:00Z',
              sent_at: '2026-10-12T18:00:00Z',
              files: [],
            },
          ],
        });
      }),
      CID,
    );
    await settled();
    edit(LAB);
    await settled();
    expect(mount().querySelector('#quiz-not-offered').textContent).toBe(
      "This assessment already has students' work, so a quiz cannot be added to it. Make a new assessment for the quiz.",
    );
  });

  it('a new piece with a rubric the teacher chose: the quiz leaves the scoring and says why', async () => {
    openAssignments(
      seed({
        scores: {},
        rubrics: [
          { id: U(70), name: 'Lab Rubric', criteria: [{ id: U(71), name: 'Method', tagIds: [T1], levels: {} }] },
        ],
      }),
      CID,
    );
    await settled();
    click(document.querySelector('[data-action="showNewForm"]'));
    await settled();
    click(form().querySelector('.af-scoremode-btn[data-mode="proficiency"]'));
    await settled();
    expect(form().querySelector('#af-scoremode').value).toBe('proficiency');
    click(mount().querySelector('[data-quiz-act="answer"][data-value="quiz"]'));
    await settled();
    expect(form().querySelector('#af-scoremode').value).toBe('proficiency');
    expect(mount().querySelector('#quiz-why').textContent).toBe(
      'A quiz is scored by Competencies or Points. Choose one of them under Scoring, or another answer above.',
    );
  });

  it('Delete takes the quiz and its key with it; Reset clears the stores', async () => {
    openAssignments(
      seed({ scores: {} }, () => {
        QuizData.save(CID, NEWQ, { updated_at: null, ...QuizData.defaults(), questions: [question('Q')] }, [T1, T2]);
      }),
      CID,
    );
    await settled();
    expect(QuizData.get(CID, NEWQ).quiz).not.toBeNull();
    QuizData.forget(CID, NEWQ);
    expect(QuizData.get(CID, NEWQ).quiz).toBeNull();
    expect(localStorage.getItem('gb-quiz-keys-' + CID)).toBe('{}');
    QuizData.save(CID, NEWQ, { updated_at: null, ...QuizData.defaults(), questions: [question('Q')] }, [T1, T2]);
    localStorage.setItem('gb-quiz-unsent-' + CID, '{}');
    _clearCourseLocalState(CID);
    expect(Object.keys(localStorage._store).filter(k => /quiz/.test(k) && k.endsWith(CID))).toEqual([]);
    // Every quiz key starts gb-, so Sign Out's wipe of gb- keys takes them (shared/supabase.js).
    ['gb-quizzes-', 'gb-quiz-keys-', 'gb-quiz-unsent-'].forEach(k => expect(k.indexOf('gb-')).toBe(0));
    expect(readFileSync(resolve(root, 'shared/supabase.js'), 'utf-8')).toContain("key.startsWith('gb-')");
  });

  it('the page’s Delete Assessment calls the quiz’s forget', async () => {
    openAssignments(
      seed({ scores: {} }, () => {
        QuizData.save(CID, NEWQ, { updated_at: null, ...QuizData.defaults(), questions: [question('Q')] }, [T1, T2]);
      }),
      CID,
    );
    await settled();
    click(document.querySelector('[data-action="deleteAssess"][data-aid="' + NEWQ + '"]'));
    await settled();
    document.getElementById('confirm-ok-btn').onclick();
    await settled();
    expect(getAssessments(CID).some(a => a.id === NEWQ)).toBe(false);
    expect(QuizData.get(CID, NEWQ).quiz).toBeNull();
  });

  it('the save is read when the form’s check passes, not after the form is drawn again', async () => {
    openAssignments(seed({ scores: {} }), CID);
    await settled();
    edit(NEWQ);
    await settled();
    click(mount().querySelector('[data-quiz-act="answer"][data-value="quiz"]'));
    const S = QuizBuilder._model();
    S.qs[0].prompt = 'Which is a producer?';
    S.qs[0].choices[0].text = 'Grass';
    S.qs[0].choices[1].text = 'Hawk';
    S.qs[0].answer = [S.qs[0].choices[0].id];
    S.qs[0].tag = T2;
    expect(QuizBuilder.formOk()).toBe(true);
    // The competency boxes are gone (the form drawn again) before the quiz is saved.
    document.querySelectorAll('.af-tag-cb').forEach(b => b.remove());
    QuizBuilder.save(CID, NEWQ);
    expect(QuizData.get(CID, NEWQ).questions[0].tag_id).toBe(T2);
  });
});

describe('signed in', () => {
  let session;
  let teacher;
  const THEIRS = '2026-11-18T19:00:00.123456+00:00';
  const theirQuiz = (extra, questions) => ({
    data: {
      quiz: { assessment_id: NEWQ, updated_at: THEIRS, ...QuizData.defaults(), ...extra },
      questions: (questions || [question('Theirs: newer question')]).map((x, i) => ({
        ...x,
        id: x.id || U(400 + i),
        position: i + 1,
        answered: false,
        archived_at: null,
      })),
      archived: [],
    },
    error: null,
  });
  const notFound = { data: null, error: { code: 'P0002', message: 'not found' } };
  const sent = () => session.fake.calls.filter(c => c.name === 'save_quiz').map(c => c.params);
  async function flush() {
    for (let i = 0; i < 6; i++) {
      await window.v2Queue.flush();
      await settle();
    }
  }
  function plant(entries) {
    localStorage.setItem('gb-quiz-unsent-' + CID, JSON.stringify(entries));
  }
  // A class loaded from the server this session (shared/data.js _classFresh), as a load that worked leaves it.
  const S0 = (extra, after) => () => {
    seed(extra)();
    serverSaysStudentPageOn(CID, true);
    _classFresh[CID] = true;
    if (after) after();
  };

  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    teacher = _teacherId;
    _teacherId = 'teacher-a';
    window.isDemoMode = () => false;
    session = signIn();
    window.v2Queue.clear();
  });
  afterEach(() => {
    window.v2Queue.clear();
    serverSaysStudentPageOn(CID, false);
    session.signOut();
    _teacherId = teacher;
    delete _classFresh[CID];
  });

  it('a save left by an earlier load, answered since: let go, and never sent with the server’s updated_at', async () => {
    session.fake.on('list_quiz', p => (p.p_assessment_id === NEWQ ? theirQuiz() : notFound));
    const mine = {
      updated_at: '2026-11-18T17:00:00.000001+00:00',
      ...QuizData.defaults(),
      questions: [question('Mine: older')],
    };
    openAssignments(
      S0({ scores: {} }, () =>
        plant({ e1: { aid: NEWQ, payload: mine, message: '', at: '2026-11-18T17:00:01.000Z' } }),
      ),
      CID,
    );
    await settled();
    await probeQuizzes(CID);
    edit(NEWQ);
    for (let i = 0; i < 4; i++) await settle();
    const S = QuizBuilder._model();
    expect(S.stale).toBe(false);
    expect(S.qs.map(x => x.prompt)).toEqual(['Theirs: newer question']);
    expect(QuizData.unsent(CID, NEWQ)).toBeNull();
    QuizBuilder.save(CID, NEWQ);
    await flush();
    expect(sent()).toEqual([]);
  });

  it('a save left by an earlier load, still in the outbox and based on an older read: stale, with the choice', async () => {
    session.fake.on('list_quiz', p => (p.p_assessment_id === NEWQ ? theirQuiz() : notFound));
    const mine = {
      updated_at: '2026-11-18T17:00:00.000001+00:00',
      ...QuizData.defaults(),
      questions: [question('Mine: older')],
    };
    openAssignments(S0({ scores: {} }), CID);
    await settled();
    // Offline: it waits in the outbox, as one from an earlier load does.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.v2Queue.push(
      'save_quiz',
      { p_assessment_id: NEWQ, p_quiz: mine, p_idempotency_key: 'k1' },
      { id: 'k1', key: 'id:' + NEWQ, noFlush: true },
    );
    plant({ k1: { aid: NEWQ, payload: mine, message: '', at: '2026-11-18T17:00:01.000Z' } });
    await probeQuizzes(CID);
    edit(NEWQ);
    for (let i = 0; i < 4; i++) await settle();
    const S = QuizBuilder._model();
    expect(S.stale).toBe(true);
    expect(S.qs.map(x => x.prompt)).toEqual(['Mine: older']);
    // Never the server's updated_at with these questions.
    expect(QuizBuilder._payload().updated_at).toBe(mine.updated_at);
    expect(mount().querySelector('#quiz-stale-msg')).not.toBeNull();
  });

  it('the outbox’s own answer lets a kept save go, with no page waiting on it', async () => {
    session.fake.on('list_quiz', () => notFound);
    session.fake.on('save_quiz', () => ({
      data: { quiz: { updated_at: THEIRS }, questions: [], archived: [] },
      error: null,
    }));
    openAssignments(S0({ scores: {} }), CID);
    await settled();
    await probeQuizzes(CID);
    QuizData.unsent(CID, NEWQ); // the page reads what it kept: it listens to the outbox from here
    const p = { updated_at: null, ...QuizData.defaults(), questions: [question('Q')] };
    plant({ k2: { aid: NEWQ, payload: p, message: '', at: '2026-11-18T17:00:01.000Z' } });
    window.v2Queue.push(
      'save_quiz',
      { p_assessment_id: NEWQ, p_quiz: p, p_idempotency_key: 'k2' },
      { id: 'k2', key: 'id:' + NEWQ },
    );
    await flush();
    expect(localStorage.getItem('gb-quiz-unsent-' + CID)).toBeNull();
    expect(QuizData.get(CID, NEWQ).quiz.updated_at).toBe(THEIRS);
  });

  /* The form's own write of the piece goes first; the quiz's waits on the same outbox key until it is answered. */
  async function orderedAfter(seedExtra, change, formWrite) {
    session.fake.on('list_quiz', p =>
      p.p_assessment_id === NEWQ ? { data: { quiz: null, questions: [], archived: [] }, error: null } : notFound,
    );
    openAssignments(S0(seedExtra), CID);
    await settled();
    await probeQuizzes(CID);
    edit(NEWQ);
    for (let i = 0; i < 4; i++) await settle();
    change();
    await settled();
    click(mount().querySelector('[data-quiz-act="answer"][data-value="quiz"]'));
    const S = QuizBuilder._model();
    Object.assign(S.qs[0], { prompt: 'Which?', tag: T2 });
    S.qs[0].choices[0].text = 'A';
    S.qs[0].choices[1].text = 'B';
    S.qs[0].answer = [S.qs[0].choices[0].id];
    session.fake.hold();
    click(form().querySelector('.af-actions .btn-primary'));
    // The outbox sends by itself (no flush awaited: the server holds the answer).
    for (let i = 0; i < 6; i++) await settled();
    // The form's first write is out, held by the server; the quiz's is not sent while it is.
    const names = () => session.fake.calls.map(c => c.name);
    expect(names()).toContain('update_assessment');
    expect(names()).not.toContain('save_quiz');
    await session.fake.release();
    await flush();
    await session.fake.release();
    expect(names()).toContain(formWrite);
    expect(names().indexOf(formWrite)).toBeLessThan(names().indexOf('save_quiz'));
    expect(sent()).toHaveLength(1);
  }

  it('the quiz save goes after the form’s own save of the piece: a competency ticked in the same Save', async () => {
    await orderedAfter(
      {
        scores: {},
        assessments: [{ id: NEWQ, title: 'Food Webs Check', tagIds: [T1], date: '2026-10-13' }],
      },
      () => tick(form().querySelector('.af-tag-cb[value="' + T2 + '"]'), true),
      'update_assessment',
    );
  });

  it('the quiz save goes after the form’s own save of the piece: Pair to Individual in the same Save', async () => {
    await orderedAfter(
      {
        scores: {},
        assessments: [
          {
            id: NEWQ,
            title: 'Food Webs Check',
            tagIds: [T1, T2],
            date: '2026-10-13',
            collaboration: 'pair',
            pairs: [[STUDENTS[0].id, STUDENTS[1].id]],
          },
        ],
      },
      () => click(form().querySelector('.af-collab-btn[data-collab="individual"]')),
      'save_collab',
    );
  });

  it('a local id: the save is keyed to it, and the key follows the server id when the create lands', async () => {
    session.fake.on('list_quiz', () => notFound);
    openAssignments(S0({ scores: {} }), CID);
    await settled();
    await probeQuizzes(CID);
    session.fake.hold();
    const list = getAssessments(CID);
    const local = uid();
    list.push({ id: local, title: 'New', tagIds: [T1], date: '2026-11-18' });
    saveAssessments(CID, list);
    QuizData.save(CID, local, { updated_at: null, ...QuizData.defaults(), questions: [question('Q')] }, [T1]);
    await settled();
    const keyOf = () =>
      JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries.find(e => e.endpoint === 'save_quiz');
    expect(keyOf().key).toBe('id:' + local);
    await session.fake.release();
    await settle();
    const made = session.fake.calls.find(c => c.name === 'create_assessment');
    expect(made).toBeTruthy();
    const q = keyOf();
    if (q) expect(q.key).toMatch(/^id:[0-9a-f]{8}-/);
    await flush();
    const saves = sent();
    expect(saves).toHaveLength(1);
    expect(saves[0].p_assessment_id).toMatch(/^[0-9a-f]{8}-/);
  });

  it('a refused Take the Quiz Off: the quiz is shown still on, with the sentence, and not sent again', async () => {
    session.fake.on('list_quiz', p => (p.p_assessment_id === NEWQ ? theirQuiz() : notFound));
    openAssignments(
      S0({ scores: {} }, () =>
        plant({
          k3: {
            aid: NEWQ,
            payload: null,
            message: QuizData.refusalText({ code: '22023', message: 'has_tries' }),
            at: '2026-11-18T17:00:01.000Z',
          },
        }),
      ),
      CID,
    );
    await settled();
    await probeQuizzes(CID);
    edit(NEWQ);
    for (let i = 0; i < 4; i++) await settle();
    expect(QuizBuilder.picked()).toBe(true);
    expect(mount().querySelector('.quiz-msg').textContent).toBe(
      'Your last change to this quiz was not saved. A student has started this quiz, so it cannot be turned off.',
    );
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    await flush();
    expect(sent()).toEqual([]);
  });

  it('a failed read still shows the questions kept here, with a line that they are not saved yet', async () => {
    session.fake.on('list_quiz', p =>
      p.p_assessment_id === NEWQ ? { data: null, error: { code: '08000', message: 'network' } } : notFound,
    );
    const mine = { updated_at: null, ...QuizData.defaults(), questions: [question('Mine: queued question')] };
    openAssignments(
      S0({ scores: {} }, () =>
        plant({ e1: { aid: NEWQ, payload: mine, message: '', at: '2026-11-18T17:00:01.000Z', held: true } }),
      ),
      CID,
    );
    await settled();
    await probeQuizzes(CID);
    edit(NEWQ);
    for (let i = 0; i < 4; i++) await settle();
    expect(QuizBuilder.picked()).toBe(true);
    expect(QuizBuilder._model().qs.map(x => x.prompt)).toEqual(['Mine: queued question']);
    expect(mount().querySelector('.quiz-note').textContent).toBe(
      'These questions are kept on this computer and are not saved yet.',
    );
  });

  it('a competency still waiting for its server id holds the save, and the choice is kept', async () => {
    session.fake.on('list_quiz', () => notFound);
    openAssignments(S0({ scores: {} }), CID);
    await settled();
    await probeQuizzes(CID);
    const LOCAL_TAG = 't-local-1';
    QuizData.save(
      CID,
      NEWQ,
      { updated_at: null, ...QuizData.defaults(), questions: [question('Q', { tag_id: LOCAL_TAG })] },
      [LOCAL_TAG],
    );
    await flush();
    expect(sent()).toEqual([]);
    expect(QuizData.unsent(CID, NEWQ).payload.questions[0].tag_id).toBe(LOCAL_TAG);
    // The competency lands with its server id; the next outbox answer lets the save go.
    _learningMapIdRemap[CID] = { tag: { [LOCAL_TAG]: T2 } };
    window.v2Queue.push('note_course_opened', { p_course_id: CID }, {});
    await flush();
    expect(sent()).toHaveLength(1);
    expect(sent()[0].p_quiz.questions[0].tag_id).toBe(T2);
    delete _learningMapIdRemap[CID];
  });

  /* Offered only on a fact: the class's scores (and work) known to be loaded. */
  const offeredHere = () => !!mount() && !!mount().querySelector('[data-quiz-act="answer"][data-value="quiz"]');

  it('scores not loaded yet: not offered, nothing said; offered when they arrive', async () => {
    session.fake.on('list_quiz', p =>
      p.p_assessment_id === LAB ? { data: { quiz: null, questions: [], archived: [] }, error: null } : notFound,
    );
    let arrive;
    openAssignments(
      S0({ scores: {} }, () => {
        // The class's load still out.
        _classLoads[CID] = new Promise(r => (arrive = r));
        _classFresh[CID] = false;
      }),
      CID,
    );
    await settled();
    await probeQuizzes(CID);
    edit(LAB);
    for (let i = 0; i < 4; i++) await settle();
    expect(QuizData.factsKnown(CID)).toBe(false);
    expect(offeredHere()).toBe(false);
    expect(mount().querySelector('#quiz-not-offered')).toBeNull();
    // Asked directly: refused, and a save sends nothing.
    QuizBuilder.takeAnswer('quiz', null, () => {});
    expect(QuizBuilder.picked()).toBe(false);
    QuizBuilder._model().picked = true;
    QuizBuilder.save(CID, LAB);
    QuizBuilder._model().picked = false;
    await flush();
    expect(sent()).toEqual([]);
    // The load lands: the answer appears.
    _classLoads[CID] = true;
    _classFresh[CID] = true;
    arrive();
    for (let i = 0; i < 4; i++) await settle();
    expect(offeredHere()).toBe(true);
  });

  it('student work not read yet: not offered', async () => {
    session.fake.on('list_quiz', p =>
      p.p_assessment_id === LAB ? { data: { quiz: null, questions: [], archived: [] }, error: null } : notFound,
    );
    openAssignments(S0({ scores: {} }), CID);
    await settled();
    await probeQuizzes(CID);
    delete _workRead[CID];
    expect(QuizData.factsKnown(CID)).toBe(false);
    _workRead[CID] = { at: Date.now() };
    expect(QuizData.factsKnown(CID)).toBe(true);
  });

  it('scores loaded and none on the piece: offered', async () => {
    session.fake.on('list_quiz', p =>
      p.p_assessment_id === LAB ? { data: { quiz: null, questions: [], archived: [] }, error: null } : notFound,
    );
    openAssignments(S0({ scores: {} }), CID);
    await settled();
    await probeQuizzes(CID);
    edit(LAB);
    for (let i = 0; i < 4; i++) await settle();
    expect(QuizData.factsKnown(CID)).toBe(true);
    expect(offeredHere()).toBe(true);
  });

  it('scores loaded and one on the piece: the sentence', async () => {
    session.fake.on('list_quiz', p =>
      p.p_assessment_id === PTS ? { data: { quiz: null, questions: [], archived: [] }, error: null } : notFound,
    );
    openAssignments(S0(), CID);
    await settled();
    await probeQuizzes(CID);
    edit(PTS);
    for (let i = 0; i < 4; i++) await settle();
    expect(offeredHere()).toBe(false);
    expect(mount().querySelector('#quiz-not-offered').textContent).toBe(
      'This assessment already has scores, so a quiz cannot be added to it. Make a new assessment for the quiz.',
    );
  });

  /* The "no scores" fact must come from the server: a failed load keeps this
     device's saved copy, and the class still counts as loaded. */
  async function pointsForm(fresh) {
    session.fake.on('list_quiz', p =>
      p.p_assessment_id === PTS ? { data: { quiz: null, questions: [], archived: [] }, error: null } : notFound,
    );
    openAssignments(
      S0({ scores: {} }, () => {
        _classFresh[CID] = fresh;
      }),
      CID,
    );
    await settled();
    await probeQuizzes(CID);
    expect(isClassLoaded(CID)).toBe(true);
    edit(PTS);
    for (let i = 0; i < 4; i++) await settle();
  }

  it('a failed load with a saved copy that has no scores: not offered, and Max Points is not written', async () => {
    await pointsForm(false);
    expect(QuizData.factsKnown(CID)).toBe(false);
    expect(offeredHere()).toBe(false);
    QuizBuilder.takeAnswer('quiz', null, () => {});
    expect(QuizBuilder.picked()).toBe(false);
    expect(form().querySelector('#af-maxpoints').value).toBe('10');
    expect(form().querySelector('#af-maxpoints').readOnly).toBe(false);
  });

  it('a load from the server with no scores: offered, and Max Points is tied to the quiz', async () => {
    await pointsForm(true);
    expect(offeredHere()).toBe(true);
    click(mount().querySelector('[data-quiz-act="answer"][data-value="quiz"]'));
    await settled();
    const box = form().querySelector('#af-maxpoints');
    expect(box.value).toBe('1');
    expect(box.readOnly).toBe(true);
  });

  it('scores arriving from the server let the tie go: Max Points goes back and is saved as it was', async () => {
    await pointsForm(true);
    click(mount().querySelector('[data-quiz-act="answer"][data-value="quiz"]'));
    await settled();
    const box = form().querySelector('#af-maxpoints');
    expect(box.value).toBe('1');
    // A refresh brings a score entered on another device.
    const scores = getScores(CID);
    scores[STUDENTS[0].id] = [
      { id: U(250), assessmentId: PTS, tagId: T1, score: 8, type: 'summative', date: '2026-10-11' },
    ];
    _cache.scores[CID] = scores;
    const S = QuizBuilder._model();
    Object.assign(S.qs[0], { prompt: 'Which?' });
    S.qs[0].choices[0].text = 'A';
    S.qs[0].choices[1].text = 'B';
    S.qs[0].answer = [S.qs[0].choices[0].id];
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    expect(box.value).toBe('10');
    expect(box.readOnly).toBe(false);
    expect(mount().querySelector('.quiz-note').textContent).toBe(
      'This assessment already has scores, so a quiz cannot be added to it. Make a new assessment for the quiz.',
    );
    await flush();
    // The piece keeps 10; the quiz is not saved onto a piece that now has a score.
    expect(getAssessments(CID).find(a => a.id === PTS).maxPoints).toBe(10);
    expect(sent()).toEqual([]);
    expect(
      session.fake.calls.filter(c => c.name === 'update_assessment').map(c => c.params.p_patch.max_points),
    ).not.toContain('1');
  });

  it('while the saved quiz is read the Student Work answers wait', async () => {
    let answer;
    session.fake.on('list_quiz', p => (p.p_assessment_id === NEWQ ? new Promise(r => (answer = r)) : notFound));
    openAssignments(S0({ scores: {} }), CID);
    await settled();
    await probeQuizzes(CID);
    edit(NEWQ);
    await settled();
    expect(QuizBuilder._model().loading).toBe(true);
    expect(QuizBuilder.takeAnswer('quiz', null, () => {})).toBe(true);
    expect(QuizBuilder.picked()).toBe(false);
    answer(theirQuiz());
    for (let i = 0; i < 4; i++) await settle();
    expect(QuizBuilder._model().loading).toBe(false);
    expect(QuizBuilder.picked()).toBe(true);
  });
});
