/**
 * Draft and Returned in the data layer (S0-F2,
 * docs/plans/student-page-build-plan.md 1.2): shared/data.js keeps one row
 * per student per assessment beside the scores and runs the rule in
 * shared/grade-state.js on every score write.
 *
 * - Every score writer leaves the right state. The list walked is the one
 *   in tests/grader-guard.test.js, so a writer added there needs a scenario
 *   here.
 * - With the build switch off nothing is kept: no row, no localStorage key.
 * - The rows move with a re-keyed id and go with a deleted class or
 *   assessment.
 * - A signed-in teacher's switch reads off, and the two settings are never
 *   sent to the server (S0-W1 wires them once Batch A is applied).
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, signIn, seedClass, clearClass, settle } from './helpers/pin-save-paths.js';

const CID = 'c-held';
const ESSAY = { id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['t1', 't2'] };
const QUIZ = {
  id: 'quiz',
  title: 'Quiz',
  date: '2026-10-12',
  scoreMode: 'points',
  maxPoints: 10,
  tagIds: ['t1', 't2'],
};
const DONE = { id: 'done', title: 'Reading Log', date: '2026-10-13', scoreMode: 'complete', tagIds: ['t1'] };
const LAB = { id: 'lab', title: 'Lab', date: '2026-10-14', type: 'summative', tagIds: ['t1'], rubricId: 'rub' };
const TALK = {
  id: 'talk',
  title: 'Talk',
  date: '2026-10-15',
  type: 'summative',
  tagIds: ['t1'],
  collaboration: 'pair',
  pairs: [['s1', 's2']],
};
const RUBRIC = {
  id: 'rub',
  name: 'Lab Report',
  criteria: [
    {
      id: 'c1',
      name: 'Method',
      tagIds: ['t1'],
      levels: {},
      checks: [{ id: 'k1', level: 3, label: 'Lists every step' }],
    },
    { id: 'c2', name: 'Safety', tagIds: ['t1'], levels: {}, checks: [{ id: 'k2', level: 3, label: 'Wears goggles' }] },
  ],
};
const STUDENTS = ['s1', 's2', 's3', 's4'].map((id, i) => ({
  id,
  firstName: ['Jordan', 'Avery', 'Noor', 'Lena'][i],
  lastName: 'Test',
}));

const state = (sid, aid) => GradeState.stateOf(CID, sid, aid);
const row = (sid, aid) => getGradeReturn(CID, sid, aid);
const level = (sid, aid, tid, value, mod) =>
  upsertScore(CID, sid, aid, tid, value, '2026-10-10', 'summative', '', mod || 0);
const give = (aid, ...sids) => returnGrades(CID, aid, sids);
const storedRows = () => localStorage.getItem('gb-grade-returns-' + CID);
const three = {
  v: 1,
  value: null,
  modifier: 0,
  comment: null,
  tags: { t1: { value: 3, modifier: 0, comment: null } },
  criteria: {},
  checks: [],
};

function seed(config) {
  localStorage.clear();
  clearClass(CID);
  seedClass(CID, {
    students: STUDENTS,
    assessments: [ESSAY, QUIZ, DONE, LAB, TALK].map(a => structuredClone(a)),
    rubrics: [structuredClone(RUBRIC)],
    courseConfigs: config || {},
  });
}
const held = () => seed({ student_page_enabled: true, return_grades: 'on_return' });

/* Each writer in a class that holds grades: what it does to a piece with no
   grade, and to one whose grade was returned. `on` is false for the run
   with the switch off, where the writes are made and nothing is checked. */
