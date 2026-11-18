/**
 * Quizzes' Confirm (Grader.confirmQuiz; docs/plans/quizzes-plan.md, slice
 * Q4, "Confirm" and "The tests that hold it"): the golden-class proof.
 *
 * A fixture class in Demo Mode, in a Proficiency, a Letter and a Both class:
 * an Essay already scored, and three quizzes answered: Competencies scoring
 * with one try (and a try Reopen gave), Points scoring with Two Tries and
 * Best, Competencies with Unlimited Tries and Latest. Ava answers; Ben has a
 * score of his own on two of them; Cara is marked Missing and Dev Excused;
 * Eli's short answers are one assessed and one waiting; Fay sent two tries;
 * Gus sent nothing. For every student, the grades through calc.js
 * (studentGradeSummary, the overall, each competency, the course %):
 * - before Confirm, the quizzes move nothing;
 * - after Confirm, every grade is what setting the same levels by hand gives;
 * - Missing, Excused, a score already there and a waiting answer are left;
 * - Undo gives back every grade byte for byte, and the marking stored before.
 * QUIZ_GOLDEN_TABLE=<file> writes the before and after table for the PR.
 */
import './setup.js';
import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = 'quiz-golden';
const T1 = 'qg-t1';
const T2 = 'qg-t2';
const STUDENTS = ['Ava', 'Ben', 'Cara', 'Dev', 'Eli', 'Fay', 'Gus'].map((n, i) => ({
  id: 'qg-' + n.toLowerCase(),
  firstName: n,
  lastName: String.fromCharCode(65 + i) + 'ston',
}));
const sid = n => 'qg-' + n.toLowerCase();
const QC = 'qg-quiz-comp'; // Competencies, one try
const QP = 'qg-quiz-points'; // Points, Two Tries, Best
const QL = 'qg-quiz-latest'; // Competencies, Unlimited, Latest
const ESSAY = 'qg-essay';

let n = 0;
const uuid = () => {
  const h = String(++n).padStart(12, '0');
  return '00000000-0000-4000-8000-' + h;
};
const choice = (tag, points, rightAt, many) => {
  const choices = [0, 1, 2].map(() => ({ id: uuid(), text: 'Choice ' + n }));
  return {
    kind: 'choice',
    prompt: 'Pick one ' + n,
    multiple: !!many,
    points,
    tag_id: tag,
    choices,
    key: { answer: rightAt.map(i => choices[i].id).sort(), tolerance: null, why: null },
  };
};
const num = (tag, points) => ({
  kind: 'number',
  prompt: 'How tall?',
  multiple: false,
  points,
  tag_id: tag,
  key: { answer: 12.5, tolerance: 0.5, why: null },
});
const tf = (tag, points) => ({
  kind: 'true_false',
  prompt: 'True?',
  multiple: false,
  points,
  tag_id: tag,
  key: { answer: false, tolerance: null, why: null },
});
const text = (tag, points) => ({
  kind: 'text',
  prompt: 'Why?',
  multiple: false,
  points,
  tag_id: tag,
  key: { answer: null, tolerance: null, why: null },
});

const QUIZZES = {
  [QC]: {
    settings: { tries: 1, counts: 'best' },
    questions: () => [
      choice(T1, 1, [0]),
      num(T1, 2),
      tf(T1, 1),
      choice(T2, 2, [0, 2], true),
      choice(T2, 1, [1]),
      text(T2, 2),
      choice(null, 1, [0]),
    ],
  },
  [QP]: {
    settings: { tries: 2, counts: 'best' },
    questions: () => [choice(T1, 2, [0]), choice(T1, 3, [1]), text(T1, 2), choice(null, 1, [0])],
  },
  [QL]: {
    settings: { tries: 0, counts: 'latest' },
    questions: () => [choice(T1, 1, [0]), choice(T1, 1, [0]), choice(T1, 1, [0]), tf(T2, 1), tf(T2, 1), tf(T2, 1)],
  },
};

