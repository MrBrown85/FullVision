/**
 * Whole-rubric competencies (rubric starts PR 6). A competency linked to the
 * whole rubric (rubric.tagIds) gets ONE score per student per assessment:
 * the rubric's weighted 0-4 average as a percent of 4, read through the
 * class's Points to Proficiency table, the way a points score is. A
 * competency is on the whole rubric or on criteria, never both; where both,
 * the whole rubric wins. The course % is unchanged (the rubric's Overall).
 *
 * The expected levels come from the reference model below, written from the
 * rule rather than from calc.js.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const AID2 = '22222222-2222-4222-8222-222222222223';
const SID = '33333333-3333-4333-8333-333333333333';
const RUBRIC = '55555555-5555-4555-8555-555555555555';
const C1 = '66666666-6666-4666-8666-666666666661';
const C2 = '66666666-6666-4666-8666-666666666662';
const C3 = '66666666-6666-4666-8666-666666666663';
const C4 = '66666666-6666-4666-8666-666666666664';
const WHOLE = '88888888-8888-4888-8888-888888888888';
const OWN = '99999999-9999-4999-8999-999999999999';

// Reference model: weighted mean of level/4, as a percent, through the table.
function referenceLevel(levels, weights, table) {
  var sum = 0;
  var total = 0;
  levels.forEach(function (l, i) {
    if (l == null) return;
    var w = weights ? weights[i] : 1;
    sum += w * (l / 4) * 100;
    total += w;
  });
  if (!total) return null;
  var pct = sum / total;
  var rows = (table || [86, 73, 50, 0]).map(function (min, i) {
    return { min: min, level: 4 - i };
  });
  for (var i = 0; i < rows.length; i++) if (pct >= rows[i].min) return rows[i].level;
  return 1;
}

function rubric(weights, extra) {
  return Object.assign(
    {
      id: RUBRIC,
      name: 'Lab Report',
      tagIds: [WHOLE],
      criteria: [C1, C2, C3, C4].map(function (id, i) {
        return { id: id, name: 'Part ' + (i + 1), tagIds: [], weight: weights ? weights[i] : 1, levels: {} };
      }),
    },
    extra || {},
  );
}
const assessment = (id, date) => ({
  id: id || AID,
  title: 'Lab Report',
  date: date || '2026-09-10',
  type: 'summative',
  tagIds: [WHOLE],
  rubricId: RUBRIC,
});
const entry = (aid, key, score, extra) =>
  Object.assign(
    {
      id: aid + ':' + key,
      assessmentId: aid,
      tagId: key,
      score: score,
      date: '2026-09-10',
      type: 'summative',
      note: '',
    },
    extra || {},
  );
function scoresFor(aid, levels) {
  return [C1, C2, C3, C4]
    .map(function (c, i) {
      return levels[i] == null ? null : entry(aid, c, levels[i]);
    })
    .filter(Boolean);
}

function seed(r, assessments, scores) {
  saveStudents(CID, [{ id: SID, firstName: 'Owen', lastName: 'Martens' }]);
  saveRubrics(CID, [r]);
  saveAssessments(CID, assessments);
  saveScores(CID, { [SID]: scores });
  clearProfCache();
}

beforeEach(() => {
  localStorage.clear();
  ['scores', 'assessments', 'rubrics', 'students', 'statuses', 'courseConfigs'].forEach(function (field) {
    if (_cache[field]) delete _cache[field][CID];
  });
});

describe('one combined score for a whole-rubric competency', () => {
  const cases = [
    { name: '4,3,3,2 at equal weights', levels: [4, 3, 3, 2], weights: null },
    { name: '4,3,3,2 at weights 2,1,1,1', levels: [4, 3, 3, 2], weights: [2, 1, 1, 1] },
    { name: 'all 2s', levels: [2, 2, 2, 2], weights: null },
    { name: '3,3,3,2 (68.75%)', levels: [3, 3, 3, 2], weights: null },
    { name: '4,4,3,3 (87.5%)', levels: [4, 4, 3, 3], weights: null },
    { name: 'one criterion unscored', levels: [4, null, 3, 2], weights: null },
  ];
  cases.forEach(function (c) {
    it(c.name + ' matches the reference model', () => {
      seed(rubric(c.weights), [assessment()], scoresFor(AID, c.levels));
      const want = referenceLevel(c.levels, c.weights);
      const got = getTagScores(CID, SID, WHOLE);
      expect(got).toHaveLength(1);
      expect(got[0].score).toBe(want);
      expect(got[0].wholeRubric).toBe(true);
      expect(got[0].criterionId).toBeUndefined();
      expect(competencyLevelFromCriteria(CID, SID, assessment(), WHOLE).score).toBe(want);
    });
  });

  it('gives the plan’s named results: 3 and 3', () => {
    seed(rubric(), [assessment()], scoresFor(AID, [4, 3, 3, 2]));
    expect(getTagScores(CID, SID, WHOLE)[0].score).toBe(3);
    seed(rubric([2, 1, 1, 1]), [assessment()], scoresFor(AID, [4, 3, 3, 2]));
    expect(getTagScores(CID, SID, WHOLE)[0].score).toBe(3);
  });

  it('reads the class’s own Points to Proficiency table', () => {
    const table = [90, 70, 40, 0];
    saveCourseConfig(CID, {
      gradingScale: {
        boundaries: table.map(function (min, i) {
          return { min: min, proficiency: 4 - i };
        }),
      },
    });
    seed(rubric(), [assessment()], scoresFor(AID, [4, 4, 3, 3]));
    expect(getTagScores(CID, SID, WHOLE)[0].score).toBe(referenceLevel([4, 4, 3, 3], null, table));
    expect(getTagScores(CID, SID, WHOLE)[0].score).toBe(3);
  });

  it('carries the average for the hover', () => {
    seed(rubric(), [assessment()], scoresFor(AID, [4, 3, 3, 2]));
    const lv = competencyLevelFromCriteria(CID, SID, assessment(), WHOLE);
    expect(lv).toMatchObject({ score: 3, mod: 0, mixed: false, whole: true });
    expect(lv.average).toBeCloseTo(3, 5);
  });

  it('is one entry per assessment, so two assessments are two pieces of evidence', () => {
    seed(
      rubric(),
      [assessment(AID, '2026-09-10'), assessment(AID2, '2026-09-20')],
      scoresFor(AID, [4, 4, 4, 4]).concat(scoresFor(AID2, [2, 2, 2, 2])),
    );
    expect(
      getTagScores(CID, SID, WHOLE)
        .map(s => [s.assessmentId, s.score])
        .sort(),
    ).toEqual([
      [AID, 4],
      [AID2, 2],
    ]);
  });

  it('gives nothing when no criterion is scored', () => {
    seed(rubric(), [assessment()], []);
    expect(getTagScores(CID, SID, WHOLE)).toEqual([]);
    expect(competencyLevelFromCriteria(CID, SID, assessment(), WHOLE)).toBeNull();
  });

  it('leaves the course % and the Overall alone', () => {
    seed(rubric(), [assessment()], scoresFor(AID, [4, 3, 3, 2]));
    const withWhole = getAssessmentOverallScore(CID, SID, AID);
    seed(rubric(null, { tagIds: [] }), [assessment()], scoresFor(AID, [4, 3, 3, 2]));
    expect(getAssessmentOverallScore(CID, SID, AID)).toBeCloseTo(withWhole, 9);
  });
});

describe('never both', () => {
  it('a criterion competency still rolls up per criterion beside a whole one', () => {
    const r = rubric();
    r.criteria[0].tagIds = [OWN];
    seed(r, [assessment()], scoresFor(AID, [4, 3, 3, 2]));
    expect(getTagScores(CID, SID, OWN).map(s => [s.criterionId, s.score])).toEqual([[C1, 4]]);
    expect(getTagScores(CID, SID, WHOLE)).toHaveLength(1);
  });

  it('the whole rubric wins when one competency is on both', () => {
    const r = rubric();
    r.criteria[0].tagIds = [WHOLE];
    seed(r, [assessment()], scoresFor(AID, [4, 3, 3, 2]));
    const got = getTagScores(CID, SID, WHOLE);
    expect(got).toHaveLength(1);
    expect(got[0].wholeRubric).toBe(true);
  });

  it('every criterion feeds the whole competency, which is listed once', () => {
    seed(rubric(), [assessment()], []);
    expect(rubricCriteriaForTag(CID, assessment(), WHOLE).map(c => c.id)).toEqual([C1, C2, C3, C4]);
    expect(rubricCompetencyIds(CID, assessment())).toEqual([WHOLE]);
    expect(rubricWholeTagIds(CID, assessment())).toEqual([WHOLE]);
  });

  it('a rubric lists its criteria competencies, then the whole rubric, each once', () => {
    const r = rubric();
    r.criteria[0].tagIds = [OWN];
    r.criteria[1].tagIds = [OWN];
    expect(rubricScoredTagIds(r)).toEqual([OWN, WHOLE]);
    expect(rubricScoredTagIds(null)).toEqual([]);
  });

  it('the level is the same whether the entries are passed or read', () => {
    seed(rubric(), [assessment()], scoresFor(AID, [4, 3, 3, 2]));
    const all = getScores(CID)[SID];
    expect(wholeRubricLevel(CID, SID, assessment(), all)).toEqual(wholeRubricLevel(CID, SID, assessment()));
  });
});