const WRITER_SCENARIOS = {
  upsertScore(on) {
    level('s1', 'essay', 't1', 3);
    if (on) expect(state('s1', 'essay')).toBe('draft');
    if (on) expect(row('s1', 'essay')).toEqual({ is_draft: true });
    give('essay', 's1');
    if (on) expect(state('s1', 'essay')).toBe('returned');
    level('s1', 'essay', 't1', 4, -1);
    if (!on) return;
    // The student keeps the grade that was returned.
    expect(state('s1', 'essay')).toBe('draft');
    expect(row('s1', 'essay').returned_copy).toEqual(three);
    // The same save again changes nothing; put back, it is not a draft.
    const before = JSON.stringify(row('s1', 'essay'));
    level('s1', 'essay', 't1', 4, -1);
    expect(JSON.stringify(row('s1', 'essay'))).toBe(before);
    level('s1', 'essay', 't1', 3);
    expect(state('s1', 'essay')).toBe('returned');
    expect(row('s1', 'essay').returned_copy).toBeUndefined();
  },
  setPointsScore(on) {
    setPointsScore(CID, 's1', 'quiz', 7);
    if (on) expect(state('s1', 'quiz')).toBe('draft');
    give('quiz', 's1');
    setPointsScore(CID, 's1', 'quiz', 8);
    if (!on) return;
    expect(state('s1', 'quiz')).toBe('draft');
    // One score, however many competencies carry it on this device.
    expect(row('s1', 'quiz').returned_copy).toMatchObject({ value: 7, tags: {} });
    // Cleared after it was returned, it waits; returned, there is no grade.
    setPointsScore(CID, 's1', 'quiz', null);
    expect(state('s1', 'quiz')).toBe('draft');
    give('quiz', 's1');
    expect(state('s1', 'quiz')).toBe(null);
    expect(row('s1', 'quiz')).toBe(null);
  },
  setCompletionMark(on) {
    setCompletionMark(CID, 's1', 'done', 'incomplete');
    if (on) expect(state('s1', 'done')).toBe('draft');
    give('done', 's1');
    setCompletionMark(CID, 's1', 'done', 'complete');
    if (on) expect(row('s1', 'done').returned_copy).toMatchObject({ value: 0 });
    // A draft never returned, cleared, leaves nothing.
    setCompletionMark(CID, 's2', 'done', 'complete');
    setCompletionMark(CID, 's2', 'done', null);
    if (on) expect(row('s2', 'done')).toBe(null);
  },
  setRubricCheck(on) {
    setRubricCheck(CID, 's1', 'lab', 'k1', true);
    if (on) expect(state('s1', 'lab')).toBe('draft');
    give('lab', 's1');
    // A tick taken off and put back is not a draft.
    setRubricCheck(CID, 's1', 'lab', 'k1', false);
    if (on) expect(row('s1', 'lab').returned_copy.checks).toEqual(['k1']);
    setRubricCheck(CID, 's1', 'lab', 'k1', true);
    if (on) expect(row('s1', 'lab')).toMatchObject({ is_draft: false });
  },
  saveRubricCriterionComment(on) {
    saveRubricCriterionComment(CID, 's1', 'lab', 'c1', 'Number the steps');
    if (on) expect(state('s1', 'lab')).toBe('draft');
    give('lab', 's1');
    saveRubricCriterionComment(CID, 's1', 'lab', 'c1', 'Number every step');
    if (on) expect(row('s1', 'lab').returned_copy.criteria.c1.comment).toBe('Number the steps');
  },
  saveRubricCriterionBeyond(on) {
    saveRubricCriterionBeyond(CID, 's1', 'lab', 'c2', 'Drew the set-up');
    if (on) expect(state('s1', 'lab')).toBe('draft');
    give('lab', 's1');
    saveRubricCriterionBeyond(CID, 's1', 'lab', 'c2', '');
    if (on) expect(row('s1', 'lab').returned_copy.criteria.c2.beyond).toBe('Drew the set-up');
  },
  saveTagComment(on) {
    saveTagComment(CID, 's1', 'essay', 't2', 'Use a second source');
    if (on) expect(state('s1', 'essay')).toBe('draft');
    give('essay', 's1');
    saveTagComment(CID, 's1', 'essay', 't2', '');
    if (on) expect(row('s1', 'essay').returned_copy.tags.t2.comment).toBe('Use a second source');
  },
  saveScoreComment(on) {
    level('s1', 'essay', 't1', 3);
    give('essay', 's1');
    saveScoreComment(CID, 's1', 'essay', 'Careful work.');
    if (on) expect(state('s1', 'essay')).toBe('draft');
    if (on) expect(row('s1', 'essay').returned_copy).toEqual(three);
    // A comment alone, on a piece with no level, is a grade too.
    saveScoreComment(CID, 's2', 'essay', 'See me.');
    if (on) expect(state('s2', 'essay')).toBe('draft');
  },
  saveScoreReportNote(on) {
    // A Note for the Report never makes a draft.
    level('s1', 'essay', 't1', 3);
    give('essay', 's1');
    const before = JSON.stringify(row('s1', 'essay'));
    saveScoreReportNote(CID, 's1', 'essay', 'explained her method');
    expect(getScoreReportNote(CID, 's1', 'essay')).toBe('explained her method');
    if (on) expect(state('s1', 'essay')).toBe('returned');
    if (on) expect(JSON.stringify(row('s1', 'essay'))).toBe(before);
  },
  setAssignmentStatus(on) {
    // Late on a returned grade shows at once and is not a draft.
    level('s1', 'essay', 't1', 3);
    give('essay', 's1');
    setAssignmentStatus(CID, 's1', 'essay', 'LATE');
    if (on) expect(state('s1', 'essay')).toBe('returned');
    // A status on a draft: the grade still waits.
    level('s2', 'essay', 't1', 2);
    setAssignmentStatus(CID, 's2', 'essay', 'LATE');
    if (on) expect(state('s2', 'essay')).toBe('draft');
    // A status alone is not a grade.
    setAssignmentStatus(CID, 's3', 'essay', 'EXC');
    if (on) expect(state('s3', 'essay')).toBe(null);
    if (on) expect(row('s3', 'essay')).toBe(null);
  },
  applyAssignmentStatus(on) {
    // Missing on unscored proficiency work writes a 0 for every competency:
    // the zeros make no draft.
    expect(applyAssignmentStatus(CID, 's1', 'essay', 'NS')).toBe(true);
    expect(getScores(CID).s1.map(e => e.score)).toEqual([0, 0]);
    if (on) expect(state('s1', 'essay')).toBe(null);
    if (on) expect(row('s1', 'essay')).toBe(null);
    applyAssignmentStatus(CID, 's1', 'essay', null);
    if (on) expect(row('s1', 'essay')).toBe(null);
  },
  saveDibelsScore(on) {
    // A DIBELS window's numbers are not in a copy of a grade.
    saveDibelsScore(CID, 's1', 'essay', 'boy', { orfWrc: 90, orfErrors: 2, mazeCorrect: 12, mazeIncorrect: 1 });
    if (on) expect(row('s1', 'essay')).toBe(null);
  },
  setGradedSeparately(on) {
    // Pair work: one save grades both, and each has their own row.
    level('s1', 'talk', 't1', 3);
    if (on) expect([state('s1', 'talk'), state('s2', 'talk')]).toEqual(['draft', 'draft']);
    give('talk', 's1', 's2');
    if (on) expect([state('s1', 'talk'), state('s2', 'talk')]).toEqual(['returned', 'returned']);
    // Grade Separately changes no grade.
    setGradedSeparately(CID, 'talk', 's2', true);
    if (on) expect(state('s2', 'talk')).toBe('returned');
    level('s1', 'talk', 't1', 4);
    if (on) expect([state('s1', 'talk'), state('s2', 'talk')]).toEqual(['draft', 'returned']);
    // Back to Group Grade replaces their grade: it waits, and they keep theirs.
    setGradedSeparately(CID, 'talk', 's2', false);
    if (on) expect(state('s2', 'talk')).toBe('draft');
    if (on) expect(row('s2', 'talk').returned_copy).toEqual(three);
  },
  saveScores(on) {
    // A fill: several students at once.
    const scores = getScores(CID);
    ['s1', 's2', 's3'].forEach(sid => {
      scores[sid] = (scores[sid] || []).concat([
        {
          id: sid + ':essay:t1',
          assessmentId: 'essay',
          tagId: 't1',
          score: 3,
          date: '2026-10-10',
          type: 'summative',
          note: '',
        },
      ]);
    });
    saveScores(CID, scores);
    if (on) expect(['s1', 's2', 's3', 's4'].map(sid => state(sid, 'essay'))).toEqual(['draft', 'draft', 'draft', null]);
    // Saved again with nothing changed, nothing happens.
    const before = storedRows();
    saveScores(CID, getScores(CID));
    expect(storedRows()).toBe(before);
  },
  persistScoreDiffToCanonical(on) {
    // It sends what changed; it changes no grade on this device.
    level('s1', 'essay', 't1', 3);
    const before = storedRows();
    persistScoreDiffToCanonical(CID, {}, getScores(CID));
    expect(storedRows()).toBe(before);
    if (on) expect(state('s1', 'essay')).toBe('draft');
  },
  clearScoreEntries(on) {
    // Clear Score on a returned grade waits as a draft, then returns as no grade.
    level('s1', 'essay', 't1', 3);
    give('essay', 's1');
    saveScores(CID, clearScoreEntries(CID, getScores(CID), 's1', ESSAY, ['t1', 't2']));
    if (on) expect(state('s1', 'essay')).toBe('draft');
    if (on) expect(row('s1', 'essay').returned_copy).toEqual(three);
    give('essay', 's1');
    if (on) expect(state('s1', 'essay')).toBe(null);
    if (on) expect(row('s1', 'essay')).toBe(null);
  },
  restoreScoreCells(on) {
    // Undo for a fill. s1's grade was returned at 3; s2 had none.
    level('s1', 'essay', 't1', 3);
    give('essay', 's1');
    const before = structuredClone(getScores(CID));
    level('s1', 'essay', 't1', 4);
    level('s2', 'essay', 't1', 4);
    const after = structuredClone(getScores(CID));
    if (on) expect([state('s1', 'essay'), state('s2', 'essay')]).toEqual(['draft', 'draft']);
    restoreScoreCells(CID, before, after);
    // Put back to what was returned: not a draft. A draft undone: nothing.
    if (on) expect([state('s1', 'essay'), state('s2', 'essay')]).toEqual(['returned', null]);
    if (on) expect(row('s2', 'essay')).toBe(null);
    // Undo sends every write twice: the second changes nothing.
    const rows = storedRows();
    persistScoreDiffToCanonical(CID, after, getScores(CID));
    expect(storedRows()).toBe(rows);
  },
  saveAssignmentStatuses(on) {
    level('s1', 'essay', 't1', 3);
    give('essay', 's1');
    const before = storedRows();
    saveAssignmentStatuses(CID, { 's1:essay': 'LATE', 's3:essay': 'EXC' });
    expect(storedRows()).toBe(before);
    if (on) expect(state('s1', 'essay')).toBe('returned');
  },
  saveRubricChecks(on) {
    saveRubricChecks(CID, { 's1:lab': ['k1'], 's2:lab': ['k2'] });
    if (on) expect([state('s1', 'lab'), state('s2', 'lab')]).toEqual(['draft', 'draft']);
  },
  returnGrades(on) {
    level('s1', 'essay', 't1', 3);
    level('s2', 'essay', 't1', 2);
    const out = returnGrades(CID, 'essay', ['s1']);
    expect(out.returned).toBe(on ? 1 : 0);
    if (on) expect([state('s1', 'essay'), state('s2', 'essay')]).toEqual(['returned', 'draft']);
  },
  moveRubricScores(on) {
    // Edit a Copy on scored work: each grade keeps its state.
    level('s1', 'lab', 'c1', 3);
    setRubricCheck(CID, 's1', 'lab', 'k1', true);
    give('lab', 's1');
    level('s1', 'lab', 'c1', 2); // s1: a draft on a returned grade
    level('s2', 'lab', 'c2', 4); // s2: a draft never returned
    level('s3', 'lab', 'c1', 3);
    give('lab', 's3'); // s3: returned
    const states = () => ['s1', 's2', 's3'].map(sid => state(sid, 'lab'));
    const before = states();
    moveRubricScores(CID, 'lab', {
      rubricId: 'rub2',
      criteria: { c1: 'c1b', c2: 'c2b' },
      checks: { k1: 'k1b', k2: 'k2b' },
    });
    expect(getScores(CID).s1.map(e => e.tagId)).toEqual(['c1b']);
    if (!on) return;
    expect(before).toEqual(['draft', 'draft', 'returned']);
    expect(states()).toEqual(before);
    // What the student was given points at the copy's criteria and checkboxes.
    expect(Object.keys(row('s1', 'lab').returned_copy.criteria)).toEqual(['c1b']);
    expect(row('s1', 'lab').returned_copy.checks).toEqual(['k1b']);
    expect(JSON.parse(storedRows()).lab.s1.returned_copy.checks).toEqual(['k1b']);
  },
};