/* A raw answer: right or not, or for Text the points given (null waits). */
function answerOf(q, how) {
  if (q.kind === 'text') return { answer: 'Because the light changed.', given_points: how };
  if (q.kind === 'number') return { answer: how ? 12.9 : 14 };
  if (q.kind === 'true_false') return { answer: how ? q.key.answer : !q.key.answer };
  const wrong = q.choices.map(c => c.id).filter(c => q.key.answer.indexOf(c) < 0);
  return { answer: how ? q.key.answer.slice() : [wrong[0]] };
}
/* Each student's tries on each quiz: one list a try, true/false (or Text points) a question. */
const ANSWERS = {
  [QC]: {
    Ava: [[1, 1, 1, 1, 0, 2, 1]],
    Ben: [[1, 0, 1, 1, 1, 1, 0]],
    Cara: [[1, 1, 1, 1, 1, 2, 1]],
    Dev: [[0, 0, 0, 0, 0, 0, 0]],
    Eli: [[1, 1, 0, 0, 1, 1, 1]],
    Fay: [
      [0, 0, 1, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 2, 0],
    ],
  },
  [QP]: {
    Ava: [[1, 1, 2, 1]],
    Ben: [[1, 0, 1, 1]],
    Cara: [[0, 0, 0, 0]],
    Dev: [[1, 1, 2, 1]],
    Eli: [[1, 1, null, 0]],
    Fay: [
      [1, 1, 1, 0],
      [1, 0, 0, 1],
    ],
  },
  [QL]: {
    Ava: [[1, 1, 0, 1, 1, 1]],
    Ben: [[1, 1, 1, 1, 0, 0]],
    Eli: [[0, 1, 1, 1, 1, 0]],
    Fay: [
      [1, 1, 1, 1, 1, 1],
      [0, 0, 1, 0, 1, 1],
    ],
  },
};

function seed(system) {
  localStorage.clear();
  clearClass(CID);
  const essayScores = {};
  STUDENTS.forEach((st, i) => {
    essayScores[st.id] = [
      { assessmentId: ESSAY, tagId: T1, score: 1 + (i % 4), date: '2026-10-01', type: 'summative' },
      {
        assessmentId: ESSAY,
        tagId: T2,
        score: 1 + ((i + 2) % 4),
        mod: i % 3 === 1 ? 1 : 0,
        date: '2026-10-01',
        type: 'summative',
      },
    ];
  });
  // Ben's own scores, typed before the quiz was confirmed: they stay.
  essayScores[sid('Ben')].push({ assessmentId: QC, tagId: T1, score: 2, date: '2026-11-10', type: 'summative' });
  essayScores[sid('Ben')].push({ assessmentId: QP, tagId: T1, score: 5, date: '2026-11-11', type: 'summative' });
  const statuses = {};
  [QC, QP, QL].forEach(aid => {
    statuses[sid('Cara') + ':' + aid] = 'NS';
    statuses[sid('Dev') + ':' + aid] = 'EXC';
  });
  seedClass(CID, {
    students: STUDENTS,
    learningMaps: {
      subjects: [],
      sections: [
        { id: 'qg-s1', name: 'Questioning', tags: [{ id: T1, label: 'Questioning', code: 'QP1', text: 'Ask' }] },
        { id: 'qg-s2', name: 'Patterns', tags: [{ id: T2, label: 'Data Patterns', code: 'PA4', text: 'Find' }] },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [T1, T2], date: '2026-10-01', type: 'summative' },
      { id: QC, title: 'Light Check', tagIds: [T1, T2], date: '2026-11-10', type: 'summative' },
      {
        id: QP,
        title: 'Growth Points Check',
        scoreMode: 'points',
        maxPoints: 8,
        tagIds: [T1],
        date: '2026-11-11',
        type: 'summative',
      },
      { id: QL, title: 'Patterns Practice', tagIds: [T1, T2], date: '2026-11-12', type: 'formative' },
    ],
    scores: essayScores,
    statuses,
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  COURSES[CID].gradingSystem = system;
  localStorage.setItem('fv-build-quizzes', '1');
  Object.keys(QUIZZES).forEach(aid => {
    const q = QUIZZES[aid];
    const saved = _quizDemoSave(
      CID,
      aid,
      Object.assign(quizDefaults(), q.settings, { updated_at: null, questions: q.questions() }),
      aid === QP ? [T1] : [T1, T2],
    );
    expect(saved.ok, aid).toBe(true);
    const qs = saved.quiz.questions;
    const tries = {};
    Object.keys(ANSWERS[aid]).forEach(name => {
      tries[sid(name)] = {
        tries: ANSWERS[aid][name].map((row, t) => ({
          attempt_id: uuid(),
          try: t + 1,
          started_at: '2026-11-1' + (t + 3) + 'T18:00:00.000Z',
          sent_at: '2026-11-1' + (t + 3) + 'T18:20:00.000Z',
          reopened_at: aid === QC && t === 1 ? '2026-11-14T09:00:00.000Z' : null,
          question_order: { questions: qs.map(x => x.id).reverse(), choices: {} },
          marked: null,
          marked_at: null,
          answers: qs.map((x, i) =>
            Object.assign(
              { question_id: x.id, saved_at: '2026-11-13T18:10:00.000Z', given_points: null, note: null },
              answerOf(x, row[i]),
            ),
          ),
        })),
      };
    });
    expect(saveDemoQuizTriesSeed(CID, aid, tries)).toBe(true);
  });
  clearProfCache();
}

/* Every grade calc.js gives each student, as one string. */
function grades() {
  clearProfCache();
  const out = {};
  STUDENTS.forEach(st => {
    const letter = getCourseLetterData(CID, st.id);
    out[st.id] = JSON.stringify({
      summary: studentGradeSummary(CID, st.id),
      overall: getOverallProficiency(CID, st.id),
      tags: [T1, T2].map(t => getTagProficiency(CID, st.id, t)),
      percent: letter ? letter.R : null,
      letter: letter ? letter.letter : null,
      cells: [QC, QP, QL].map(aid =>
        assessmentCellValue(
          CID,
          st.id,
          getAssessments(CID).find(a => a.id === aid),
        ),
      ),
    });
  });
  return out;
}
const summaryOf = () => Object.fromEntries(STUDENTS.map(st => [st.id, studentGradeSummary(CID, st.id).text]));

/* Confirm on one quiz, as the results screen does it. */
function confirmOn(aid) {
  const m = QuizResults.model(CID, aid);
  const plan = GraderWork.quizConfirmPlan(CID, aid, QuizResults.confirmRows(m));
  return { plan, done: Grader.confirmQuiz(CID, aid, plan) };
}
const marks = aid =>
  QuizTries.get(CID, aid).students.map(s =>
    s.tries.map(t => (t.marked ? t.attempt_id + ':' + t.marked.earned : '-')).join(' '),
  );

let wasDemo;
beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
});
afterEach(() => {
  window.isDemoMode = wasDemo;
  clearClass(CID);
  localStorage.clear();
});

