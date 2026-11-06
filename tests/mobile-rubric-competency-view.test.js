/**
 * The phone's Competencies view on rubric work matches the desktop's
 * (Colin, 2026-11-05): its rows are the competencies the rubric's criteria
 * feed, then any criterion that feeds none, and a level set on a
 * competency goes to every criterion behind it. Before this the phone
 * listed the criteria again, so its Competencies and Rubric views were the
 * same screen.
 */
import './setup-mobile.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const RUBRIC = '55555555-5555-4555-8555-555555555555';
const CRIT_Q1 = '66666666-6666-4666-8666-666666666661';
const CRIT_Q2 = '66666666-6666-4666-8666-666666666662';
const CRIT_Q3 = '66666666-6666-4666-8666-666666666663';
const CRIT_OWN = '66666666-6666-4666-8666-666666666664';
const CI = '88888888-8888-4888-8888-888888888888';
const CP = '99999999-9999-4999-8999-999999999999';
const CW = '77777777-7777-4777-8777-777777777777';

const rubric = {
  id: RUBRIC,
  name: 'Two Ways to Build an Empire',
  criteria: [
    { id: CRIT_Q1, name: 'Continuity and Change', tagIds: [CI], levels: {} },
    { id: CRIT_Q2, name: 'Significance', tagIds: [CI], levels: {} },
    { id: CRIT_Q3, name: 'Evidence', tagIds: [CP], levels: {} },
    { id: CRIT_OWN, name: 'Quality of Answers', tagIds: [], levels: {} },
  ],
};
const assessment = {
  id: AID,
  title: 'Two Ways to Build an Empire',
  date: '2026-09-10',
  type: 'summative',
  tagIds: [CI, CP],
  rubricId: RUBRIC,
};

function seed(scores, rub) {
  saveStudents(CID, [{ id: SID, firstName: 'Owen', lastName: 'Martens' }]);
  saveRubrics(CID, [rub || rubric]);
  saveAssessments(CID, [assessment]);
  saveScores(CID, { [SID]: scores || [] });
  clearProfCache();
}

function levels() {
  return Object.fromEntries(
    (getScores(CID)[SID] || []).filter(e => e.assessmentId === AID).map(e => [e.tagId, [e.score, e.mod || 0]]),
  );
}

beforeEach(() => {
  localStorage.clear();
  ['scores', 'assessments', 'rubrics', 'students', 'statuses'].forEach(function (field) {
    if (_cache[field]) delete _cache[field][CID];
  });
});

describe('Competencies view rows on rubric work', () => {
  it('are the competencies the criteria feed, then a criterion that feeds none', () => {
    seed();
    expect(rubricCompetencyRowKeys(CID, assessment)).toEqual([CI, CP, CRIT_OWN]);
  });

  it('leave out a whole-rubric competency', () => {
    seed([], Object.assign({}, rubric, { tagIds: [CW] }));
    expect(rubricCompetencyRowKeys(CID, assessment)).toEqual([CI, CP, CRIT_OWN]);
    expect(rubricRowScoreKeys(CID, assessment, CW)).toEqual([]);
  });

  it('save a competency under each criterion that feeds it', () => {
    seed();
    expect(rubricRowScoreKeys(CID, assessment, CI)).toEqual([CRIT_Q1, CRIT_Q2]);
    expect(rubricRowScoreKeys(CID, assessment, CRIT_OWN)).toEqual([CRIT_OWN]);
  });
});

describe('scoring a competency on the phone', () => {
  it('writes the level to every criterion behind it, never to the competency', () => {
    seed();
    MGrade.setScore(CID, SID, AID, CI, 3);
    expect(levels()).toEqual({ [CRIT_Q1]: [3, 0], [CRIT_Q2]: [3, 0] });
    expect(competencyLevelFromCriteria(CID, SID, assessment, CI)).toEqual({ score: 3, mod: 0, mixed: false });
  });

  it('clears every criterion when the active level is tapped again', () => {
    seed();
    MGrade.setScore(CID, SID, AID, CI, 3);
    MGrade.setScore(CID, SID, AID, CI, 3);
    expect(levels()[CRIT_Q1][0]).toBe(0);
    expect(levels()[CRIT_Q2][0]).toBe(0);
  });

  it('sets a level over mixed criteria instead of clearing them', () => {
    seed([
      { id: 'q1', assessmentId: AID, tagId: CRIT_Q1, score: 4, date: '2026-09-10', type: 'summative', note: '' },
      { id: 'q2', assessmentId: AID, tagId: CRIT_Q2, score: 2, date: '2026-09-10', type: 'summative', note: '' },
    ]);
    MGrade.setScore(CID, SID, AID, CI, 2);
    expect(levels()[CRIT_Q1]).toEqual([2, 0]);
    expect(levels()[CRIT_Q2]).toEqual([2, 0]);
  });

  it('puts + and − on every criterion, and not on mixed ones', () => {
    seed();
    MGrade.setScore(CID, SID, AID, CI, 3);
    MGrade.setScoreMod(CID, SID, AID, CI, 1);
    expect(levels()[CRIT_Q1]).toEqual([3, 1]);
    expect(levels()[CRIT_Q2]).toEqual([3, 1]);
    seed([
      { id: 'q1', assessmentId: AID, tagId: CRIT_Q1, score: 4, date: '2026-09-10', type: 'summative', note: '' },
      { id: 'q2', assessmentId: AID, tagId: CRIT_Q2, score: 2, date: '2026-09-10', type: 'summative', note: '' },
    ]);
    MGrade.setScoreMod(CID, SID, AID, CI, 1);
    expect(levels()[CRIT_Q1]).toEqual([4, 0]);
    expect(levels()[CRIT_Q2]).toEqual([2, 0]);
  });

  it('scores a criterion that feeds no competency on its own', () => {
    seed();
    MGrade.setScore(CID, SID, AID, CRIT_OWN, 4);
    expect(levels()).toEqual({ [CRIT_OWN]: [4, 0] });
  });

  it('undoes a competency level on all its criteria at once', () => {
    seed();
    MGrade.setScore(CID, SID, AID, CI, 3);
    expect(levels()[CRIT_Q1]).toEqual([3, 0]);
    expect(levels()[CRIT_Q2]).toEqual([3, 0]);
    MGrade.undoLastScore();
    const after = levels();
    expect(after[CRIT_Q1] ? after[CRIT_Q1][0] : 0).toBe(0);
    expect(after[CRIT_Q2] ? after[CRIT_Q2][0] : 0).toBe(0);
  });
});
