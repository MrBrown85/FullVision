/**
 * shared/grader.js and shared/grade-state.js as they start (S0-T2): every
 * Grader action is a pass-through to one writer in shared/data.js, with the
 * arguments the grader dialog passed before, and gives back what the writer
 * gives back; GradeState calls every save Returned and keeps nothing.
 *
 * What the actions end up writing and sending is pinned from the dialog
 * itself (tests/pin-grader-dialog-writes.test.js and
 * tests/pin-grader-dialog-dibels-groups.test.js). This holds the wiring:
 * which writer, which arguments, what comes back.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'grader-pass';
const ESSAY = { id: 'essay', title: 'Essay', tagIds: ['t1'], date: '2026-10-10', type: 'summative' };
const UNDATED = { id: 'undated', title: 'Journal', tagIds: ['t1'] };

/* Stands in for one data.js writer: records its arguments and answers
   `answer`. */
function standIn(name, answer) {
  const real = globalThis[name];
  const calls = [];
  globalThis[name] = function () {
    calls.push(Array.from(arguments));
    return answer;
  };
  return { calls, restore: () => (globalThis[name] = real) };
}

describe('Grader: each action passes through to one data.js writer', () => {
  let stand = null;
  let heard = null;
  let realAfterSave = null;

  beforeEach(() => {
    saveAssessments(CID, [ESSAY, UNDATED]);
    heard = [];
    realAfterSave = GradeState.afterSave;
    GradeState.afterSave = function () {
      heard.push(Array.from(arguments));
      return realAfterSave.apply(null, arguments);
    };
  });
  afterEach(() => {
    if (stand) stand.restore();
    stand = null;
    GradeState.afterSave = realAfterSave;
  });

  const ANSWER = { from: 'the writer' };
  const cases = [
    // [action, its arguments, the writer, the writer's arguments, what GradeState hears]
    [
      'setLevel',
      [CID, 's1', 'essay', 't1', 3, 0],
      'upsertScore',
      [CID, 's1', 'essay', 't1', 3, '2026-10-10', 'summative', '', 0],
      [CID, 's1', 'essay', 'level'],
    ],
    [
      'setPlusMinus',
      [CID, 's1', 'essay', 't1', 3, -1],
      'upsertScore',
      [CID, 's1', 'essay', 't1', 3, '2026-10-10', 'summative', '', -1],
      [CID, 's1', 'essay', 'plusMinus'],
    ],
    ['setPoints', [CID, 's1', 'quiz', 7.5], 'setPointsScore', [CID, 's1', 'quiz', 7.5], [CID, 's1', 'quiz', 'points']],
    [
      'setPoints',
      [CID, 's1', 'quiz', null],
      'setPointsScore',
      [CID, 's1', 'quiz', null],
      [CID, 's1', 'quiz', 'points'],
    ],
    [
      'setMark',
      [CID, 's1', 'exit', 'complete'],
      'setCompletionMark',
      [CID, 's1', 'exit', 'complete'],
      [CID, 's1', 'exit', 'mark'],
    ],
    [
      'setStatus',
      [CID, 's1', 'essay', 'NS'],
      'applyAssignmentStatus',
      [CID, 's1', 'essay', 'NS'],
      [CID, 's1', 'essay', 'status'],
    ],
    [
      'setTick',
      [CID, 's1', 'lab', 'check1', true],
      'setRubricCheck',
      [CID, 's1', 'lab', 'check1', true],
      [CID, 's1', 'lab', 'tick'],
    ],
    [
      'setCriterionComment',
      [CID, 's1', 'lab', 'crit1', 'Label the axes'],
      'saveRubricCriterionComment',
      [CID, 's1', 'lab', 'crit1', 'Label the axes'],
      [CID, 's1', 'lab', 'comment'],
    ],
    [
      'setWentBeyond',
      [CID, 's1', 'claim', 'crit1', 'Cited two sources'],
      'saveRubricCriterionBeyond',
      [CID, 's1', 'claim', 'crit1', 'Cited two sources'],
      [CID, 's1', 'claim', 'comment'],
    ],
    [
      'setCompetencyComment',
      [CID, 's1', 'essay', 't1', 'A sharp question'],
      'saveTagComment',
      [CID, 's1', 'essay', 't1', 'A sharp question'],
      [CID, 's1', 'essay', 'comment'],
    ],
    [
      'setOverallComment',
      [CID, 's1', 'essay', 'Solid work.'],
      'saveScoreComment',
      [CID, 's1', 'essay', 'Solid work.'],
      [CID, 's1', 'essay', 'comment'],
    ],
    [
      'setDibels',
      [CID, 's1', 'reading', 'moy', { orfWrc: 112 }],
      'saveDibelsScore',
      [CID, 's1', 'reading', 'moy', { orfWrc: 112 }],
      [CID, 's1', 'reading', 'dibels'],
    ],
    [
      'gradeSeparately',
      [CID, 'talk', 's1'],
      'setGradedSeparately',
      [CID, 'talk', 's1', true],
      [CID, 's1', 'talk', 'gradeSeparately'],
    ],
    [
      'backToGroupGrade',
      [CID, 'talk', 's1'],
      'setGradedSeparately',
      [CID, 'talk', 's1', false],
      [CID, 's1', 'talk', 'backToGroupGrade'],
    ],
    // The phone's Grade tab (S1-T2). More on these three below.
    [
      'setLevelOnPhone',
      [CID, 's1', 'essay', 't1', 3, 0],
      'upsertScore',
      [CID, 's1', 'essay', 't1', 3, '2026-10-10', 'summative', '', 0],
      [CID, 's1', 'essay', 'level'],
    ],
    [
      'setPlusMinusOnPhone',
      [CID, 's1', 'essay', 't1', 3, -1, 'Clear thesis'],
      'upsertScore',
      [CID, 's1', 'essay', 't1', 3, '2026-10-10', 'summative', 'Clear thesis', -1],
      [CID, 's1', 'essay', 'plusMinus'],
    ],
    ['undoOnPhone', [CID, 's1', 'essay', { s1: [] }], 'saveScores', [CID, { s1: [] }], [CID, 's1', 'essay', 'undo']],
    [
      'undo',
      [CID, { s1: [] }, { s1: [{ score: 3 }] }],
      'restoreScoreCells',
      [CID, { s1: [] }, { s1: [{ score: 3 }] }],
      [CID, null, null, 'undo'],
    ],
  ];

  it.each(cases)('%s%j', (action, args, writer, writerArgs, heardArgs) => {
    stand = standIn(writer, ANSWER);
    const out = Grader[action].apply(null, args);
    expect(stand.calls).toEqual([writerArgs]);
    expect(out).toBe(ANSWER);
    // GradeState hears of it once, after the writer has run.
    expect(heard).toEqual([heardArgs]);
  });

  it('covers every action Grader has', () => {
    expect(Object.keys(Grader).sort()).toEqual([...new Set(cases.map(c => c[0]))].sort());
  });

  it('a level with no + or − given passes none on, as a tick’s suggested level does', () => {
    stand = standIn('upsertScore', true);
    Grader.setLevel(CID, 's1', 'essay', 't1', 3);
    expect(stand.calls).toEqual([[CID, 's1', 'essay', 't1', 3, '2026-10-10', 'summative', '', undefined]]);
  });

  it('a level on work with no date, or on work that is gone, passes no date on: data.js picks the day', () => {
    stand = standIn('upsertScore', true);
    Grader.setLevel(CID, 's1', 'undated', 't1', 2, 0);
    Grader.setLevel(CID, 's1', 'gone', 't1', 2, 0);
    expect(stand.calls).toEqual([
      [CID, 's1', 'undated', 't1', 2, undefined, 'formative', '', 0],
      [CID, 's1', 'gone', 't1', 2, '', 'summative', '', 0],
    ]);
  });

  it('with the real writers, a level, its − and a clear land as the dialog’s did', () => {
    saveScores(CID, {});
    expect(Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0)).toBe(true);
    Grader.setPlusMinus(CID, 's1', 'essay', 't1', 3, -1);
    expect(getScores(CID).s1.map(e => [e.id, e.score, e.mod, e.date, e.type])).toEqual([
      ['s1:essay:t1', 3, -1, '2026-10-10', 'summative'],
    ]);
    Grader.setLevel(CID, 's1', 'essay', 't1', 0, 0);
    expect(getScores(CID).s1.map(e => [e.score, e.mod])).toEqual([[0, undefined]]);
  });
});