const TABLE = [];

describe.each(['proficiency', 'letter', 'both'])('the golden class, %s', system => {
  it('before Confirm the answered quizzes move no grade', () => {
    seed(system);
    const withQuizzes = grades();
    // The same class with no quiz stored at all.
    localStorage.removeItem('gb-quizzes-' + CID);
    localStorage.removeItem('gb-quiz-keys-' + CID);
    localStorage.removeItem('gb-quiz-tries-' + CID);
    expect(grades()).toEqual(withQuizzes);
  });

  it('after Confirm every grade is what the same levels set by hand give; Undo puts every grade back', () => {
    seed(system);
    const before = grades();
    const beforeText = summaryOf();
    const beforeMarks = [QC, QP, QL].map(marks);
    const runs = [QC, QP, QL].map(confirmOn);
    const after = grades();
    const afterText = summaryOf();

    // Left alone: Missing, Excused, and Gus who sent nothing.
    [sid('Cara'), sid('Dev'), sid('Gus')].forEach(s => expect(after[s], s).toBe(before[s]));
    // Ben's own scores stayed; Eli's waiting short answer kept his points score out.
    expect(levels(sid('Ben'), QC, T1)).toEqual([2, 0]);
    expect(getPointsScore(CID, sid('Ben'), QP)).toBe(5);
    expect(getPointsScore(CID, sid('Eli'), QP)).toBe(null);
    expect(runs[1].plan.waiting).toBe(1);
    expect(runs.map(r => r.plan.locked)).toEqual([2, 2, 0]);

    // By hand: the same cells through the grader's own setLevel and setPoints, in a fresh class.
    const cells = runs.map(r => r.plan.cells);
    seed(system);
    cells.forEach((list, i) =>
      list.forEach(c => {
        const aid = [QC, QP, QL][i];
        if (c.points != null) Grader.setPoints(CID, c.sid, aid, c.points);
        else Grader.setLevel(CID, c.sid, aid, c.key, c.level, c.mod);
      }),
    );
    expect(grades()).toEqual(after);

    // Undo, in the class Confirm wrote: every grade back, byte for byte, and the marking.
    seed(system);
    const again = [QC, QP, QL].map(confirmOn);
    expect(grades()).toEqual(after);
    again
      .slice()
      .reverse()
      .forEach((r, i) => Grader.undoConfirmQuiz(CID, [QL, QP, QC][i], r.done));
    const undone = grades();
    STUDENTS.forEach(st => expect(undone[st.id], st.firstName).toBe(before[st.id]));
    expect([QC, QP, QL].map(marks)).toEqual(beforeMarks);

    STUDENTS.forEach(st =>
      TABLE.push([
        system,
        st.firstName,
        beforeText[st.id],
        afterText[st.id],
        undone[st.id] === before[st.id] ? 'yes' : 'NO',
      ]),
    );
  });
});

function levels(s, aid, tag) {
  const e = (getScores(CID)[s] || []).find(x => x.assessmentId === aid && x.tagId === tag);
  return e ? [Number(e.score), e.mod || 0] : null;
}