const guardWriters = () => {
  const src = readFileSync(join(new URL('.', import.meta.url).pathname, 'grader-guard.test.js'), 'utf-8');
  const list = src.slice(src.indexOf('const WRITERS = ['), src.indexOf('];', src.indexOf('const WRITERS = [')));
  return [...list.matchAll(/^\s*'(\w+)',/gm)].map(m => m[1]);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T18:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  clearClass(CID);
  // The re-key tests leave their ids mapped for the class.
  delete _idRekeys[CID];
  localStorage.clear();
});

describe('every score writer in data.js follows the rule', () => {
  it('has a scenario for every writer the guard test lists', () => {
    const writers = guardWriters();
    expect(writers.length).toBeGreaterThan(15);
    expect(Object.keys(WRITER_SCENARIOS).sort()).toEqual(writers.slice().sort());
  });

  it.each(Object.keys(WRITER_SCENARIOS))('%s, in a class that holds grades', name => {
    held();
    WRITER_SCENARIOS[name](true);
    // What is kept is what localStorage holds.
    expect(JSON.parse(storedRows() || '{}')).toEqual(getGradeReturns(CID));
  });

  it.each(Object.keys(WRITER_SCENARIOS))('%s, with the switch off: no row and no localStorage key', name => {
    // Return Grades set, the student page off: every save is returned at once.
    seed({ return_grades: 'on_return' });
    WRITER_SCENARIOS[name](false);
    expect(getGradeReturns(CID)).toEqual({});
    expect(_cache.gradeReturns[CID]).toBeUndefined();
    expect(Object.keys(localStorage._store).filter(k => k.indexOf('grade-returns') >= 0)).toEqual([]);
  });

  it('with the switch off a piece is Returned once it has a score, as before', () => {
    seed();
    expect(state('s1', 'essay')).toBe(null);
    level('s1', 'essay', 't1', 3);
    expect(state('s1', 'essay')).toBe('returned');
    expect(returnGrades(CID, 'essay', ['s1'])).toEqual({ returned: 0, enrollment_ids: [], returned_at: null });
  });

  it('As Soon As I Save, and no choice made: a save is returned at once, with the time', () => {
    ['on_save', undefined].forEach(choice => {
      seed({ student_page_enabled: true, return_grades: choice });
      level('s1', 'essay', 't1', 3);
      expect(state('s1', 'essay')).toBe('returned');
      expect(row('s1', 'essay')).toEqual({ is_draft: false, returned_at: '2026-11-09T18:00:00.000Z' });
      // Nothing on this device marks a piece seen, so a change is not marked Updated.
      level('s1', 'essay', 't1', 4);
      expect(row('s1', 'essay').seen_at).toBeUndefined();
      expect(row('s1', 'essay').updated_at).toBeUndefined();
    });
  });
});

describe('Return', () => {
  beforeEach(held);

  it('returns only drafts, one student or many, and answers as the server will', () => {
    level('s1', 'essay', 't1', 3);
    level('s2', 'essay', 't1', 2);
    level('s3', 'essay', 't1', 4);
    expect(returnGrades(CID, 'essay', 's1')).toEqual({
      returned: 1,
      enrollment_ids: ['s1'],
      returned_at: '2026-11-09T18:00:00.000Z',
    });
    // s1 is returned already and s4 has no grade: both are skipped.
    expect(returnGrades(CID, 'essay', ['s1', 's2', 's4', 's2']).enrollment_ids).toEqual(['s2']);
    expect(['s1', 's2', 's3', 's4'].map(sid => state(sid, 'essay'))).toEqual(['returned', 'returned', 'draft', null]);
    expect(returnGrades(CID, 'essay', []).returned).toBe(0);
    expect(returnGrades(CID, 'essay', null).returned).toBe(0);
  });

  it('a changed grade, returned again, keeps what the student had before', () => {
    level('s1', 'essay', 't1', 3);
    give('essay', 's1');
    vi.setSystemTime(new Date('2026-11-12T18:00:00.000Z'));
    level('s1', 'essay', 't1', 4);
    expect(row('s1', 'essay')).toMatchObject({
      is_draft: true,
      returned_at: '2026-11-09T18:00:00.000Z',
      returned_copy: three,
    });
    give('essay', 's1');
    expect(row('s1', 'essay')).toEqual({
      is_draft: false,
      returned_at: '2026-11-12T18:00:00.000Z',
      previous_copy: three,
      updated_at: '2026-11-12T18:00:00.000Z',
    });
  });

  it('a grade that was there before the switch came on is Returned, and a change to it waits', () => {
    seed();
    level('s1', 'essay', 't1', 3);
    setStudentPageSwitch(CID, true);
    expect(state('s1', 'essay')).toBe('returned');
    expect(row('s1', 'essay')).toBe(null);
    level('s1', 'essay', 't1', 4);
    expect(row('s1', 'essay')).toMatchObject({ is_draft: true, returned_copy: three });
  });

  it('Grader.returnGrades returns them, and GradeState says where each piece stands', () => {
    Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
    expect(GradeState.afterSave(CID, 's1', 'essay', 'level')).toBe('draft');
    expect(Grader.returnGrades(CID, 'essay', 's1').returned).toBe(1);
    expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('returned');
    // A status is never a draft: Missing work has no state.
    Grader.setStatus(CID, 's2', 'essay', 'NS');
    expect(GradeState.afterSave(CID, 's2', 'essay', 'status')).toBe(null);
  });

  it('with the rule throwing, Return throws nothing: the failure is reported and nothing is returned', () => {
    level('s1', 'essay', 't1', 3);
    const real = GradeState.afterReturn;
    const sentry = window.Sentry;
    const reported = [];
    window.Sentry = { captureException: e => reported.push(e) };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    GradeState.afterReturn = () => {
      throw new Error('the rule broke');
    };
    try {
      expect(returnGrades(CID, 'essay', ['s1'])).toEqual({ returned: 0, enrollment_ids: [], returned_at: null });
      expect(Grader.returnGrades(CID, 'essay', ['s1']).returned).toBe(0);
    } finally {
      GradeState.afterReturn = real;
      window.Sentry = sentry;
      quiet.mockRestore();
    }
    expect(reported.length).toBe(2);
    expect(state('s1', 'essay')).toBe('draft');
    expect(returnGrades(CID, 'essay', ['s1']).returned).toBe(1);
  });

  it('drops the cached numbers, so returned-only grades are worked out again', () => {
    level('s1', 'essay', 't1', 3);
    const real = globalThis.clearProfCache;
    let cleared = 0;
    globalThis.clearProfCache = () => {
      cleared++;
      real();
    };
    try {
      give('essay', 's1');
    } finally {
      globalThis.clearProfCache = real;
    }
    expect(cleared).toBeGreaterThan(0);
  });
});

describe('Missing wins at once', () => {
  beforeEach(held);

  it('a returned grade, cleared and marked Missing, is not a draft; Missing taken off, it waits again', () => {
    level('s1', 'essay', 't1', 3);
    give('essay', 's1');
    saveScores(CID, clearScoreEntries(CID, getScores(CID), 's1', ESSAY, ['t1', 't2']));
    expect(state('s1', 'essay')).toBe('draft');
    expect(applyAssignmentStatus(CID, 's1', 'essay', 'NS')).toBe(true);
    expect(state('s1', 'essay')).toBe(null);
    // The returned set still holds what was returned: calc.js is where a
    // Missing piece counts no level, in both sets ("with real grade math").
    expect(getReturnedScores(CID).s1.filter(e => e.assessmentId === 'essay' && e.score > 0).length).toBe(1);
    applyAssignmentStatus(CID, 's1', 'essay', null);
    expect(state('s1', 'essay')).toBe('draft');
    expect(
      getReturnedScores(CID)
        .s1.filter(e => e.assessmentId === 'essay')
        .map(e => [e.tagId, e.score]),
    ).toEqual([['t1', 3]]);
  });
});

