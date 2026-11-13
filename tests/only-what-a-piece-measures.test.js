/**
 * Only what a piece measures now counts (S0-F1d, rule C).
 *
 * Colin, 2026-11-09, "Yes, count nowhere": a level stored for a competency
 * or criterion that is no longer on the piece of work counts nowhere, the
 * gradebook included, in both sets of scores. Nothing is deleted, so putting
 * the competency back brings its level back.
 *
 * Before, when a teacher took a competency off a piece, the score left
 * behind kept counting in all work although no screen showed it. The
 * reviewer's case is the first test below: an Essay scored Ask 3 and Plan 4,
 * a Lab scored Plan 2; take Plan off the Essay, and Plan read 3 where it
 * should read 2.
 *
 * What a piece measures is read from the same list the gradebook cell is
 * drawn from (scoreTagIds): on competency work, the competencies linked to
 * it that are still on the class; on rubric work, the criteria of the rubric
 * it has now (competency levels come from those); and the one Overall score
 * when the piece is linked to nothing. The server's rule for what a student
 * is given is the same one (_grade_copy_in_use, Batch A).
 *
 * Each case below holds the same thing: with the left-over entry in the
 * data, every number is exactly what it is with that entry deleted.
 *
 * Work switched to points or Complete/Incomplete has its own section: a
 * criterion level left behind is never read as the points score or the
 * mark, and which entry is the score does not depend on the order entries
 * are stored in.
 *
 * States this rule cannot settle from the score entries alone are pinned
 * and marked FLAGGED; each needs the data layer.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';

const CID = 'course-measures';
const METHODS = ['mostRecent', 'highest', 'average', 'median', 'mode', 'decayingAvg'];
const STUDENTS = ['sam', 'kai'].map(id => ({ id, firstName: id, lastName: 'Test' }));
const ASK = 'T-ask';
const PLAN = 'T-plan';
const OLD = 'T-old'; // a competency since taken off the class

const essay = extra =>
  Object.assign(
    {
      id: 'essay',
      title: 'Essay',
      scoreMode: 'proficiency',
      tagIds: [ASK, PLAN],
      date: '2026-10-01',
      categoryId: 'cat',
    },
    extra,
  );
const lab = extra =>
  Object.assign(
    { id: 'lab', title: 'Lab', scoreMode: 'proficiency', tagIds: [PLAN], date: '2026-10-08', categoryId: 'cat' },
    extra,
  );
const on = (assessmentId, tagId, score, extra) =>
  Object.assign({ assessmentId, tagId, score, date: assessmentId === 'lab' ? '2026-10-08' : '2026-10-01' }, extra);
// The reviewer's case, for both students: Essay Ask 3 and Plan 4; Lab Plan 2.
const essayAndLab = () => [on('essay', ASK, 3), on('essay', PLAN, 4), on('lab', PLAN, 2)];

function seed(pieces, scores, opts) {
  opts = opts || {};
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: opts.gradingSystem || 'both', levelOrder: 'asc' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = pieces;
  _cache.scores[CID] = { sam: scores(), kai: scores() };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.rubrics[CID] = opts.rubrics || [];
  _cache.categories[CID] = [{ id: 'cat', name: 'Work', weight: 100 }];
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SUB', name: 'Science 9' }],
    sections: [
      { id: 'S-ask', subject: 'SUB', name: 'Ask', tags: [{ id: ASK, label: 'Ask' }] },
      { id: 'S-plan', subject: 'SUB', name: 'Plan', tags: [{ id: PLAN, label: 'Plan' }] },
    ],
  };
  _cache.courseConfigs[CID] = { calcMethod: opts.method || 'average' };
  setActiveTerm(CID, null);
  clearProfCache();
}
function drop() {
  delete globalThis.getReturnedScores;
  _scoreSet = 'all';
  delete COURSES[CID];
  localStorage.clear();
  clearProfCache();
}
const piece = id => getAssessments(CID).find(a => a.id === id);

// Every number the class shows, for both students.
function numbers() {
  clearProfCache();
  const out = {};
  STUDENTS.forEach(s => {
    const course = getCourseLetterData(CID, s.id);
    out[s.id] = {
      ask: getTagProficiency(CID, s.id, ASK),
      plan: getTagProficiency(CID, s.id, PLAN),
      planSection: getSectionProficiency(CID, s.id, 'S-plan'),
      overall: getOverallProficiency(CID, s.id),
      courseLevel: course.Q,
      percent: course.R,
      letter: course.S,
      shown: studentGradeSummary(CID, s.id).text,
      pieces: getAssessments(CID).map(a => getAssessmentOverallScore(CID, s.id, a.id)),
      piecePercents: getAssessments(CID).map(a => {
        const g = getAssessmentGroupPercentage(CID, s.id, [a]);
        return g ? g.pct : null;
      }),
      cells: getAssessments(CID).map(a => assessmentCellValue(CID, s.id, a).text),
      planPieces: getTagScores(CID, s.id, PLAN).map(e => e.assessmentId),
      askPieces: getTagScores(CID, s.id, ASK).map(e => e.assessmentId),
      planEvidence: getSectionEvidenceCount(CID, s.id, 'S-plan'),
      trend: getSectionTrend(CID, s.id, 'S-plan'),
      growth: getSectionGrowthData(CID, s.id, 'S-plan'),
    };
  });
  out.planColumn = getAssessments(CID).map(a => classColumnAverage(CID, STUDENTS, { assessment: a, tagIds: [PLAN] }));
  out.classGrade = classGradeSummary(CID, ['sam', 'kai']).text;
  return JSON.parse(JSON.stringify(out));
}
function returnedNumbers() {
  globalThis.getReturnedScores = () => getScores(CID);
  try {
    return withReturnedOnly(numbers);
  } finally {
    delete globalThis.getReturnedScores;
  }
}
// The class's numbers with some entries deleted, then put back.
function without(match) {
  const kept = _cache.scores[CID];
  _cache.scores[CID] = Object.fromEntries(Object.keys(kept).map(sid => [sid, kept[sid].filter(e => !match(e))]));
  try {
    return { all: numbers(), returned: returnedNumbers() };
  } finally {
    _cache.scores[CID] = kept;
    clearProfCache();
  }
}
// Both sets read exactly as the class with the left-over entries deleted.
function expectLeftOut(match) {
  const got = { all: numbers(), returned: returnedNumbers() };
  const want = without(match);
  expect(got.all).toEqual(want.all);
  expect(got.returned).toEqual(want.returned);
  expect(got.returned).toEqual(got.all);
  return got.all;
}

describe('a competency taken off a piece', () => {
  afterEach(drop);

  it('the reviewer’s case: Plan is 2 everywhere once Plan is off the Essay, not 3', () => {
    seed([essay(), lab()], essayAndLab);
    const linked = numbers();
    expect(linked.sam.plan).toBe(3); // (4 + 2) / 2
    expect(linked.sam.pieces).toEqual([3.5, 2]); // Essay (3 + 4) / 2
    expect(linked.sam.percent).toBe(68.8); // 3.5 and 2 out of 4 each

    // The teacher takes Plan off the Essay. The Plan 4 stays in the data.
    piece('essay').tagIds = [ASK];
    const now = expectLeftOut(e => e.assessmentId === 'essay' && e.tagId === PLAN);
    expect(now.sam.plan).toBe(2); // the Lab alone
    expect(now.sam.planPieces).toEqual(['lab']);
    expect(now.sam.planEvidence).toBe(1);
    expect(now.sam.pieces).toEqual([3, 2]); // the Essay is its Ask level
    expect(now.sam.cells[0]).toBe('3.0 · 75%');
    expect(now.sam.percent).toBe(62.5); // 3 and 2 out of 4 each
    expect(now.sam.ask).toBe(3);
    // A column for Plan on the Essay counts nobody.
    expect(now.planColumn[0]).toBeNull();
    expect(getScores(CID).sam.some(e => e.assessmentId === 'essay' && e.tagId === PLAN && e.score === 4)).toBe(true);
  });

  it.each(METHODS)('%s: Plan is the Lab’s 2, as with the left-over level deleted', method => {
    seed([essay({ tagIds: [ASK] }), lab()], essayAndLab, { method });
    const now = expectLeftOut(e => e.assessmentId === 'essay' && e.tagId === PLAN);
    expect(now.sam.plan).toBe(2);
    expect(now.kai.plan).toBe(2);
  });

  it.each(['proficiency', 'letter', 'both'])('%s class: the same', gradingSystem => {
    seed([essay({ tagIds: [ASK] }), lab()], essayAndLab, { gradingSystem });
    const now = expectLeftOut(e => e.assessmentId === 'essay' && e.tagId === PLAN);
    expect(now.sam.plan).toBe(2);
    expect(now.sam.percent).toBe(62.5);
  });

  it('putting the competency back brings its level back', () => {
    seed([essay(), lab()], essayAndLab);
    const linked = numbers();
    piece('essay').tagIds = [ASK];
    expect(numbers()).not.toEqual(linked);
    piece('essay').tagIds = [ASK, PLAN];
    expect(numbers()).toEqual(linked);
    expect(returnedNumbers()).toEqual(linked);
  });

  it('a pair: both members’ left-over levels stop counting, and both come back', () => {
    seed([essay({ collaboration: 'pairs', pairs: [['sam', 'kai']] }), lab()], essayAndLab);
    const linked = numbers();
    piece('essay').tagIds = [ASK];
    const now = expectLeftOut(e => e.assessmentId === 'essay' && e.tagId === PLAN);
    expect([now.sam.plan, now.kai.plan]).toEqual([2, 2]);
    piece('essay').tagIds = [ASK, PLAN];
    expect(numbers()).toEqual(linked);
  });

  it('taking every competency off: the levels stop counting, and an Overall level beside them does not count either', () => {
    // The server gives a student an Overall level only when the grade holds
    // no competency or criterion level at all, and a reload does not load
    // one beside competency rows. So it is not counted here.
    seed([essay({ tagIds: [] }), lab()], () => essayAndLab().concat([on('essay', 'overall', 1)]));
    const now = expectLeftOut(e => e.assessmentId === 'essay');
    expect(now.sam.pieces[0]).toBeNull();
    expect(now.sam.cells[0]).toBe('\u2014');
    expect(now.sam.ask).toBe(0);
    expect(now.sam.plan).toBe(2);
    expect(classColumnAverage(CID, STUDENTS, { assessment: piece('essay'), tagIds: ['overall'] })).toBeNull();
    // The same numbers as a reload leaves: the competency rows, and no Overall entry.
    const reloaded = without(e => e.assessmentId === 'essay' && e.tagId === 'overall');
    expect(now).toEqual(reloaded.all);
    // A left-over level that was cleared (0) is no level: the Overall counts.
    seed([essay({ tagIds: [] }), lab()], () => [on('essay', ASK, 0), on('essay', 'overall', 1), on('lab', PLAN, 2)]);
    expect(numbers().sam.pieces[0]).toBe(1);
  });
});

describe('a competency taken off the class', () => {
  afterEach(drop);

  it('a level under it counts for no piece, linked or not', () => {
    // The Essay still lists the old competency; the class no longer has it.
    seed([essay({ tagIds: [ASK, OLD] }), lab()], () => [on('essay', ASK, 3), on('essay', OLD, 1), on('lab', PLAN, 2)]);
    const now = expectLeftOut(e => e.tagId === OLD);
    expect(now.sam.pieces).toEqual([3, 2]);
    expect(now.sam.percent).toBe(62.5);
  });
});

describe('an Overall level on competency work', () => {
  afterEach(drop);

  it('beside competency levels it does not count (as before)', () => {
    seed([essay(), lab()], () => essayAndLab().concat([on('essay', 'overall', 1)]));
    const now = expectLeftOut(e => e.tagId === 'overall');
    expect(now.sam.pieces[0]).toBe(3.5);
    // A column for the Overall score on this piece counts nobody.
    expect(classColumnAverage(CID, STUDENTS, { assessment: piece('essay'), tagIds: ['overall'] })).toBeNull();
  });

  it('filed under the piece’s first competency, as a reload files it, it is that competency’s level', () => {
    // The server holds one Overall level and no competency level; the app
    // loads it under the first competency the piece lists.
    seed([essay(), lab()], () => [on('essay', ASK, 3), on('lab', PLAN, 2)]);
    const now = numbers();
    expect(now.sam.ask).toBe(3);
    expect(now.sam.pieces[0]).toBe(3);
    expect(returnedNumbers()).toEqual(now);
  });

  it('on a piece linked to nothing, the Overall level is the piece’s level', () => {
    seed([essay({ tagIds: [] }), lab()], () => [on('essay', 'overall', 3), on('lab', PLAN, 2)]);
    const now = numbers();
    expect(now.sam.pieces).toEqual([3, 2]);
    expect(now.sam.ask).toBe(0);
    expect(returnedNumbers()).toEqual(now);
    expect(classColumnAverage(CID, STUDENTS, { assessment: piece('essay'), tagIds: ['overall'] })).toEqual({
      avg: 3,
      count: 2,
    });
  });

  it('the older blank key for an Overall level is read as Overall', () => {
    // Scores loaded before the Overall key had a name sit under ''.
    seed([essay({ tagIds: [] }), lab()], () => [on('essay', '', 3), on('lab', PLAN, 2)]);
    expect(numbers().sam.pieces).toEqual([3, 2]);
    expect(returnedNumbers().sam.pieces).toEqual([3, 2]);
    // Beside competency levels it counts no more than 'overall' does.
    seed([essay(), lab()], () => essayAndLab().concat([on('essay', '', 1)]));
    expect(expectLeftOut(e => e.tagId === '').sam.pieces[0]).toBe(3.5);
  });
});

describe('rubric work', () => {
  afterEach(drop);
  const rubric = (id, criteria) => ({ id, name: id, tagIds: [], criteria });
  const R1 = () =>
    rubric('R1', [
      { id: 'r1-ask', name: 'Question', tagIds: [ASK] },
      { id: 'r1-plan', name: 'Method', tagIds: [PLAN] },
    ]);
  const R2 = () => rubric('R2', [{ id: 'r2-ask', name: 'Question', tagIds: [ASK] }]);
  const scored = () => [on('essay', 'r1-ask', 3), on('essay', 'r1-plan', 4), on('lab', PLAN, 2)];

  it('a criterion taken off the rubric: its level counts nowhere, and comes back with the criterion', () => {
    seed([essay({ rubricId: 'R1' }), lab()], scored, { rubrics: [R1()] });
    const whole = numbers();
    expect(whole.sam.plan).toBe(3);
    expect(whole.sam.pieces[0]).toBe(3.5);

    const method = _cache.rubrics[CID][0].criteria.pop();
    const now = expectLeftOut(e => e.tagId === 'r1-plan');
    expect(now.sam.plan).toBe(2);
    expect(now.sam.pieces[0]).toBe(3);

    _cache.rubrics[CID][0].criteria.push(method);
    expect(numbers()).toEqual(whole);
  });

  it('the rubric swapped for another: the old rubric’s levels count nowhere, and come back with it', () => {
    seed([essay({ rubricId: 'R1' }), lab()], scored, { rubrics: [R1(), R2()] });
    const first = numbers();
    piece('essay').rubricId = 'R2';
    const now = expectLeftOut(e => e.assessmentId === 'essay');
    expect(now.sam.pieces[0]).toBeNull(); // nothing scored on the new rubric yet
    expect(now.sam.ask).toBe(0);
    expect(now.sam.plan).toBe(2);
    piece('essay').rubricId = 'R1';
    expect(numbers()).toEqual(first);
  });

  it('a rubric put on competency work: a level left under a competency the rubric does not feed counts nowhere', () => {
    // R2 feeds Ask only. The Essay was scored Plan 4 before it had a rubric.
    seed(
      [essay({ rubricId: 'R2' }), lab()],
      () => [on('essay', 'r2-ask', 3), on('essay', PLAN, 4), on('lab', PLAN, 2)],
      {
        rubrics: [R2()],
      },
    );
    const now = expectLeftOut(e => e.assessmentId === 'essay' && e.tagId === PLAN);
    expect(now.sam.plan).toBe(2);
    expect(now.sam.ask).toBe(3);
    expect(now.sam.pieces[0]).toBe(3);
  });

  it('a rubric put on work already scored by competency: the competency levels are the same before and after a reload', () => {
    // Scored Ask 3 and Plan 4 by competency; then given R1, whose criteria
    // feed Ask and Plan. The data layer moves each such level onto the
    // criterion that feeds its competency the next time it reads the
    // scores, as a reload does (it used to wait for the reload).
    seed([essay(), lab()], essayAndLab, { rubrics: [R1()] });
    numbers(); // the data layer has looked at these scores once, with no rubric on the piece
    piece('essay').rubricId = 'R1';
    const before = numbers();
    expect(
      getScores(CID)
        .sam.map(e => e.tagId)
        .sort(),
    ).toEqual([PLAN, 'r1-ask', 'r1-plan'].sort());

    // A reload: the scores are read afresh and the levels moved.
    _cache.scores[CID] = structuredClone(_cache.scores[CID]);
    const after = numbers();
    expect(
      getScores(CID)
        .sam.map(e => e.tagId)
        .sort(),
    ).toEqual([PLAN, 'r1-ask', 'r1-plan'].sort());

    // No competency level, section or overall moves across the reload.
    ['sam', 'kai'].forEach(sid => {
      expect([before[sid].ask, before[sid].plan, before[sid].overall]).toEqual([
        after[sid].ask,
        after[sid].plan,
        after[sid].overall,
      ]);
      expect(before[sid].planEvidence).toBe(after[sid].planEvidence);
    });
    expect(before.sam.plan).toBe(3); // the Essay's 4 and the Lab's 2
    expect(returnedNumbers()).toEqual(after);
  });

  it('that piece’s own level and % appear at once, as after a reload', () => {
    // Flagged here before: the data layer only moved the levels on a
    // reload, so until then the rubric had no criterion scored and the
    // piece had no level and was not in the course %. It now moves them
    // when the piece is given a rubric.
    seed([essay(), lab()], essayAndLab, { rubrics: [R1()] });
    numbers();
    piece('essay').rubricId = 'R1';
    const before = numbers();
    _cache.scores[CID] = structuredClone(_cache.scores[CID]);
    const after = numbers();
    expect(before.sam.pieces[0]).toBe(3.5);
    expect(after.sam.pieces[0]).toBe(3.5);
    expect(before.sam.percent).toBe(after.sam.percent);
  });

  it('the rubric taken off again: its criteria’s levels count nowhere; the competency levels do', () => {
    seed(
      [essay(), lab()],
      () => [on('essay', 'r1-ask', 1), on('essay', ASK, 3), on('essay', PLAN, 4), on('lab', PLAN, 2)],
      {
        rubrics: [R1()],
      },
    );
    const now = expectLeftOut(e => e.tagId === 'r1-ask');
    expect(now.sam.pieces[0]).toBe(3.5);
    expect(now.sam.ask).toBe(3);
  });
});

describe('work switched to points or Complete/Incomplete', () => {
  afterEach(drop);
  const R1 = () => ({
    id: 'R1',
    name: 'R1',
    tagIds: [],
    criteria: [
      { id: 'r1-ask', name: 'Question', tagIds: [ASK] },
      { id: 'r1-plan', name: 'Method', tagIds: [PLAN] },
    ],
  });
  const pointsEssay = extra => essay(Object.assign({ scoreMode: 'points', maxPoints: 10 }, extra));
  // The Essay's rubric levels from before it was switched: 3 and 4.
  const leftOver = () => [on('essay', 'r1-ask', 3), on('essay', 'r1-plan', 4)];
  // A points score as the app stores it: under each competency the piece lists.
  const typed = n => [on('essay', ASK, n), on('essay', PLAN, n)];
  const isLeftOver = e => e.tagId === 'r1-ask' || e.tagId === 'r1-plan';

  it('rubric work switched to points: the criterion levels left behind are not a points score', () => {
    seed([pointsEssay(), lab()], () => leftOver().concat([on('lab', PLAN, 2)]), { rubrics: [R1()] });
    const now = expectLeftOut(isLeftOver);
    expect(now.sam.cells[0]).toBe('\u2014');
    expect(now.sam.pieces[0]).toBeNull();
    expect(now.sam.piecePercents[0]).toBeNull();
    expect(_scoreRead.pointsScore(CID, 'sam', piece('essay'))).toBeNull();
    expect(now.sam.percent).toBe(50); // the Lab alone, 2 of 4
  });

  const RUBRIC_LEFT = { 'off the piece': {}, 'still on the piece (another tool wrote it)': { rubricId: 'R1' } };
  it.each(Object.keys(RUBRIC_LEFT))(
    'then 9 is typed in, the rubric %s: the cell is 9 and the piece counts 90 percent, whichever way round the entries are stored',
    name => {
      const extra = RUBRIC_LEFT[name];
      const seen = [leftOver().concat(typed(9)), typed(9).concat(leftOver())].map(order => {
        seed([pointsEssay(extra), lab()], () => order.concat([on('lab', PLAN, 2)]), { rubrics: [R1()] });
        const now = expectLeftOut(isLeftOver);
        expect(now.sam.cells[0]).toBe('9');
        expect(now.sam.piecePercents[0]).toBe(90);
        expect(now.sam.pieces[0]).toBe(4); // 90% is Extending
        expect(_scoreRead.pointsScore(CID, 'sam', piece('essay'))).toBe(9);
        return now;
      });
      expect(seen[1]).toEqual(seen[0]);
      expect(seen[0].sam.percent).toBe(78.6); // 9 of 10 and 2 of 4
    },
  );

  it('Complete/Incomplete: a criterion level left behind is not a mark, before or after one is given', () => {
    const check = () => essay({ scoreMode: 'complete', maxPoints: 1, tagIds: [] });
    seed([check(), lab()], () => leftOver().concat([on('lab', PLAN, 2)]), { rubrics: [R1()] });
    expect(_scoreRead.completionMark(CID, 'sam', piece('essay'))).toBeNull();
    expect(expectLeftOut(isLeftOver).sam.cells[0]).toBe('\u2014');
    const mark = () => [on('essay', 'overall', 0)]; // Incomplete
    const seen = [leftOver().concat(mark()), mark().concat(leftOver())].map(order => {
      seed([check(), lab()], () => order.concat([on('lab', PLAN, 2)]), { rubrics: [R1()] });
      expect(_scoreRead.completionMark(CID, 'sam', piece('essay'))).toBe('incomplete');
      return expectLeftOut(isLeftOver);
    });
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[0].sam.piecePercents[0]).toBe(0);
  });

  it('a points score kept under a competency the piece has since been moved off still reads; a newer one wins either way round', () => {
    // Scored 8 while linked to Plan; the piece is linked to Ask now. The 8
    // is the piece's one score (the server holds it as such), so it shows.
    seed([pointsEssay({ tagIds: [ASK] }), lab()], () => [on('essay', PLAN, 8), on('lab', PLAN, 2)]);
    const moved = numbers();
    expect(moved.sam.cells[0]).toBe('8');
    expect(moved.sam.piecePercents[0]).toBe(80);
    expect(moved.sam.pieces[0]).toBe(3);
    // It is not evidence for Plan, which the piece no longer measures.
    expect(moved.sam.planPieces).toEqual(['lab']);
    // Scored again at 9 under Ask: the score under what the piece lists wins.
    [
      [on('essay', PLAN, 8), on('essay', ASK, 9)],
      [on('essay', ASK, 9), on('essay', PLAN, 8)],
    ].forEach(order => {
      seed([pointsEssay({ tagIds: [ASK] }), lab()], () => order.concat([on('lab', PLAN, 2)]));
      const now = numbers();
      expect(now.sam.cells[0]).toBe('9');
      expect(now.sam.piecePercents[0]).toBe(90);
      expect(now.sam.pieces[0]).toBe(4);
    });
  });

  it('a points score kept as Overall on a piece since given competencies still reads; one under them wins either way round', () => {
    seed([pointsEssay(), lab()], () => [on('essay', 'overall', 8), on('lab', PLAN, 2)]);
    expect(numbers().sam.cells[0]).toBe('8');
    [[on('essay', 'overall', 8)].concat(typed(9)), typed(9).concat([on('essay', 'overall', 8)])].forEach(order => {
      seed([pointsEssay(), lab()], () => order.concat([on('lab', PLAN, 2)]));
      expect(numbers().sam.cells[0]).toBe('9');
      expect(numbers().sam.piecePercents[0]).toBe(90);
    });
  });

  it('two competencies holding different numbers: the first the piece lists is the score, either way round', () => {
    [
      [on('essay', ASK, 9), on('essay', PLAN, 5)],
      [on('essay', PLAN, 5), on('essay', ASK, 9)],
    ].forEach(order => {
      seed([pointsEssay(), lab()], () => order.concat([on('lab', PLAN, 2)]));
      const now = numbers();
      expect(now.sam.cells[0]).toBe('9');
      expect(now.sam.piecePercents[0]).toBe(90);
      expect(now.sam.pieces[0]).toBe(4);
    });
  });

  it('scores left under two competencies the piece lists neither of: the same one is read either way round', () => {
    [
      [on('essay', ASK, 8), on('essay', PLAN, 5)],
      [on('essay', PLAN, 5), on('essay', ASK, 8)],
    ].forEach(order => {
      seed([pointsEssay({ tagIds: [] }), lab()], () => order.concat([on('lab', PLAN, 2)]));
      expect(numbers().sam.cells[0]).toBe('8');
      expect(numbers().sam.piecePercents[0]).toBe(80);
    });
  });

  it('FLAGGED, unchanged: competency work switched to points, its competency kept, reads the level as points until a points score is entered', () => {
    // The Essay was scored Ask 3, then switched to points out of 10 with Ask
    // still on it. The 3 sits under the key a points score would use, so the
    // entries do not say which it is; the data layer would have to. Entering
    // a points score overwrites it. No class has this today (the live
    // database holds no competency level on points work).
    seed([pointsEssay({ tagIds: [ASK] }), lab()], () => [on('essay', ASK, 3), on('lab', PLAN, 2)]);
    expect(assessmentCellValue(CID, 'sam', piece('essay')).text).toBe('3');
    expect(getAssessmentGroupPercentage(CID, 'sam', [piece('essay')]).pct).toBe(30);
    // Switched back to competency work, the level is a level again.
    Object.assign(piece('essay'), { scoreMode: 'proficiency', maxPoints: undefined });
    clearProfCache();
    expect(getAssessmentOverallScore(CID, 'sam', 'essay')).toBe(3);
    expect(getTagProficiency(CID, 'sam', ASK)).toBe(3);
  });

  it('FLAGGED, left reading: a level under a competency since taken off, on work switched to points with no score yet, reads as points', () => {
    // It cannot be told from a points score kept under a competency the
    // piece was moved off (the test above), which must show. A points score
    // entered under what the piece lists now takes over at once.
    seed([pointsEssay({ tagIds: [ASK] }), lab()], () => [on('essay', PLAN, 4), on('lab', PLAN, 2)]);
    expect(assessmentCellValue(CID, 'sam', piece('essay')).text).toBe('4');
    seed([pointsEssay({ tagIds: [ASK] }), lab()], () => [
      on('essay', PLAN, 4),
      on('essay', ASK, 7),
      on('lab', PLAN, 2),
    ]);
    expect(assessmentCellValue(CID, 'sam', piece('essay')).text).toBe('7');
  });
});

describe('what the rule leaves alone', () => {
  afterEach(drop);

  it('a score whose piece is no longer in the class is left as it was', () => {
    seed([lab()], () => [on('gone', PLAN, 4), on('lab', PLAN, 2)]);
    expect(numbers().sam.plan).toBe(3);
    expect(numbers().sam.planPieces).toEqual(['gone', 'lab']);
  });

  it('a class with no competencies of its own still counts the levels its pieces list', () => {
    seed([essay(), lab()], essayAndLab);
    _cache.learningMaps[CID].sections = [];
    clearProfCache();
    expect(getAssessmentOverallScore(CID, 'sam', 'essay')).toBe(3.5);
  });

  it('points work: its score counts toward the competencies it is linked to now, and no others', () => {
    // Scored 8 out of 10 while linked to Ask and Plan (kept under each, as
    // this device keeps it); then Plan is taken off.
    seed([essay({ scoreMode: 'points', maxPoints: 10, tagIds: [ASK] }), lab()], () => [
      on('essay', ASK, 8),
      on('essay', PLAN, 8),
      on('lab', PLAN, 2),
    ]);
    const now = numbers();
    expect(now.sam.planPieces).toEqual(['lab']);
    expect(now.sam.plan).toBe(2);
    expect(now.sam.askPieces).toEqual(['essay']);
    // The points score itself is one number for the piece, as before.
    expect(now.sam.piecePercents[0]).toBe(80);
    expect(returnedNumbers()).toEqual(now);
  });

  it('FLAGGED, unchanged: an Overall level alone on a piece that now has competencies is not shown or counted until a reload files it', () => {
    // The gradebook cell and calc.js agree here (neither counts it); the
    // server gives it to the student, and a reload files it under the first
    // competency. The Assignments page copies it onto the competencies when
    // they are ticked, so this lasts only if that copy did not happen.
    seed([essay(), lab()], () => [on('essay', 'overall', 3), on('lab', PLAN, 2)]);
    expect(assessmentCellValue(CID, 'sam', piece('essay')).kind).toBe('none');
    expect(getAssessmentOverallScore(CID, 'sam', 'essay')).toBeNull();
    expect(classColumnAverage(CID, STUDENTS, { assessment: piece('essay'), tagIds: ['overall'] })).toBeNull();
  });
});

/* ── The Demo class: Cece Adeyemi ────────────────────────────── */

