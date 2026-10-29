/**
 * Each rubric criterion keeps its own score, under its criterion id
 * (docs/DECISIONS.md, "Rubric criteria score on their own"). Two criteria on
 * one competency used to share one slot keyed by the competency, so scoring
 * one changed the other (Colin, 2026-10-29: "Rubric criterion are
 * influencing each other???"). A criterion's score now rolls up to each of
 * its competencies as its own evidence, and older competency-keyed saves
 * are moved to criterion keys when read.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const RUBRIC = '55555555-5555-4555-8555-555555555555';
const CRIT_Q1 = '66666666-6666-4666-8666-666666666661';
const CRIT_Q2 = '66666666-6666-4666-8666-666666666662';
const CRIT_Q3 = '66666666-6666-4666-8666-666666666663';
const CI = '88888888-8888-4888-8888-888888888888';
const CP = '99999999-9999-4999-8999-999999999999';

const rubric = {
  id: RUBRIC,
  name: 'Reading Questions',
  criteria: [
    { id: CRIT_Q1, name: '1. What Is a Philosophical Question?', tagIds: [CI], levels: {} },
    { id: CRIT_Q2, name: '2. A Dialogue', tagIds: [CI], levels: {} },
    { id: CRIT_Q3, name: '3. Three Benefits', tagIds: [CP], levels: {} },
  ],
};
const assessment = {
  id: AID,
  title: 'Reading Questions',
  date: '2026-09-10',
  type: 'summative',
  tagIds: [CI, CP],
  rubricId: RUBRIC,
};
const entry = (key, score, extra) =>
  Object.assign(
    {
      id: AID + ':' + key,
      assessmentId: AID,
      tagId: key,
      score: score,
      date: '2026-09-10',
      type: 'summative',
      note: '',
    },
    extra || {},
  );

function seed(scores) {
  saveStudents(CID, [{ id: SID, firstName: 'Owen', lastName: 'Martens' }]);
  saveRubrics(CID, [rubric]);
  saveAssessments(CID, [assessment]);
  saveScores(CID, { [SID]: scores });
  clearProfCache();
}

beforeEach(() => {
  localStorage.clear();
  ['scores', 'assessments', 'rubrics', 'students', 'statuses'].forEach(function (field) {
    if (_cache[field]) delete _cache[field][CID];
  });
});

describe('two criteria on one competency', () => {
  it('keep separate levels', () => {
    seed([]);
    upsertScore(CID, SID, AID, CRIT_Q1, 3, '2026-09-10', 'summative', '');
    upsertScore(CID, SID, AID, CRIT_Q2, 2, '2026-09-10', 'summative', '');
    const byKey = Object.fromEntries(getScores(CID)[SID].map(e => [e.tagId, e.score]));
    expect(byKey[CRIT_Q1]).toBe(3);
    expect(byKey[CRIT_Q2]).toBe(2);
    expect(byKey[CI]).toBeUndefined();
    expect(getAssessmentOverallScore(CID, SID, AID)).toBeCloseTo(2.5, 5);
  });

  it('are each evidence for the competency, named by criterion', () => {
    seed([entry(CRIT_Q1, 3, { mod: 1 }), entry(CRIT_Q2, 2)]);
    const ci = getTagScores(CID, SID, CI);
    expect(ci.map(s => [s.criterionId, s.level, s.score])).toEqual([
      [CRIT_Q1, 3, 3 + 1 / 3],
      [CRIT_Q2, undefined, 2],
    ]);
    expect(ci.map(s => s.criterionName)).toEqual(['1. What Is a Philosophical Question?', '2. A Dialogue']);
    expect(ci.every(s => s.tagId === CI)).toBe(true);
    expect(getTagScores(CID, SID, CP)).toEqual([]);
    COURSES[CID] = { id: CID, name: 'Philosophy 12', calcMethod: 'average' };
    expect(getTagProficiency(CID, SID, CI)).toBeCloseTo((3 + 1 / 3 + 2) / 2, 5);
  });

  it('average into one point per assessment on a timeline', () => {
    seed([entry(CRIT_Q1, 3, { mod: 1 }), entry(CRIT_Q2, 2)]);
    const points = tagScoresByAssessment(CID, SID, CI);
    expect(points).toHaveLength(1);
    expect(points[0].score).toBeCloseTo((3 + 1 / 3 + 2) / 2, 5);
    expect(points[0].criterionIds).toEqual([CRIT_Q1, CRIT_Q2]);
    expect(points[0].level).toBeUndefined();
  });

  it("give the gradebook's competency cell one level, or the lowest marked mixed", () => {
    seed([entry(CRIT_Q1, 3, { mod: 1 }), entry(CRIT_Q2, 3, { mod: 1 })]);
    expect(competencyLevelFromCriteria(CID, SID, assessment, CI)).toEqual({ score: 3, mod: 1, mixed: false });
    expect(competencyLevelFromCriteria(CID, SID, assessment, CP)).toBeNull();
    seed([entry(CRIT_Q1, 4), entry(CRIT_Q2, 2, { mod: 1 })]);
    expect(competencyLevelFromCriteria(CID, SID, assessment, CI)).toEqual({ score: 2, mod: 1, mixed: true });
    // 3 and 3−: the lowest is 3−, not 3.
    seed([entry(CRIT_Q1, 3), entry(CRIT_Q2, 3, { mod: -1 })]);
    expect(competencyLevelFromCriteria(CID, SID, assessment, CI)).toEqual({ score: 3, mod: -1, mixed: true });
    expect(rubricCompetencyIds(CID, assessment)).toEqual([CI, CP]);
    expect(scoreTagIds(assessment, CID)).toEqual([CRIT_Q1, CRIT_Q2, CRIT_Q3]);
  });

  it('count toward a Class Average competency column through their criteria', () => {
    seed([entry(CRIT_Q1, 4), entry(CRIT_Q2, 2)]);
    const stats = classColumnAverage(CID, getStudents(CID), { assessment: assessment, tagIds: [CI] });
    expect(stats.avg).toBeCloseTo(3, 5);
  });
});

describe('scores saved under competencies before', () => {
  it('move to their criteria once, keeping notes and ±', () => {
    seed([
      {
        id: 'old-ci',
        assessmentId: AID,
        tagId: CI,
        score: 3,
        mod: 1,
        critNote: 'Nice.',
        date: '2026-09-10',
        type: 'summative',
        note: '',
      },
      { id: 'old-cp', assessmentId: AID, tagId: CP, score: 4, date: '2026-09-10', type: 'summative', note: '' },
    ]);
    const entries = getScores(CID)[SID];
    const byKey = Object.fromEntries(entries.map(e => [e.tagId, e]));
    expect(Object.keys(byKey).sort()).toEqual([CRIT_Q1, CRIT_Q2, CRIT_Q3].sort());
    expect(byKey[CRIT_Q1]).toMatchObject({ id: AID + ':' + CRIT_Q1, score: 3, mod: 1, critNote: 'Nice.' });
    expect(byKey[CRIT_Q2]).toMatchObject({ score: 3, mod: 1 });
    expect(byKey[CRIT_Q3]).toMatchObject({ score: 4 });
    // Read again: nothing moves twice.
    expect(getScores(CID)[SID]).toHaveLength(3);
  });

  it('move when the rubric arrives after the scores', () => {
    seed([entry(CI, 3)]);
    _cache.rubrics[CID] = [];
    expect(getScores(CID)[SID].map(e => e.tagId)).toEqual([CI]);
    saveRubrics(CID, [rubric]);
    expect(
      getScores(CID)
        [SID].map(e => e.tagId)
        .sort(),
    ).toEqual([CRIT_Q1, CRIT_Q2].sort());
  });

  it("move a note the criterion's own entry lacks, and keep its level", () => {
    seed([
      entry(CRIT_Q1, 2),
      {
        id: 'old-ci',
        assessmentId: AID,
        tagId: CI,
        score: 3,
        critNote: 'Nice.',
        critBeyond: 'Extra',
        date: '2026-09-10',
        type: 'summative',
        note: '',
      },
    ]);
    const byKey = Object.fromEntries(getScores(CID)[SID].map(e => [e.tagId, e]));
    expect(byKey[CI]).toBeUndefined();
    expect(byKey[CRIT_Q1]).toMatchObject({ score: 2, critNote: 'Nice.', critBeyond: 'Extra' });
    expect(byKey[CRIT_Q2]).toMatchObject({ score: 3, critNote: 'Nice.' });
  });

  it('is reused from schema 3 only when it keeps no rubric score under a competency', () => {
    expect(_BUNDLE_SCHEMA).toBe(4);
    seed([entry(CRIT_Q1, 3)]);
    _teacherId = 'teacher-uuid';
    _saveClassMeta(CID, { schema: 3, owner: _teacherId, version: 9, lastOpenedAt: Date.now(), savedAt: Date.now() });
    expect(_savedCopyHasLegacyRubricKeys(CID)).toBe(false);
    expect(_savedCopyUsable(CID)).toBe(true);
    // The same copy with an old competency-keyed rubric score is downloaded again.
    localStorage.setItem('gb-scores-' + CID, JSON.stringify({ [SID]: [entry(CI, 3)] }));
    expect(_savedCopyHasLegacyRubricKeys(CID)).toBe(true);
    expect(_savedCopyUsable(CID)).toBe(false);
    _saveClassMeta(CID, { schema: 4 });
    expect(_savedCopyUsable(CID)).toBe(true);
  });

  it('leaves a scores object with nothing old untouched', () => {
    seed([entry(CRIT_Q1, 3), entry(CRIT_Q2, 2)]);
    const before = JSON.stringify(getScores(CID));
    expect(JSON.stringify(_migrateRubricScoreKeys(CID, JSON.parse(before)))).toBe(before);
  });

  it('leave a competency not fed by any criterion alone', () => {
    const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    seed([entry(OTHER, 2)]);
    expect(getScores(CID)[SID].map(e => e.tagId)).toEqual([OTHER]);
  });
});

describe('a criterion score goes to the server as its own rubric_score', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    client = {
      calls: [],
      rpc(name, payload) {
        client.calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    };
    globalThis.getSupabase = () => client;
    seed([]);
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('sends upsert_rubric_score for that criterion only', () => {
    upsertScore(CID, SID, AID, CRIT_Q2, 2, '2026-09-10', 'summative', '');
    const names = client.calls.map(c => c.name).filter(n => /score/.test(n));
    expect(names).toEqual(['upsert_rubric_score']);
    expect(client.calls.find(c => c.name === 'upsert_rubric_score').payload).toMatchObject({
      p_enrollment_id: SID,
      p_assessment_id: AID,
      p_criterion_id: CRIT_Q2,
      p_value: 2,
    });
  });

  it('sends nothing for a competency key on rubric work', () => {
    upsertScore(CID, SID, AID, CI, 3, '2026-09-10', 'summative', '');
    expect(client.calls.map(c => c.name).filter(n => /score/.test(n))).toEqual([]);
  });

  it('sends a criterion this device cannot match yet, rather than dropping it', () => {
    // The rubric isn't loaded on this device (attached elsewhere, or still loading).
    _cache.rubrics[CID] = [];
    clearProfCache();
    const LATER = '66666666-6666-4666-8666-666666666669';
    upsertScore(CID, SID, AID, LATER, 3, '2026-09-10', 'summative', '');
    const sent = client.calls.filter(c => c.name === 'upsert_rubric_score');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ p_criterion_id: LATER, p_value: 3 });
    // A competency key is still never sent.
    client.calls = [];
    upsertScore(CID, SID, AID, CI, 2, '2026-09-10', 'summative', '');
    expect(client.calls.map(c => c.name).filter(n => /score/.test(n))).toEqual([]);
  });

  it('never clears criteria when the saved baseline still has competency keys', () => {
    // A copy saved before 2026-10-29: competency-keyed, no server baseline.
    const legacy = [
      { id: 'old-ci', assessmentId: AID, tagId: CI, score: 3, date: '2026-09-10', type: 'summative', note: '' },
      { id: 'old-cp', assessmentId: AID, tagId: CP, score: 4, date: '2026-09-10', type: 'summative', note: '' },
    ];
    localStorage.setItem('gb-scores-' + CID, JSON.stringify({ [SID]: legacy }));
    _cache.scores[CID] = { [SID]: structuredClone(legacy) };
    _forgetServerState(CID);
    client.calls = [];

    upsertScore(CID, SID, AID, CRIT_Q2, 2, '2026-09-10', 'summative', '');
    const rubric = client.calls.filter(c => c.name === 'upsert_rubric_score').map(c => c.payload);
    expect(rubric.map(p => [p.p_criterion_id, p.p_value])).toEqual([[CRIT_Q2, 2]]);
    expect(client.calls.map(c => c.name).filter(n => /score/.test(n))).toEqual(['upsert_rubric_score']);
  });

  it('hydrates a rubric_score row under its criterion', () => {
    const e = _scoreEntryFromCanonical(CID, assessment, CRIT_Q1, 3, '', 1, 'Label axes', null);
    expect(e).toMatchObject({ id: AID + ':' + CRIT_Q1, tagId: CRIT_Q1, score: 3, mod: 1, critNote: 'Label axes' });
  });
});
