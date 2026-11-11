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

/* ── S1-T1: the gradebook's and Class Results' actions ──────────────────
   The same check for the actions the gradebook and Class Results brought
   (shared/grader.js, "The gradebook and Class Results"). Some call two
   writers, so a row lists them in order:
   [action, its arguments, [[writer, its arguments], …], what GradeState
   hears]. The action gives back the answer of the writer marked `true`.
   What they end up saving and sending is pinned from the gradebook itself
   (tests/pin-gradebook-writes.test.js). */
const LAB = { id: 'lab', title: 'Lab', tagIds: ['t1'] };
const BEFORE = { s1: [{ assessmentId: 'lab', tagId: 't1', score: 3 }] };
const AFTER = { s1: [] };
const STATUSES = { 's2:lab': 'NS' };
const GRADEBOOK_CASES = [
  [
    'typeLevel',
    [CID, 's1', 'essay', 't1', 3, '2026-11-09', 'summative', ''],
    [['upsertScore', [CID, 's1', 'essay', 't1', 3, '2026-11-09', 'summative', ''], true]],
    [CID, 's1', 'essay', 'level'],
  ],
  [
    // A cleared cell, with no date given.
    'typeLevel',
    [CID, 's1', 'essay', 't1', 0, undefined, 'formative', ''],
    [['upsertScore', [CID, 's1', 'essay', 't1', 0, undefined, 'formative', ''], true]],
    [CID, 's1', 'essay', 'level'],
  ],
  [
    'typePlusMinus',
    [CID, 's1', 'essay', 't1', 3, '2026-10-10', 'summative', 'Solid work.', -1],
    [['upsertScore', [CID, 's1', 'essay', 't1', 3, '2026-10-10', 'summative', 'Solid work.', -1], true]],
    [CID, 's1', 'essay', 'plusMinus'],
  ],
  [
    'clearScore',
    [CID, BEFORE, 's1', LAB, ['t1']],
    [
      ['clearScoreEntries', [CID, BEFORE, 's1', LAB, ['t1']]],
      ['saveScores', [CID, BEFORE], true],
    ],
    [CID, 's1', 'lab', 'clear'],
  ],
  ['clearScoreOnServer', [CID, 's1', 'lab'], [['clearScore', ['s1', 'lab'], true]], [CID, 's1', 'lab', 'clear']],
  [
    'undoCell',
    [CID, 's1', 'lab', BEFORE, AFTER],
    [
      ['saveScores', [CID, AFTER], true],
      ['persistScoreDiffToCanonical', [CID, BEFORE, AFTER]],
    ],
    [CID, 's1', 'lab', 'undo'],
  ],
  [
    'markBlankCells',
    [CID, 'lab', STATUSES],
    [['saveAssignmentStatuses', [CID, STATUSES], true]],
    [CID, null, 'lab', 'status'],
  ],
  [
    'undoMarkBlankCells',
    [CID, 'lab', STATUSES],
    [['saveAssignmentStatuses', [CID, STATUSES], true]],
    [CID, null, 'lab', 'undo'],
  ],
  ['deleteAssessmentScores', [CID, 'lab', AFTER], [['saveScores', [CID, AFTER], true]], [CID, null, 'lab', 'delete']],
  [
    'deleteAssessmentStatuses',
    [CID, 'lab', STATUSES],
    [['saveAssignmentStatuses', [CID, STATUSES], true]],
    [CID, null, 'lab', 'delete'],
  ],
];