/* The phone's Grade tab (S1-T2): its levels and its Undo have actions of
   their own, which pass data.js what the phone passed before the move.
   What they end up saving and sending is pinned from the screen
   (tests/pin-phone-grade-writes.test.js). */
describe('Grader: the phone’s level and Undo actions', () => {
  let stands = [];
  const stand = (name, answer) => {
    const s = standIn(name, answer);
    stands.push(s);
    return s;
  };
  beforeEach(() => saveAssessments(CID, [ESSAY, UNDATED]));
  afterEach(() => {
    stands.forEach(s => s.restore());
    stands = [];
  });

  it('a level with no + or − given passes none on, and no comment', () => {
    const upsert = stand('upsertScore', true);
    Grader.setLevelOnPhone(CID, 's1', 'essay', 't1', 3);
    expect(upsert.calls).toEqual([[CID, 's1', 'essay', 't1', 3, '2026-10-10', 'summative', '', undefined]]);
  });

  it('on work with no date, or on work that is gone, a level and a + or − are dated today', () => {
    const upsert = stand('upsertScore', true);
    const today = courseToday(CID);
    Grader.setLevelOnPhone(CID, 's1', 'undated', 't1', 2, 0);
    Grader.setPlusMinusOnPhone(CID, 's1', 'undated', 't1', 2, 1, '');
    Grader.setLevelOnPhone(CID, 's1', 'gone', 't1', 2, 0);
    expect(upsert.calls).toEqual([
      [CID, 's1', 'undated', 't1', 2, today, 'formative', '', 0],
      [CID, 's1', 'undated', 't1', 2, today, 'formative', '', 1],
      [CID, 's1', 'gone', 't1', 2, today, 'summative', '', 0],
    ]);
  });

  it('with the real writer, a changed level on undated work moves the entry’s date to today', () => {
    saveScores(CID, {
      s1: [
        { id: 's1:undated:t1', assessmentId: 'undated', tagId: 't1', score: 2, date: '2026-09-01', type: 'formative' },
      ],
    });
    Grader.setLevelOnPhone(CID, 's1', 'undated', 't1', 3);
    expect(getScores(CID).s1.map(e => [e.score, e.date])).toEqual([[3, courseToday(CID)]]);
    // The desktop's action leaves the date alone.
    Grader.setLevel(CID, 's1', 'undated', 't1', 4, 0);
    getScores(CID).s1[0].date = '2026-09-01';
    Grader.setLevel(CID, 's1', 'undated', 't1', 2, 0);
    expect(getScores(CID).s1.map(e => [e.score, e.date])).toEqual([[2, '2026-09-01']]);
  });

  it('Undo saves the list, which sends what changed, and sends nothing more itself', () => {
    const scores = { s1: [] };
    const save = stand('saveScores', 'saved');
    const send = stand('persistScoreDiffToCanonical', undefined);
    expect(Grader.undoOnPhone(CID, 's1', 'essay', scores)).toBe('saved');
    expect(save.calls).toEqual([[CID, scores]]);
    expect(send.calls).toEqual([]);
  });
});

