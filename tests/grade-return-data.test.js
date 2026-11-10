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
    expect(row('s1', 'essay')).toEqual({
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
    expect(row('s1', 'essay')).toEqual({ is_draft: true, returned_copy: three });
  });

  it('Grader.returnGrades returns them and reports the state', () => {
    Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
    expect(Grader.lastState()).toEqual({ cid: CID, sid: 's1', aid: 'essay', what: 'level', state: 'draft' });
    expect(Grader.returnGrades(CID, 'essay', 's1').returned).toBe(1);
    expect(Grader.lastState()).toEqual({ cid: CID, sid: 's1', aid: 'essay', what: 'return', state: 'returned' });
    // A status is never a draft: Missing work has no state.
    Grader.setStatus(CID, 's2', 'essay', 'NS');
    expect(Grader.lastState().state).toBe(null);
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
    // The returned set holds nothing for the piece while it is Missing.
    expect(getReturnedScores(CID).s1.filter(e => e.assessmentId === 'essay')).toEqual([]);
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
    expect(_cache.gradeReturns[LIVE]).toBeUndefined();
    expect(() => getReturnedScores(LIVE)).toThrow(/has not loaded.*no draft is shown/);
    // And again: the failure is not remembered as an answer.
    expect(() => getReturnedScores(LIVE)).toThrow(/has not loaded/);
    // calc.js works out no grade.
    expect(() => withReturnedOnly(() => getScoreComment(LIVE, U(11), U(31)) + _scoreRead.scores(LIVE))).toThrow(
      /has not loaded/,
    );
    // Loaded, and the class has none: every grade is returned.
    _cache.gradeReturns[LIVE] = {};
    expect(getReturnedScores(LIVE)).toBe(getScores(LIVE));
    // Loaded, with a draft never returned: it is not there.
    _cache.gradeReturns[LIVE] = { [U(31)]: { [U(11)]: { is_draft: true } } };
    delete _returnedSets[LIVE];
    expect(getReturnedScores(LIVE)).toEqual({ [U(11)]: [] });
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
    expect(getReturnedScores(MATH).s1.map(e => [e.assessmentId, e.score])).toEqual([
      ['first', 4],
      ['second', 2],
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