describe('Confirm, one quiz at a time', () => {
  it('sets only cells with no score, skips Missing and Excused, and asks in the plan’s words', () => {
    seed('proficiency');
    const m = QuizResults.model(CID, QC);
    const plan = GraderWork.quizConfirmPlan(CID, QC, QuizResults.confirmRows(m));
    // Ava 2, Ben 1 (his T1 is his own), Eli 2, Fay 2 (her second try counts: the one-try quiz's reopened try).
    expect(plan.cells.map(c => c.sid.slice(3) + ' ' + c.key)).toEqual([
      'ava qg-t1',
      'ava qg-t2',
      'ben qg-t2',
      'eli qg-t1',
      'eli qg-t2',
      'fay qg-t1',
      'fay qg-t2',
    ]);
    expect(plan.ask).toEqual({
      title: 'Confirm 7 Levels',
      message:
        'Confirm 7 levels for 4 students on Light Check? They count toward each student’s grade. They stay drafts until you return them. 1 level already on this piece stays as it is. 2 students are marked Missing or Excused and left out.',
      button: 'Confirm 7 Levels',
    });
    const done = Grader.confirmQuiz(CID, QC, plan);
    expect(done.set).toBe(7);
    expect(levels(sid('Ben'), QC, T1)).toEqual([2, 0]);
    expect(levels(sid('Cara'), QC, T1)).toBe(null);
    expect(levels(sid('Dev'), QC, T2)).toBe(null);
    // Each confirmed is a Draft until returned (When I Return Them).
    expect(GradeState.stateOf(CID, sid('Ava'), QC)).toBe(GradeState.DRAFT);
    // Stored: the marking of the try that counts, for each student confirmed.
    const fay = QuizTries.get(CID, QC).students.find(s => s.enrollment_id === sid('Fay'));
    expect(fay.tries.map(t => !!t.marked)).toEqual([false, true]);
    // A second Confirm sets nothing new.
    const twice = GraderWork.quizConfirmPlan(CID, QC, QuizResults.confirmRows(QuizResults.model(CID, QC)));
    expect(twice.cells).toEqual([]);
    expect(twice.ask.title).toBe('Nothing to Confirm');
  });

  it('under As Soon As I Save the question says students see them at once', () => {
    seed('proficiency');
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { return_grades: 'on_save' }));
    const plan = GraderWork.quizConfirmPlan(CID, QL, QuizResults.confirmRows(QuizResults.model(CID, QL)));
    expect(plan.ask.message).toContain('Students see them at once.');
  });

  it('a level the teacher stepped is the one confirmed', () => {
    seed('proficiency');
    const changes = { [sid('Ava') + '|' + T1]: { level: 3, mod: 1 } };
    const m = QuizResults.model(CID, QC, changes);
    const plan = GraderWork.quizConfirmPlan(CID, QC, QuizResults.confirmRows(m));
    Grader.confirmQuiz(CID, QC, plan);
    expect(levels(sid('Ava'), QC, T1)).toEqual([3, 1]);
  });

  it('Undo keeps a cell scored again since Confirm', () => {
    seed('proficiency');
    const { done } = confirmOn(QC);
    Grader.setLevel(CID, sid('Ava'), QC, T1, 1, 0);
    Grader.undoConfirmQuiz(CID, QC, done);
    expect(levels(sid('Ava'), QC, T1)).toEqual([1, 0]);
    expect(levels(sid('Ava'), QC, T2) || [0, 0]).toEqual([0, 0]);
  });

  it('a key fixed after Confirm marks the student Changed Since Confirmed and moves nothing', () => {
    seed('proficiency');
    confirmOn(QC);
    const before = grades();
    const quiz = QuizData.get(CID, QC);
    const payload = Object.assign({}, quiz.quiz, { questions: quiz.questions });
    delete payload.assessment_id;
    delete payload.created_at;
    payload.questions = quiz.questions.map(q => {
      const out = {
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        multiple: q.multiple,
        points: q.points,
        tag_id: q.tag_id,
        key: q.key,
      };
      if (q.kind === 'choice') out.choices = q.choices;
      return out;
    });
    payload.questions[0].key = { answer: [quiz.questions[0].choices[1].id], tolerance: null, why: null };
    expect(_quizDemoSave(CID, QC, payload, [T1, T2]).ok).toBe(true);
    const m = QuizResults.model(CID, QC);
    expect(m.students.filter(s => s.changedSince).map(s => s.first)).toEqual(['Ava', 'Ben', 'Eli', 'Fay']);
    expect(grades()).toEqual(before);
  });
});

describe('the table for the PR', () => {
  it('is written when asked', () => {
    if (!process.env.QUIZ_GOLDEN_TABLE) return;
    const rows = [
      '| Style | Student | Before Confirm | After Confirm | After Undo, byte for byte |',
      '| --- | --- | --- | --- | --- |',
    ];
    TABLE.forEach(r => rows.push('| ' + r.join(' | ') + ' |'));
    writeFileSync(process.env.QUIZ_GOLDEN_TABLE, rows.join('\n') + '\n');
  });
});