describe('leaving When I Return Them returns every waiting draft', () => {
  const setUp = () => {
    held();
    level('s1', 'essay', 't1', 3); // never returned
    level('s2', 'essay', 't1', 3);
    give('essay', 's2');
    level('s2', 'essay', 't1', 4); // changed since it was returned
    setPointsScore(CID, 's3', 'quiz', 7);
    give('quiz', 's3');
    setPointsScore(CID, 's3', 'quiz', null); // cleared since it was returned
    vi.setSystemTime(new Date('2026-11-12T18:00:00.000Z'));
  };
  const after = () => {
    expect(row('s1', 'essay')).toEqual({ is_draft: false, returned_at: '2026-11-12T18:00:00.000Z' });
    expect(row('s2', 'essay')).toEqual({
      is_draft: false,
      returned_at: '2026-11-12T18:00:00.000Z',
      previous_copy: three,
      updated_at: '2026-11-12T18:00:00.000Z',
    });
    // A cleared grade, once returned, shows no result.
    expect(row('s3', 'quiz')).toBe(null);
    expect(getReturnedScores(CID)).toBe(getScores(CID));
  };

  it('when As Soon As I Save is chosen', () => {
    setUp();
    setStudentPageSwitch(CID, true, 'on_save');
    after();
  });

  it('when the student page is turned off', () => {
    setUp();
    setStudentPageSwitch(CID, false);
    after();
  });

  it('when the settings are changed in place and saved, as Class Settings saves them', () => {
    setUp();
    const cfg = getCourseConfig(CID);
    cfg.return_grades = 'on_save';
    saveCourseConfig(CID, cfg);
    after();
  });

  it('another setting saved in a class that still holds grades returns nothing', () => {
    setUp();
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { calcMethod: 'mostRecent' }));
    expect([state('s1', 'essay'), state('s2', 'essay'), state('s3', 'quiz')]).toEqual(['draft', 'draft', 'draft']);
  });
});

describe('the rows go where the class’s other data goes', () => {
  beforeEach(() => {
    held();
    level('s1', 'lab', 'c1', 3);
    setRubricCheck(CID, 's1', 'lab', 'k1', true);
    give('lab', 's1');
    level('s1', 'lab', 'c1', 2);
    level('s1', 'essay', 't1', 3);
    give('essay', 's1');
    level('s1', 'essay', 't1', 4);
  });

  it('a student’s local id becomes a server id', () => {
    _rekey(CID, 'student', 's1', U(11));
    expect(getGradeReturn(CID, 's1', 'essay')).toBe(null);
    expect(getGradeReturn(CID, U(11), 'essay')).toMatchObject({ is_draft: true, returned_copy: three });
    expect(JSON.parse(storedRows()).essay[U(11)].is_draft).toBe(true);
    expect(GradeState.stateOf(CID, U(11), 'essay')).toBe('draft');
    // The returned set is built again for the new id.
    expect(
      getReturnedScores(CID)
        [U(11)].filter(e => e.assessmentId === 'essay')
        .map(e => e.score),
    ).toEqual([3]);
  });

  it('an assessment’s local id becomes a server id', () => {
    _rekey(CID, 'assessment', 'essay', U(31));
    expect(getGradeReturns(CID).essay).toBeUndefined();
    expect(getGradeReturn(CID, 's1', U(31)).returned_copy).toEqual(three);
    expect(GradeState.stateOf(CID, 's1', U(31))).toBe('draft');
  });

  it('a competency, a criterion and a checkbox inside a kept copy', () => {
    _rekey(CID, 'tag', 't1', U(51));
    expect(Object.keys(getGradeReturn(CID, 's1', 'essay').returned_copy.tags)).toEqual([U(51)]);
    _rekey(CID, 'criterion', 'c1', U(73));
    expect(Object.keys(getGradeReturn(CID, 's1', 'lab').returned_copy.criteria)).toEqual([U(73)]);
    _rekey(CID, 'check', 'k1', U(74));
    expect(getGradeReturn(CID, 's1', 'lab').returned_copy.checks).toEqual([U(74)]);
    expect(JSON.parse(storedRows()).lab.s1.returned_copy.checks).toEqual([U(74)]);
    // Still what was returned: putting the grade back is not a draft.
    upsertScore(CID, 's1', 'lab', U(73), 3, '2026-10-14', 'summative', '', 0);
    expect(GradeState.stateOf(CID, 's1', 'lab')).toBe('returned');
  });

  it('a class with no rows gains none from a re-key', () => {
    seed();
    level('s1', 'essay', 't1', 3);
    _rekey(CID, 'student', 's1', U(11));
    expect(storedRows()).toBe(null);
    expect(_cache.gradeReturns[CID]).toBeUndefined();
  });

  it('a class moved to its server id takes its rows with it', () => {
    const rows = structuredClone(getGradeReturns(CID));
    COURSES[U(1)] = Object.assign({}, COURSES[CID], { id: U(1) });
    try {
      _migrateCourseDataLocalToCanonical(CID, U(1));
      expect(storedRows()).toBe(null);
      expect(JSON.parse(localStorage.getItem('gb-grade-returns-' + U(1)))).toEqual(rows);
      expect(getGradeReturns(U(1))).toEqual(rows);
    } finally {
      clearClass(U(1));
    }
  });

  it('a deleted assessment’s rows go with its scores', () => {
    saveAssessments(
      CID,
      getAssessments(CID).filter(a => a.id !== 'lab'),
    );
    expect(Object.keys(getGradeReturns(CID))).toEqual(['essay']);
    expect(Object.keys(JSON.parse(storedRows()))).toEqual(['essay']);
  });

  it('a deleted class’s rows are removed from this device', () => {
    _clearCourseLocalState(CID);
    expect(storedRows()).toBe(null);
    expect(_cache.gradeReturns[CID]).toBeUndefined();
    expect(getGradeReturns(CID)).toEqual({});
  });

  it('a class read again from this device reads its rows again', () => {
    const rows = structuredClone(getGradeReturns(CID));
    localStorage.setItem('gb-grade-returns-' + CID, JSON.stringify({ essay: { s2: { is_draft: true } } }));
    _loadCourseFromLS(CID);
    expect(getGradeReturns(CID)).toEqual({ essay: { s2: { is_draft: true } } });
    expect(getGradeReturns(CID)).not.toEqual(rows);
  });

  it('the key is one Sign Out and a change of teacher remove (gb-)', () => {
    expect(Object.keys(localStorage._store).filter(k => k.indexOf('grade-returns') >= 0)).toEqual([
      'gb-grade-returns-' + CID,
    ]);
    expect(_DATA_KEYS.gradeReturns).toBe('grade-returns');
  });
});

describe('the build switch', () => {
  it('is turned on by hand on this device, and starts the class on When I Return Them', () => {
    seed();
    expect(getReturnSettings(CID)).toEqual({ student_page: false, return_grades: null });
    expect(setStudentPageSwitch(CID, true)).toBe(true);
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    expect(getCourseConfig(CID)).toMatchObject({ student_page_enabled: true, return_grades: 'on_return' });
    setStudentPageSwitch(CID, true, 'on_save');
    expect(getReturnSettings(CID).return_grades).toBe('on_save');
    // Turned on again with no choice given, the class's choice stays.
    setStudentPageSwitch(CID, true);
    expect(getReturnSettings(CID).return_grades).toBe('on_save');
    setStudentPageSwitch(CID, false);
    expect(getReturnSettings(CID).student_page).toBe(false);
    expect(getCourseConfig(CID).student_page_enabled).toBeUndefined();
  });

  it('a choice that is not one of the two works as no choice made', () => {
    seed({ student_page_enabled: true, return_grades: 'sometimes' });
    expect(getReturnSettings(CID).return_grades).toBe(null);
    seed({ student_page_enabled: 'yes', return_grades: 'on_return' });
    expect(getReturnSettings(CID).student_page).toBe(false);
  });

  describe('for a signed-in teacher', () => {
    const LIVE = U(1);
    let session;
    beforeEach(() => {
      seedClass(LIVE, {
        students: [{ id: U(11), firstName: 'Jordan', lastName: 'Test' }],
        assessments: [{ id: U(31), title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: [U(51)] }],
        // As if the two settings were on this device already.
        courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
      });
      session = signIn();
    });
    afterEach(() => {
      session.signOut();
      clearClass(LIVE);
    });

    it('reads off, keeps no row, and cannot be turned on by hand', async () => {
      expect(getReturnSettings(LIVE).student_page).toBe(false);
      expect(setStudentPageSwitch(LIVE, true)).toBe(false);
      upsertScore(LIVE, U(11), U(31), U(51), 3, '2026-10-10', 'summative', '', 0);
      await settle();
      expect(GradeState.stateOf(LIVE, U(11), U(31))).toBe('returned');
      expect(getGradeReturns(LIVE)).toEqual({});
      expect(localStorage.getItem('gb-grade-returns-' + LIVE)).toBe(null);
      expect(returnGrades(LIVE, U(31), [U(11)]).returned).toBe(0);
      // The score went up as it always has, and nothing else did.
      expect(session.sent().map(c => c[0])).toEqual(['upsert_tag_score']);
    });

    it('saveCourseConfig sends neither setting to the server', async () => {
      saveCourseConfig(
        LIVE,
        Object.assign({}, getCourseConfig(LIVE), { calcMethod: 'mostRecent', return_grades: 'on_save' }),
      );
      await settle();
      const sent = session.sent();
      expect(sent.map(c => c[0])).toEqual(['update_course']);
      expect(sent[0][1].p_patch).toEqual({ calc_method: 'mostRecent' });
      expect(JSON.stringify(sent)).not.toMatch(/student_page|return_grades/);
    });
  });
});