describe('Grader: the gradebook’s and Class Results’ actions pass through to data.js', () => {
  const ANSWER = { from: 'the writer' };
  let stands = [];
  let realAfterSave = null;

  afterEach(() => {
    stands.forEach(s => s.restore());
    stands = [];
    if (realAfterSave) GradeState.afterSave = realAfterSave;
    realAfterSave = null;
  });

  it.each(GRADEBOOK_CASES)('%s%j', (action, args, writers, heardArgs) => {
    // One list for the writers and GradeState, to hold their order.
    const log = [];
    writers.forEach(([name, , answers]) => {
      const real = globalThis[name];
      globalThis[name] = function () {
        log.push([name, Array.from(arguments)]);
        return answers ? ANSWER : { from: 'another writer' };
      };
      stands.push({ restore: () => (globalThis[name] = real) });
    });
    realAfterSave = GradeState.afterSave;
    GradeState.afterSave = function () {
      log.push(['GradeState.afterSave', Array.from(arguments)]);
      return realAfterSave.apply(null, arguments);
    };

    const out = Grader[action].apply(null, args);

    // The writers in order, with the very lists the screen passed, and
    // GradeState told once, after them.
    expect(log.map(row => row[0])).toEqual(writers.map(w => w[0]).concat('GradeState.afterSave'));
    writers.forEach(([, writerArgs], i) => {
      expect(log[i][1]).toEqual(writerArgs);
      log[i][1].forEach(arg => {
        if (arg && typeof arg === 'object') expect(args.includes(arg)).toBe(true);
      });
    });
    expect(log[log.length - 1][1]).toEqual(heardArgs);
    expect(out).toBe(ANSWER);
  });

  it('with the real writers, Clear Score keeps the Overall Comment and Undo puts the level back', () => {
    saveAssessments(CID, [LAB]);
    saveScores(CID, {});
    Grader.typeLevel(CID, 's1', 'lab', 't1', 3, '2026-10-10', 'summative', '');
    Grader.setOverallComment(CID, 's1', 'lab', 'Solid work.');
    const before = structuredClone(getScores(CID));

    const scores = getScores(CID);
    Grader.clearScore(CID, scores, 's1', LAB, ['t1']);
    expect(getScores(CID).s1.map(e => [e.score, e.note])).toEqual([[0, 'Solid work.']]);

    const cleared = structuredClone(getScores(CID));
    Grader.undoCell(CID, 's1', 'lab', cleared, before);
    expect(getScores(CID).s1.map(e => [e.score, e.note])).toEqual([[3, 'Solid work.']]);
  });

  it('with the real writers, Mark Blank Cells and its undo save the status list', () => {
    saveAssignmentStatuses(CID, {});
    expect(Grader.markBlankCells(CID, 'lab', { 's2:lab': 'NS' })).toBe(true);
    expect(getAssignmentStatus(CID, 's2', 'lab')).toBe('NS');
    expect(Grader.undoMarkBlankCells(CID, 'lab', {})).toBe(true);
    expect(getAssignmentStatus(CID, 's2', 'lab')).toBe(null);
  });
});

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
    // The Assignments page (S1-T3).
    [
      'undoMissing',
      [CID, 's1', 'essay'],
      'setAssignmentStatus',
      [CID, 's1', 'essay', null],
      [CID, 's1', 'essay', 'undo'],
    ],
    [
      // The Overall entry's own date and type, and no comment.
      'carryOverall',
      [CID, 's1', 'essay', 't1', { score: 3, mod: 1, date: '2026-10-08', type: 'formative', note: 'Thoughtful' }],
      'upsertScore',
      [CID, 's1', 'essay', 't1', 3, '2026-10-08', 'formative', '', 1],
      [CID, 's1', 'essay', 'level'],
    ],
    [
      'moveToRubric',
      [CID, 'lab', { rubricId: 'rub2', criteria: { c1: 'c1b' }, checks: { k1: 'k1b' } }],
      'moveRubricScores',
      [CID, 'lab', { rubricId: 'rub2', criteria: { c1: 'c1b' }, checks: { k1: 'k1b' } }],
      [CID, null, 'lab', 'move'],
    ],
    [
      'setReportNote',
      [CID, 's1', 'essay', ' explained her   method '],
      'saveScoreReportNote',
      [CID, 's1', 'essay', ' explained her   method '],
      [CID, 's1', 'essay', 'reportNote'],
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
    [
      'undoOnPhone',
      [CID, 's1', 'essay', { s1: [{ score: 3 }] }, { s1: [] }],
      'saveScores',
      [CID, { s1: [] }],
      [CID, 's1', 'essay', 'undo'],
    ],
    [
      'undo',
      [CID, { s1: [] }, { s1: [{ score: 3 }] }],
      'restoreScoreCells',
      [CID, { s1: [] }, { s1: [{ score: 3 }] }],
      [CID, null, null, 'undo'],
    ],
    // Return (S0-F2): one student, then several. Since S9-F1 it goes through
    // returnWork, which is returnGrades and then the marks on the pages.
    ['returnGrades', [CID, 'essay', 's1'], 'returnWork', [CID, 'essay', ['s1']], [CID, 's1', 'essay', 'return']],
    [
      'returnGrades',
      [CID, 'essay', ['s1', 's2']],
      'returnWork',
      [CID, 'essay', ['s1', 's2']],
      [CID, null, 'essay', 'return'],
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
    const covered = cases.concat(GRADEBOOK_CASES).map(c => c[0]);
    expect(Object.keys(Grader).sort()).toEqual([...new Set(covered)].sort());
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

  it('Undo saves the list, then sends what changed between the two lists, and answers what the save did', () => {
    const before = { s1: [{ score: 3 }] };
    const after = { s1: [] };
    const calls = [];
    const real = { saveScores, persistScoreDiffToCanonical };
    globalThis.saveScores = (...args) => (calls.push(['saveScores', ...args]), 'saved');
    globalThis.persistScoreDiffToCanonical = (...args) => {
      calls.push(['persistScoreDiffToCanonical', ...args]);
    };
    try {
      expect(Grader.undoOnPhone(CID, 's1', 'essay', before, after)).toBe('saved');
    } finally {
      Object.assign(globalThis, real);
    }
    expect(calls).toEqual([
      ['saveScores', CID, after],
      ['persistScoreDiffToCanonical', CID, before, after],
    ]);
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