describe('Science 8 (Demo): Communicating taken off Cece’s Immune System Quick Check', () => {
  let cid;
  let cece;
  let check;
  let wasDemo;
  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
    setActiveTerm(cid, null);
    cece = getStudents(cid).find(s => s.firstName === 'Cece').id;
    check = getAssessments(cid).find(a => a.title === 'Immune System Quick Check');
    // The Quick Check was scored 3 on PA5 and 1 on CM1.
    getScores(cid)
      [cece].filter(e => e.assessmentId === check.id && e.tagId === 'CM1')
      .forEach(e => {
        e.score = 1;
        delete e.mod;
      });
    getScores(cid)
      [cece].filter(e => e.assessmentId === check.id && e.tagId === 'PA5')
      .forEach(e => {
        e.score = 3;
        delete e.mod;
      });
    clearProfCache();
  });
  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  const read = () => {
    clearProfCache();
    const pct = getAssessmentGroupPercentage(cid, cece, [check]);
    return {
      explain: getTagProficiency(cid, cece, 'CM1'),
      tissues: getTagProficiency(cid, cece, 'PA5'),
      piece: getAssessmentOverallScore(cid, cece, check.id),
      piecePercent: pct ? pct.pct : null,
      overall: getOverallProficiency(cid, cece),
      percent: getCourseLetterData(cid, cece).R,
    };
  };

  it('before and after, and back again', () => {
    expect(check.tagIds).toEqual(['PA5', 'CM1']);
    const linked = read();
    check.tagIds = ['PA5'];
    const now = read();
    // Exactly as if the CM1 level were deleted.
    const scores = getScores(cid);
    const kept = scores[cece];
    scores[cece] = kept.filter(e => !(e.assessmentId === check.id && e.tagId === 'CM1'));
    const deleted = read();
    scores[cece] = kept;
    expect(now).toEqual(deleted);
    // Communicating no longer counts the 1; the piece is its PA5 level.
    expect(linked.explain).toBeCloseTo(2.9697, 4);
    expect(now.explain).toBeCloseTo(3.1667, 4);
    expect([linked.piece, now.piece]).toEqual([2, 3]);
    expect([linked.piecePercent, now.piecePercent]).toEqual([50, 75]);
    expect(linked.overall).toBeCloseTo(3.0919, 4);
    expect(now.overall).toBeCloseTo(3.1083, 4);
    expect([linked.percent, now.percent]).toEqual([78.8, 78.9]);
    expect(now.tissues).toBe(linked.tissues);
    check.tagIds = ['PA5', 'CM1'];
    expect(read()).toEqual(linked);
  });
});