/* ── From the S0-F1 review ───────────────────────────────────── */

describe('"not loaded" is not "none"', () => {
  const LIVE = U(1);
  const HELD = { student_page: true, return_grades: 'on_return' };
  let session;
  let realSettings;

  beforeEach(() => {
    seedClass(LIVE, {
      students: [{ id: U(11), firstName: 'Jordan', lastName: 'Test' }],
      assessments: [{ id: U(31), title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: [U(51)] }],
      scores: {
        [U(11)]: [
          { id: 'e1', assessmentId: U(31), tagId: U(51), score: 3, date: '2026-10-10', type: 'summative', note: '' },
        ],
      },
    });
    session = signIn();
    realSettings = globalThis.getReturnSettings;
  });
  afterEach(() => {
    globalThis.getReturnSettings = realSettings;
    session.signOut();
    clearClass(LIVE);
  });

  it('a signed-in class that holds grades throws until its rows have loaded, then reads them', () => {
    // As S0-W1 will have it: the class's settings read as the server has them.
    globalThis.getReturnSettings = () => HELD;
    delete _gradeReturnsLoadedFor[LIVE];
    expect(() => getReturnedScores(LIVE)).toThrow(/has not loaded.*no draft is shown/);
    // And again: the failure is not remembered as an answer.
    expect(() => getReturnedScores(LIVE)).toThrow(/has not loaded/);
    // calc.js works out no grade.
    expect(() => withReturnedOnly(() => _scoreRead.scores(LIVE))).toThrow(/has not loaded/);
    // Loaded, and the class has none: every grade is returned.
    _loadGradeReturns(LIVE, {});
    expect(getReturnedScores(LIVE)).toBe(getScores(LIVE));
    // Loaded, with a draft never returned: it is not there.
    _loadGradeReturns(LIVE, { [U(31)]: { [U(11)]: { is_draft: true } } });
    expect(getReturnedScores(LIVE)).toEqual({ [U(11)]: [] });
    delete _gradeReturnsLoadedFor[LIVE];
  });

  it('a class that holds no grades has no draft by rule: the working copy, loaded or not', () => {
    [
      { student_page: false, return_grades: 'on_return' },
      { student_page: true, return_grades: 'on_save' },
      { student_page: true, return_grades: null },
    ].forEach(settings => {
      globalThis.getReturnSettings = () => settings;
      delete _returnedSets[LIVE];
      expect(getReturnedScores(LIVE)).toBe(getScores(LIVE));
    });
  });

  it('a class kept on this device always knows its rows: none saved is none', () => {
    session.signOut();
    try {
      held();
      expect(_cache.gradeReturns[CID]).toBeUndefined();
      expect(getReturnedScores(CID)).toBe(getScores(CID));
      level('s1', 'essay', 't1', 3);
      expect(getReturnedScores(CID).s1).toEqual([]);
    } finally {
      session = signIn();
    }
  });
});