describe('GradeState: every save is returned at once', () => {
  beforeEach(() => {
    saveAssessments(CID, [ESSAY]);
    saveScores(CID, {});
    saveAssignmentStatuses(CID, {});
  });

  it('afterSave answers Returned for any kind of save and stores nothing', () => {
    const before = JSON.stringify(localStorage);
    ['level', 'plusMinus', 'points', 'mark', 'status', 'tick', 'comment', 'dibels', 'undo'].forEach(what => {
      expect(GradeState.afterSave(CID, 's1', 'essay', what)).toBe(GradeState.RETURNED);
    });
    expect(JSON.stringify(localStorage)).toBe(before);
  });

  it('stateOf names a piece Returned once it has a score or feedback, and nothing before', () => {
    expect(GradeState.stateOf(CID, 's1', 'essay')).toBe(null);
    Grader.setLevel(CID, 's1', 'essay', 't1', 3, 0);
    expect(GradeState.stateOf(CID, 's1', 'essay')).toBe('returned');
    expect(GradeState.stateOf(CID, 's2', 'essay')).toBe(null);
    Grader.setOverallComment(CID, 's2', 'essay', 'See me');
    expect(GradeState.stateOf(CID, 's2', 'essay')).toBe('returned');
  });

  it('a status alone is not a grade: Missing work has no state', () => {
    Grader.setStatus(CID, 's3', 'essay', 'EXC');
    expect(getAssignmentStatus(CID, 's3', 'essay')).toBe('EXC');
    expect(GradeState.stateOf(CID, 's3', 'essay')).toBe(null);
  });
});
