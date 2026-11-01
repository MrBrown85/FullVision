/**
 * The overall comment on a piece of work (score.comment, cached as `note`
 * on the student's score entries). The comment field under a student's
 * criteria shows and edits it through getScoreComment / saveScoreComment,
 * before or after any level is picked.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const SID2 = '44444444-4444-4444-8444-444444444444';
const TAG_1 = '88888888-8888-4888-8888-888888888888';
const TAG_2 = '99999999-9999-4999-8999-999999999999';
const RUBRIC_AID = '55555555-5555-4555-8555-555555555555';
const POINTS_AID = '66666666-6666-4666-8666-666666666666';
const RUBRIC_ID = '77777777-7777-4777-8777-777777777777';
const CRIT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CRIT_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function seedClass() {
  saveStudents(CID, [
    { id: SID, firstName: 'Ada', lastName: 'Lovelace' },
    { id: SID2, firstName: 'Alan', lastName: 'Turing' },
  ]);
  saveRubrics(CID, [
    {
      id: RUBRIC_ID,
      name: 'Lab Rubric',
      criteria: [
        { id: CRIT_1, name: 'Inquiry', tagIds: [TAG_1], levels: {} },
        { id: CRIT_2, name: 'Analysis', tagIds: [TAG_2], levels: {} },
      ],
    },
  ]);
  saveAssessments(CID, [
    { id: AID, title: 'Levels lab', date: '2026-10-03', type: 'summative', tagIds: [TAG_1, TAG_2], rubricId: '' },
    {
      id: RUBRIC_AID,
      title: 'Rubric lab',
      date: '2026-10-04',
      type: 'summative',
      tagIds: [TAG_1, TAG_2],
      rubricId: RUBRIC_ID,
    },
    { id: POINTS_AID, title: 'Quiz', date: '2026-10-05', type: 'summative', tagIds: [TAG_1], scoreMode: 'points' },
  ]);
  saveScores(CID, {
    [SID]: [
      { id: 'e1', assessmentId: AID, tagId: TAG_1, score: 3, date: '2026-10-03', type: 'summative', note: 'Good lab.' },
      { id: 'e2', assessmentId: AID, tagId: TAG_2, score: 2, date: '2026-10-03', type: 'summative', note: 'Good lab.' },
    ],
  });
}

describe('overall comment', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'students', 'rubrics'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    seedClass();
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
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  const commentCalls = () => client.calls.filter(c => c.name === 'save_score_comment');

  it('reads the note on the student’s score', () => {
    expect(getScoreComment(CID, SID, AID)).toBe('Good lab.');
    expect(getScoreComment(CID, SID2, AID)).toBe('');
  });

  it('saves an edit to every entry and sends save_score_comment', () => {
    saveScoreComment(CID, SID, AID, '  Label the axes.  ');
    expect(getScoreComment(CID, SID, AID)).toBe('Label the axes.');
    getScores(CID)[SID].forEach(function (e) {
      expect(e.note).toBe('Label the axes.');
    });
    expect(commentCalls()).toHaveLength(1);
    expect(commentCalls()[0].payload).toEqual({
      p_enrollment_id: SID,
      p_assessment_id: AID,
      p_comment: 'Label the axes.',
    });
  });

  it('clears the comment with an empty string', () => {
    saveScoreComment(CID, SID, AID, '');
    expect(getScoreComment(CID, SID, AID)).toBe('');
    expect(commentCalls()[0].payload.p_comment).toBe('');
  });

  it('does nothing when the text is unchanged', () => {
    saveScoreComment(CID, SID, AID, 'Good lab.');
    expect(commentCalls()).toHaveLength(0);
  });

  it('saves a comment on work with no level yet, on an unscored entry', () => {
    saveScoreComment(CID, SID2, AID, 'Hello');
    expect(getScoreComment(CID, SID2, AID)).toBe('Hello');
    var entries = getScores(CID)[SID2].filter(e => e.assessmentId === AID);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tagId: TAG_1, score: 0, note: 'Hello' });
    expect(commentCalls()).toHaveLength(1);
    expect(commentCalls()[0].payload).toEqual({ p_enrollment_id: SID2, p_assessment_id: AID, p_comment: 'Hello' });
  });

  it('keys a rubric comment with no level by the first criterion', () => {
    saveScoreComment(CID, SID2, RUBRIC_AID, 'Strong start.');
    var entries = getScores(CID)[SID2].filter(e => e.assessmentId === RUBRIC_AID);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tagId: CRIT_1, score: 0, note: 'Strong start.' });
    expect(getScoreComment(CID, SID2, RUBRIC_AID)).toBe('Strong start.');
  });

  it('adds no entry for an empty comment on work with no level', () => {
    saveScoreComment(CID, SID2, AID, '   ');
    expect((getScores(CID)[SID2] || []).filter(e => e.assessmentId === AID)).toHaveLength(0);
    expect(commentCalls()).toHaveLength(0);
  });

  it('still needs a score first on points work, where an entry of 0 is a score', () => {
    expect(saveScoreComment(CID, SID2, POINTS_AID, 'Hello')).toBe(false);
    expect((getScores(CID)[SID2] || []).filter(e => e.assessmentId === POINTS_AID)).toHaveLength(0);
    expect(commentCalls()).toHaveLength(0);
  });

  it('keeps the comment when a level is picked afterwards', () => {
    saveScoreComment(CID, SID2, RUBRIC_AID, 'Strong start.');
    upsertScore(CID, SID2, RUBRIC_AID, CRIT_1, 3, '2026-10-04', 'summative', '', 1);
    upsertScore(CID, SID2, RUBRIC_AID, CRIT_2, 2, '2026-10-04', 'summative', '');
    expect(getScoreComment(CID, SID2, RUBRIC_AID)).toBe('Strong start.');
    var crit1 = getScores(CID)[SID2].find(e => e.assessmentId === RUBRIC_AID && e.tagId === CRIT_1);
    expect(crit1).toMatchObject({ score: 3, mod: 1, note: 'Strong start.' });
  });

  it('keeps an existing comment when a level changes', () => {
    upsertScore(CID, SID, AID, TAG_1, 4, '2026-10-03', 'summative', '');
    getScores(CID)[SID].forEach(function (e) {
      expect(e.note).toBe('Good lab.');
    });
  });
});

describe('loading an overall comment saved before any level', () => {
  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'students', 'rubrics'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    seedClass();
  });

  const assessments = () => getAssessments(CID);

  it('keeps a comment-only score row on rubric work under the first criterion', () => {
    var out = _gradebookCellsToScoreCache(CID, assessments(), {
      [SID2]: { [RUBRIC_AID]: { score: { value: null, comment: 'Strong start.' }, tag_scores: [], rubric_scores: [] } },
    });
    expect(out.scores[SID2]).toHaveLength(1);
    expect(out.scores[SID2][0]).toMatchObject({
      assessmentId: RUBRIC_AID,
      tagId: CRIT_1,
      score: 0,
      note: 'Strong start.',
    });
  });

  it('keeps a comment-only score row on competency work under its first competency', () => {
    var out = _gradebookCellsToScoreCache(CID, assessments(), {
      [SID2]: { [AID]: { score: { value: null, comment: 'Hello' }, tag_scores: [], rubric_scores: [] } },
    });
    expect(out.scores[SID2][0]).toMatchObject({ tagId: TAG_1, score: 0, note: 'Hello' });
  });

  it('adds no unscored entry on points work', () => {
    var out = _gradebookCellsToScoreCache(CID, assessments(), {
      [SID2]: { [POINTS_AID]: { score: { value: null, comment: 'Hello' }, tag_scores: [], rubric_scores: [] } },
    });
    expect(out.scores[SID2]).toBeUndefined();
  });

  it('adds nothing for a score row with no level and no comment', () => {
    var out = _gradebookCellsToScoreCache(CID, assessments(), {
      [SID2]: { [AID]: { score: { value: null, comment: null, status: 'LATE' }, tag_scores: [], rubric_scores: [] } },
    });
    expect(out.scores[SID2]).toBeUndefined();
    expect(out.statuses[SID2 + ':' + AID]).toBe('LATE');
  });
});