describe('with real grade math', () => {
  const MATH = 'c-math';
  // Two pieces of the same date on one competency, and pair and group work.
  const FIRST = { id: 'first', title: 'First', date: '2026-10-10', type: 'summative', tagIds: ['q'] };
  const SECOND = { id: 'second', title: 'Second', date: '2026-10-10', type: 'summative', tagIds: ['q'] };
  const PAIR = {
    id: 'pair',
    title: 'Pair Talk',
    date: '2026-10-12',
    type: 'summative',
    tagIds: ['q'],
    collaboration: 'pair',
    pairs: [['s1', 's2']],
  };
  const GROUP = {
    id: 'group',
    title: 'Group Poster',
    date: '2026-10-13',
    type: 'summative',
    tagIds: ['q'],
    collaboration: 'group',
    groups: [['s1', 's2', 's3']],
  };
  const lvl = (sid, aid, value) => upsertScore(MATH, sid, aid, 'q', value, '', 'summative', '', 0);
  const all = sid => (clearProfCache(), getTagProficiency(MATH, sid, 'q'));
  const returned = sid => (clearProfCache(), withReturnedOnly(() => getTagProficiency(MATH, sid, 'q')));
  const method = name => saveCourseConfig(MATH, Object.assign({}, getCourseConfig(MATH), { calcMethod: name }));

  beforeEach(() => {
    localStorage.clear();
    seedClass(MATH, {
      students: STUDENTS,
      assessments: [FIRST, SECOND, PAIR, GROUP].map(a => structuredClone(a)),
      learningMaps: {
        subjects: [],
        sections: [{ id: 'sec', name: 'Question', tags: [{ id: 'q', label: 'Question', text: 'Ask questions' }] }],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
    });
  });
  afterEach(() => clearClass(MATH));

  it('a cleared returned grade keeps its place: a tie between two pieces of one date goes the way it did', () => {
    // 4 then 2, the same day, both returned.
    lvl('s1', 'first', 4);
    lvl('s1', 'second', 2);
    returnGrades(MATH, 'first', ['s1']);
    returnGrades(MATH, 'second', ['s1']);
    const before = {};
    const METHODS = ['mostRecent', 'decayingAvg', 'mode', 'average', 'highest'];
    METHODS.forEach(name => {
      method(name);
      before[name] = all('s1');
    });
    expect(before.mostRecent).toBe(2);
    // The 4 is cleared and the clear is not returned.
    saveScores(MATH, clearScoreEntries(MATH, getScores(MATH), 's1', FIRST, ['q']));
    expect(getScores(MATH).s1.map(e => e.assessmentId)).toEqual(['second']);
    // The returned 4 is back in the set, after the 2: calc.js puts the tie in the class's order.
    expect(getReturnedScores(MATH).s1.map(e => [e.assessmentId, e.score])).toEqual([
      ['second', 2],
      ['first', 4],
    ]);
    METHODS.forEach(name => {
      method(name);
      expect(returned('s1'), name).toBe(before[name]);
    });
    method('mostRecent');
    expect(returned('s1')).toBe(2);
    expect(all('s1')).toBe(2);
  });

  it.each([
    ['pair', PAIR, ['s1', 's2']],
    ['group', GROUP, ['s1', 's2', 's3']],
  ])(
    'Missing wins at once on %s work: one click, and the returned grade stops counting for that member',
    (_, work, members) => {
      // s1 has a 1 of their own; the group is graded 3 and it is returned.
      lvl('s1', 'first', 1);
      returnGrades(MATH, 'first', ['s1']);
      lvl('s1', work.id, 3);
      expect(members.map(sid => GradeState.stateOf(MATH, sid, work.id))).toEqual(members.map(() => 'draft'));
      returnGrades(MATH, work.id, members);
      const before = { all: members.map(all), returned: members.map(returned) };
      expect(before.returned).toEqual(before.all);
      expect(before.all[0]).toBe(2);

      // Missing on one member clears their copy of the group's grade.
      expect(setAssignmentStatus(MATH, 's1', work.id, 'NS')).toBe(true);
      expect(getScores(MATH).s1.filter(e => e.assessmentId === work.id)).toEqual([]);
      expect(getGradeReturn(MATH, 's1', work.id)).toMatchObject({ is_draft: true });
      // The teacher's number and the returned-only number agree at once.
      expect(all('s1')).toBe(1);
      expect(returned('s1')).toBe(1);
      expect(GradeState.stateOf(MATH, 's1', work.id)).toBe(null);
      // The others keep the group's returned grade.
      members.slice(1).forEach(sid => {
        expect(returned(sid)).toBe(3);
        expect(GradeState.stateOf(MATH, sid, work.id)).toBe('returned');
      });
      // Missing taken off: the group's grade is copied back, as it was returned.
      expect(setAssignmentStatus(MATH, 's1', work.id, null)).toBe(true);
      expect(members.map(all)).toEqual(before.all);
      expect(members.map(returned)).toEqual(before.returned);
      expect(GradeState.stateOf(MATH, 's1', work.id)).toBe('returned');
    },
  );

  it('Excused on a member of a pair: left out of both sets at once, and back when it is taken off', () => {
    lvl('s1', 'first', 1);
    returnGrades(MATH, 'first', ['s1']);
    lvl('s1', 'pair', 3);
    returnGrades(MATH, 'pair', ['s1', 's2']);
    expect(setAssignmentStatus(MATH, 's1', 'pair', 'EXC')).toBe(true);
    expect(all('s1')).toBe(1);
    expect(returned('s1')).toBe(1);
    expect(setAssignmentStatus(MATH, 's1', 'pair', null)).toBe(true);
    expect(returned('s1')).toBe(2);
    expect(all('s1')).toBe(2);
  });
});

/* calc.js takes from getReturnedScores only a plain object of
   { studentId: [entries] }, checked on every read (S0-F1b). */
describe('the returned set is always a plain object with a list for every student in it', () => {
  const plainSet = set =>
    Object.getPrototypeOf(set) === Object.prototype && Object.keys(set).every(sid => Array.isArray(set[sid]));

  it('with no draft, with drafts, and for a student whose every grade is a draft never returned', () => {
    held();
    expect(plainSet(getReturnedScores(CID))).toBe(true);
    level('s1', 'essay', 't1', 3);
    level('s1', 'lab', 'c1', 2);
    level('s2', 'essay', 't1', 3);
    give('essay', 's2');
    level('s2', 'essay', 't1', 4);
    const set = getReturnedScores(CID);
    expect(plainSet(set)).toBe(true);
    expect(set.s1).toEqual([]);
    expect(set.s2.map(e => e.score)).toEqual([3]);
    // A student with a row and no working entries at all still has a list.
    setPointsScore(CID, 's3', 'quiz', 7);
    give('quiz', 's3');
    setPointsScore(CID, 's3', 'quiz', null);
    delete getScores(CID).s3;
    delete _returnedSets[CID];
    expect(plainSet(getReturnedScores(CID))).toBe(true);
    expect(getReturnedScores(CID).s3.map(e => e.score)).toEqual([7, 7]);
  });

  it.each([
    ['a student with no list', () => ({ s1: null, s2: 'x', s3: [] })],
    ['a list where the class should be', () => []],
  ])('a damaged working copy (%s) is given as one, in a class with drafts and in one without', (_, damaged) => {
    [{}, { student_page_enabled: true, return_grades: 'on_return' }].forEach(config => {
      seed(config);
      level('s4', 'essay', 't1', 3);
      const rows = getGradeReturns(CID);
      _cache.scores[CID] = damaged();
      _rubricKeyedScores.set(_cache.scores[CID], _rubricsRev[CID] || 0);
      delete _returnedSets[CID];
      const set = getReturnedScores(CID);
      expect(plainSet(set)).toBe(true);
      if (!Array.isArray(_cache.scores[CID]))
        expect(Object.keys(set)).toEqual(expect.arrayContaining(['s1', 's2', 's3']));
      // Nothing of a draft comes back with it.
      expect(JSON.stringify(set)).not.toContain('"score":3');
      expect(getGradeReturns(CID)).toEqual(rows);
    });
  });
});

/* A returned copy from the server may hold an Overall level on competency
   work (score.value). It is in use only when the copy holds no competency
   or criterion row at all, and then it reads back under the first
   competency, as a loaded grade does. */
describe('an Overall level on competency work, in a returned copy', () => {
  const draftOn = copy => ({ is_draft: true, returned_at: '2026-11-03T17:00:00.000Z', returned_copy: copy });
  const back = () => getReturnedScores(CID).s1.map(e => [e.assessmentId, e.tagId, e.score, e.mod || 0]);

  beforeEach(() => {
    held();
    // The working copy since: a level under each competency.
    level('s1', 'essay', 't1', 1);
    level('s1', 'essay', 't2', 1);
  });
  const returnedAs = copy => {
    _cache.gradeReturns[CID] = { essay: { s1: draftOn(GradeState.copyOf(copy)) } };
    delete _returnedSets[CID];
  };

  it('alone, it is the returned grade, under the first competency', () => {
    returnedAs({ value: 3, modifier: 1 });
    expect(back()).toEqual([['essay', 't1', 3, 1]]);
  });

  it('beside a competency level, only the competency level is', () => {
    returnedAs({ value: 3, tags: { t2: { value: 2 } } });
    expect(back()).toEqual([['essay', 't2', 2, 0]]);
  });

  it('beside a row the work no longer uses, that row is read as the working copy would hold it', () => {
    // Grade math hides what a piece is no longer scored by the same way in both sets.
    returnedAs({ value: 3, tags: { gone: { value: 2 } } });
    expect(back()).toEqual([['essay', 'gone', 2, 0]]);
  });
});

/* ── From the independent review of this PR ──────────────────── */

describe('review: the returned set and real grade math', () => {
  const R = 'c-review';
  const ESSAY2 = { id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['ask', 'plan'] };
  const LAB2 = { id: 'lab', title: 'Lab', date: '2026-10-11', type: 'summative', tagIds: ['plan'] };
  const quiz = (id, title) => ({ id, title, date: '2026-10-12', scoreMode: 'points', maxPoints: 10, tagIds: ['ask'] });
  const QUIZ_A = quiz('qa', 'Quiz A');
  const QUIZ_B = quiz('qb', 'Quiz B');
  const QUIZ_C = quiz('qc', 'Quiz C');
  const QUIZ_D = quiz('qd', 'Quiz D');
  const lvl = (sid, aid, tid, value) => upsertScore(R, sid, aid, tid, value, '', 'summative', '', 0);
  const all = (sid, tid) => (clearProfCache(), getTagProficiency(R, sid, tid));
  const returned = (sid, tid) => (clearProfCache(), withReturnedOnly(() => getTagProficiency(R, sid, tid)));
  const method = name => saveCourseConfig(R, Object.assign({}, getCourseConfig(R), { calcMethod: name }));

  beforeEach(() => {
    localStorage.clear();
    seedClass(R, {
      students: STUDENTS,
      assessments: [ESSAY2, LAB2, QUIZ_A, QUIZ_B, QUIZ_C, QUIZ_D].map(a => structuredClone(a)),
      learningMaps: {
        subjects: [],
        sections: [
          { id: 'sec1', name: 'Ask', tags: [{ id: 'ask', label: 'Ask', text: 'Ask questions' }] },
          { id: 'sec2', name: 'Plan', tags: [{ id: 'plan', label: 'Plan', text: 'Plan a test' }] },
        ],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
    });
  });
  afterEach(() => clearClass(R));

  it('1. a draft on one competency never moves another’s level: the two sets agree at every step', () => {
    lvl('s1', 'essay', 'ask', 3);
    lvl('s1', 'essay', 'plan', 4);
    lvl('s1', 'lab', 'plan', 2);
    returnGrades(R, 'essay', ['s1']);
    returnGrades(R, 'lab', ['s1']);
    expect([all('s1', 'plan'), returned('s1', 'plan')]).toEqual([3, 3]);
    // Plan is taken off the Essay: only what a piece measures now counts, in both sets.
    saveAssessments(
      R,
      getAssessments(R).map(a => (a.id === 'essay' ? Object.assign({}, a, { tagIds: ['ask'] }) : a)),
    );
    expect([all('s1', 'plan'), returned('s1', 'plan')]).toEqual([2, 2]);
    lvl('s1', 'essay', 'ask', 2);
    expect(GradeState.stateOf(R, 's1', 'essay')).toBe('draft');
    // The returned copy still holds Plan 4; it is read as the working copy is.
    expect(getGradeReturn(R, 's1', 'essay').returned_copy.tags.plan.value).toBe(4);
    expect([all('s1', 'plan'), returned('s1', 'plan')]).toEqual([2, 2]);
    expect([all('s1', 'ask'), returned('s1', 'ask')]).toEqual([2, 3]);
    returnGrades(R, 'essay', ['s1']);
    expect([all('s1', 'plan'), returned('s1', 'plan')]).toEqual([2, 2]);
    expect(returned('s1', 'ask')).toBe(2);
  });

  /* Same-date pieces on one competency. calc.js counts them in the class's
     assignment-list order, so where a returned grade's entries sit in the
     set does not matter. Each sequence is run on the rows this device
     keeps, and again on rows shaped as the server sends them. */
  const METHODS = ['mostRecent', 'mode', 'decayingAvg', 'average', 'highest'];
  const numbers = read => Object.fromEntries(METHODS.map(name => (method(name), [name, read('s1', 'ask')])));
  const asServerSends = () => {
    const rows = {};
    Object.keys(getGradeReturns(R)).forEach(aid => {
      rows[aid] = {};
      Object.keys(getGradeReturns(R)[aid]).forEach(sid => {
        const row = JSON.parse(JSON.stringify(getGradeReturns(R)[aid][sid]));
        expect(
          Object.keys(row).filter(k => !/^(is_draft|returned_at|returned_copy|previous_copy|updated_at)$/.test(k)),
        ).toEqual([]);
        rows[aid][sid] = row;
      });
    });
    _saveGradeReturns(R, rows);
  };
  const QUIZZES = ['qa', 'qb', 'qc', 'qd'];
  const SEQUENCES = {
    'a quiz graded out of the class’s order, then cleared': () => {
      setPointsScore(R, 's1', 'qb', 10);
      setPointsScore(R, 's1', 'qa', 2);
      return () => setPointsScore(R, 's1', 'qa', null);
    },
    'a quiz cleared, then the next piece changed': () => {
      [3, 10, 6, 8].forEach((points, i) => setPointsScore(R, 's1', QUIZZES[i], points));
      return () => {
        setPointsScore(R, 's1', 'qb', null);
        setPointsScore(R, 's1', 'qc', 1);
      };
    },
    'two quizzes cleared in a row': () => {
      [3, 10, 6, 2].forEach((points, i) => setPointsScore(R, 's1', QUIZZES[i], points));
      return () => {
        setPointsScore(R, 's1', 'qc', null);
        setPointsScore(R, 's1', 'qd', null);
      };
    },
    'a quiz cleared and typed again, so its entry moves to the end': () => {
      [10, 2, 6].forEach((points, i) => setPointsScore(R, 's1', QUIZZES[i], points));
      return () => {
        setPointsScore(R, 's1', 'qa', null);
        setPointsScore(R, 's1', 'qa', 4);
      };
    },
  };
  describe.each(Object.keys(SEQUENCES))('2. %s', name => {
    it.each(['the rows this device keeps', 'rows as the server sends them'])(
      'returned-only is what it was, on %s',
      rows => {
        const change = SEQUENCES[name]();
        QUIZZES.forEach(aid => returnGrades(R, aid, ['s1']));
        const before = numbers(all);
        expect(numbers(returned)).toEqual(before);
        change();
        if (rows !== 'the rows this device keeps') asServerSends();
        expect(numbers(returned)).toEqual(before);
        expect(numbers(all)).not.toEqual(before);
        // Returned, both sets agree again.
        QUIZZES.forEach(aid => returnGrades(R, aid, ['s1']));
        expect(numbers(returned)).toEqual(numbers(all));
      },
    );
  });

  it('3. Missing or Excused on a scored piece with no draft: no level counts, in both sets', () => {
    lvl('s1', 'essay', 'ask', 4);
    lvl('s1', 'lab', 'plan', 2);
    lvl('s1', 'essay', 'plan', 4);
    returnGrades(R, 'essay', ['s1']);
    returnGrades(R, 'lab', ['s1']);
    ['NS', 'EXC'].forEach(status => {
      // Written past the app, which refuses Missing and Excused on scored work.
      saveAssignmentStatuses(R, { 's1:essay': status });
      expect(getGradeReturn(R, 's1', 'essay').is_draft).toBe(false);
      // The set is the working copy; calc.js is where the mark wins.
      expect(getReturnedScores(R)).toBe(getScores(R));
      expect([all('s1', 'plan'), returned('s1', 'plan')]).toEqual([2, 2]);
      expect([all('s1', 'ask'), returned('s1', 'ask')]).toEqual([0, 0]);
      // The mark taken off, the grade is back.
      saveAssignmentStatuses(R, {});
      expect([all('s1', 'plan'), returned('s1', 'plan')]).toEqual([3, 3]);
    });
  });

  it('3. a returned grade under a draft, with the piece Missing or Excused: no level counts, in both sets', () => {
    lvl('s1', 'essay', 'ask', 4);
    lvl('s1', 'lab', 'plan', 2);
    lvl('s1', 'essay', 'plan', 4);
    returnGrades(R, 'essay', ['s1']);
    returnGrades(R, 'lab', ['s1']);
    lvl('s1', 'essay', 'plan', 1);
    expect([all('s1', 'plan'), returned('s1', 'plan')]).toEqual([1.5, 3]);
    ['NS', 'EXC'].forEach(status => {
      saveAssignmentStatuses(R, { 's1:essay': status });
      expect([all('s1', 'plan'), returned('s1', 'plan')]).toEqual([2, 2]);
      expect([all('s1', 'ask'), returned('s1', 'ask')]).toEqual([0, 0]);
      saveAssignmentStatuses(R, {});
      expect([all('s1', 'plan'), returned('s1', 'plan')]).toEqual([1.5, 3]);
    });
  });
});

describe('review: a save is never broken or reordered by the rule', () => {
  let real;
  let reported;
  let sentry;
  beforeEach(() => {
    real = {};
    reported = [];
    sentry = window.Sentry;
    window.Sentry = { captureException: e => reported.push(e) };
  });
  afterEach(() => {
    Object.keys(real).forEach(name => (GradeState[name] = real[name]));
    window.Sentry = sentry;
  });
  const breakRule = names =>
    names.forEach(name => {
      real[name] = GradeState[name];
      GradeState[name] = () => {
        throw new Error('the rule broke: ' + name);
      };
    });
  const everything = () => Object.keys(GradeState).filter(name => typeof GradeState[name] === 'function');

  it('with the rule throwing, every save still lands in the cache and the saved copy, and the failure is reported', () => {
    held();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      breakRule(everything());
      expect(level('s1', 'essay', 't1', 3)).toBe(true);
      saveScoreComment(CID, 's1', 'essay', 'Careful work.');
      saveTagComment(CID, 's1', 'essay', 't1', 'Say why');
      saveRubricCriterionComment(CID, 's1', 'lab', 'c1', 'Number the steps');
      setRubricCheck(CID, 's1', 'lab', 'k1', true);
      setPointsScore(CID, 's1', 'quiz', 7);
    } finally {
      quiet.mockRestore();
    }
    const saved = JSON.parse(localStorage.getItem('gb-scores-' + CID));
    expect(saved).toEqual(getScores(CID));
    expect(saved.s1.map(e => [e.assessmentId, e.tagId, e.score])).toEqual(
      expect.arrayContaining([
        ['essay', 't1', 3],
        ['quiz', 't1', 7],
      ]),
    );
    expect(JSON.parse(localStorage.getItem('gb-rubric-checks-' + CID))).toEqual({ 's1:lab': ['k1'] });
    expect(reported.length).toBeGreaterThanOrEqual(6);
    expect(String(reported[0])).toMatch(/the rule broke/);
  });

  it('with the switch off no save touches GradeState at all, class settings included', async () => {
    const LIVE = U(1);
    seedClass(LIVE, {
      students: [{ id: U(11), firstName: 'Jordan', lastName: 'Test' }],
      assessments: [{ id: U(31), title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: [U(51)] }],
    });
    const session = signIn();
    try {
      // As a stale cached grade-state.js beside a new data.js would be.
      breakRule(everything());
      upsertScore(LIVE, U(11), U(31), U(51), 3, '2026-10-10', 'summative', '', 0);
      saveScores(LIVE, getScores(LIVE));
      saveCourseConfig(LIVE, Object.assign({}, getCourseConfig(LIVE), { calcMethod: 'mostRecent' }));
      await settle();
      expect(session.sent().map(c => c[0])).toEqual(['upsert_tag_score', 'update_course']);
      expect(JSON.parse(localStorage.getItem('gb-courseconfig-' + LIVE)).calcMethod).toBe('mostRecent');
      expect(reported).toEqual([]);
    } finally {
      session.signOut();
      clearClass(LIVE);
    }
    // And on this device, with the switch off.
    seed();
    level('s1', 'essay', 't1', 3);
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { calcMethod: 'mostRecent' }));
    expect(reported).toEqual([]);
  });

  it('a class leaving When I Return Them with the rule throwing still saves its settings', () => {
    held();
    level('s1', 'essay', 't1', 3);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      breakRule(['afterSettingChange']);
      setStudentPageSwitch(CID, true, 'on_save');
    } finally {
      quiet.mockRestore();
    }
    expect(getCourseConfig(CID).return_grades).toBe('on_save');
    expect(JSON.parse(localStorage.getItem('gb-courseconfig-' + CID)).return_grades).toBe('on_save');
    expect(reported.length).toBe(1);
  });
});

describe('review: rows from the server, and leftovers', () => {
  const LIVE = U(1);
  const HELD = { student_page: true, return_grades: 'on_return' };
  let session;
  let realSettings;
  beforeEach(() => {
    seedClass(LIVE, {
      students: [{ id: U(11), firstName: 'Jordan', lastName: 'Test' }],
      assessments: [{ id: U(31), title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: [U(51)] }],
      scores: {
        [U(11)]: [
          { id: 'e1', assessmentId: U(31), tagId: U(51), score: 3, date: '2026-10-10', type: 'summative', note: '' },
        ],
      },
    });
    session = signIn();
    realSettings = globalThis.getReturnSettings;
    delete _gradeReturnsLoadedFor[LIVE];
  });
  afterEach(() => {
    globalThis.getReturnSettings = realSettings;
    session.signOut();
    clearClass(LIVE);
    delete _gradeReturnsLoadedFor[LIVE];
  });

  it('5. only a real load makes a signed-in class’s rows loaded: a row saved or read on the device does not', () => {
    globalThis.getReturnSettings = () => HELD;
    // A row read from a saved copy.
    localStorage.setItem('gb-grade-returns-' + LIVE, JSON.stringify({ [U(31)]: { [U(11)]: { is_draft: false } } }));
    expect(getGradeReturn(LIVE, U(11), U(31))).toEqual({ is_draft: false });
    expect(() => getReturnedScores(LIVE)).toThrow(/has not loaded/);
    // A row saved on the device.
    _saveGradeReturns(LIVE, { [U(31)]: { [U(11)]: { is_draft: false, returned_at: '2026-11-03T17:00:00.000Z' } } });
    expect(() => getReturnedScores(LIVE)).toThrow(/has not loaded/);
    // The load: the one way in. It drops what was built and the cached numbers.
    const realClear = globalThis.clearProfCache;
    let cleared = 0;
    globalThis.clearProfCache = () => (cleared++, realClear());
    try {
      _loadGradeReturns(LIVE, {});
      expect(cleared).toBe(1);
      expect(getReturnedScores(LIVE)).toBe(getScores(LIVE));
      _loadGradeReturns(LIVE, { [U(31)]: { [U(11)]: { is_draft: true } } });
      expect(cleared).toBe(2);
      expect(getReturnedScores(LIVE)).toEqual({ [U(11)]: [] });
      expect(JSON.parse(localStorage.getItem('gb-grade-returns-' + LIVE))[U(31)][U(11)].is_draft).toBe(true);
      // Something not a set of rows is none.
      _loadGradeReturns(LIVE, null);
      expect(getGradeReturns(LIVE)).toEqual({});
    } finally {
      globalThis.clearProfCache = realClear;
    }
  });

  it('5. rows loaded through the setter change the returned-only number calc.js had cached', () => {
    session.signOut();
    try {
      const M = 'c-loaded';
      seedClass(M, {
        students: STUDENTS,
        assessments: [{ id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['ask'] }],
        learningMaps: {
          subjects: [],
          sections: [{ id: 'sec1', name: 'Ask', tags: [{ id: 'ask', label: 'Ask', text: 'Ask questions' }] }],
          _customized: true,
          _version: 1,
          _flatVersion: 2,
        },
        scores: {
          s1: [
            {
              id: 'e1',
              assessmentId: 'essay',
              tagId: 'ask',
              score: 3,
              date: '2026-10-10',
              type: 'summative',
              note: '',
            },
          ],
        },
        courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
      });
      // No cache clear between the reads: only the setter's own.
      const read = () => withReturnedOnly(() => getTagProficiency(M, 's1', 'ask'));
      clearProfCache();
      expect(read()).toBe(3);
      _loadGradeReturns(M, { essay: { s1: { is_draft: true } } });
      expect(read()).toBe(0);
      _loadGradeReturns(M, {});
      expect(read()).toBe(3);
      clearClass(M);
    } finally {
      session = signIn();
    }
  });

  it('5. the returned set is built again when the rows change under it', () => {
    globalThis.getReturnSettings = () => HELD;
    _loadGradeReturns(LIVE, {});
    const first = getReturnedScores(LIVE);
    expect(first).toBe(getScores(LIVE));
    // Rows put straight into the cache, with no setter and no save.
    _cache.gradeReturns[LIVE] = { [U(31)]: { [U(11)]: { is_draft: true } } };
    expect(getReturnedScores(LIVE)).toEqual({ [U(11)]: [] });
    _cache.gradeReturns[LIVE] = {};
    expect(getReturnedScores(LIVE)).toBe(getScores(LIVE));
  });

  it('8. Return is refused in a class that does not hold grades, whatever rows are on the device', () => {
    localStorage.setItem('gb-grade-returns-' + LIVE, JSON.stringify({ [U(31)]: { [U(11)]: { is_draft: true } } }));
    const before = localStorage.getItem('gb-grade-returns-' + LIVE);
    expect(returnGrades(LIVE, U(31), [U(11)])).toEqual({ returned: 0, enrollment_ids: [], returned_at: null });
    expect(localStorage.getItem('gb-grade-returns-' + LIVE)).toBe(before);
    // As Soon As I Save, on this device: the same.
    session.signOut();
    try {
      seed({ student_page_enabled: true, return_grades: 'on_save' });
      level('s1', 'essay', 't1', 3);
      expect(returnGrades(CID, 'essay', ['s1']).returned).toBe(0);
    } finally {
      session = signIn();
    }
  });

  it('8. a withdrawn student deleted for good takes their rows; a Note for the Report reaches the returned set', () => {
    session.signOut();
    try {
      held();
      level('s1', 'essay', 't1', 3);
      level('s2', 'essay', 't1', 3);
      give('essay', 's1');
      level('s1', 'essay', 't1', 4);
      expect(getReturnedScores(CID).s1[0].reportNote).toBeUndefined();
      saveScoreReportNote(CID, 's2', 'essay', 'explained her method');
      saveScoreReportNote(CID, 's1', 'essay', 'linked two sources');
      // s2's draft is not there; s1's returned grade is, and the set was built again.
      expect(getReturnedScores(CID).s2).toEqual([]);
      expect(getReturnedScores(CID).s1.map(e => e.score)).toEqual([3]);
      expect(withdrawStudent(CID, 's1')).toBeTruthy();
      expect(getGradeReturn(CID, 's1', 'essay')).not.toBe(null);
      expect(deleteWithdrawnStudent(CID, 's1')).toBe(true);
      expect(getGradeReturn(CID, 's1', 'essay')).toBe(null);
      expect(JSON.parse(storedRows()).essay.s1).toBeUndefined();
      expect(getGradeReturn(CID, 's2', 'essay')).toEqual({ is_draft: true });
    } finally {
      session = signIn();
    }
  });

  it('8. another tab’s Return makes this one read the class again', () => {
    expect(_isGradebookField('gradeReturns')).toBe(true);
  });
});

describe('review: a tick is part of a grade for the state a screen shows', () => {
  it('work with only ticks, and a cleared grade whose ticks remain, are Returned once returned', () => {
    held();
    setRubricCheck(CID, 's1', 'lab', 'k1', true);
    expect(state('s1', 'lab')).toBe('draft');
    give('lab', 's1');
    expect(state('s1', 'lab')).toBe('returned');
    level('s2', 'lab', 'c1', 3);
    setRubricCheck(CID, 's2', 'lab', 'k1', true);
    give('lab', 's2');
    saveScores(CID, clearScoreEntries(CID, getScores(CID), 's2', LAB, ['c1', 'c2']));
    give('lab', 's2');
    expect(row('s2', 'lab')).toMatchObject({ is_draft: false });
    expect(state('s2', 'lab')).toBe('returned');
  });
});
