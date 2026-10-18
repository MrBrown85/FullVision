/**
 * Printable graded rubric handouts — teacher/rubric-print.js, and the
 * criterion comment it prints (shared/data.js: rubric_score.comment).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const SID2 = '44444444-4444-4444-8444-444444444444';
const RUBRIC = '55555555-5555-4555-8555-555555555555';
const CRIT_A = '66666666-6666-4666-8666-666666666666';
const CRIT_B = '77777777-7777-4777-8777-777777777777';
const TAG_1 = '88888888-8888-4888-8888-888888888888';
const TAG_2 = '99999999-9999-4999-8999-999999999999';

function seedClass() {
  saveStudents(CID, [
    { id: SID, firstName: 'Ada', lastName: 'Lovelace', preferred: 'Ada' },
    { id: SID2, firstName: 'Alan', lastName: 'Turing' },
  ]);
  saveRubrics(CID, [
    {
      id: RUBRIC,
      name: 'Lab rubric',
      criteria: [
        {
          id: CRIT_A,
          name: 'Inquiry',
          tagIds: [TAG_1, TAG_2],
          levels: { 4: 'Designs a fair test alone.', 3: 'Plans a fair test.', 2: 'Follows a plan.', 1: 'Needs help.' },
        },
        {
          id: CRIT_B,
          name: 'Communication',
          tagIds: [],
          levels: { 4: 'Clear and precise.', 3: 'Clear.', 2: 'Mostly clear.', 1: 'Hard to follow.' },
        },
      ],
    },
  ]);
  saveAssessments(CID, [
    { id: AID, title: 'Cell lab', date: '2026-10-03', type: 'summative', tagIds: [TAG_1, TAG_2], rubricId: RUBRIC },
  ]);
  saveScores(CID, {
    [SID]: [
      { id: 'e1', assessmentId: AID, tagId: TAG_1, score: 3, mod: 1, date: '2026-10-03', type: 'summative', note: '' },
      { id: 'e2', assessmentId: AID, tagId: TAG_2, score: 3, mod: 1, date: '2026-10-03', type: 'summative', note: '' },
      { id: 'e3', assessmentId: AID, tagId: CRIT_B, score: 2, date: '2026-10-03', type: 'summative', note: '' },
    ],
  });
}

beforeEach(() => {
  localStorage.clear();
  ['scores', 'assessments', 'rubrics', 'students'].forEach(function (field) {
    if (_cache[field]) delete _cache[field][CID];
  });
  seedClass();
});

describe('criterionLevel', () => {
  it('takes the shared level and ± when the competencies agree', () => {
    const rubric = getRubricById(CID, RUBRIC);
    const lv = RubricPrint.criterionLevel(getScores(CID)[SID], AID, rubric.criteria[0]);
    expect(lv).toEqual({ level: 3, mod: 1, mixed: false });
  });

  it('takes the lowest level, marked mixed and with no ±, when they disagree', () => {
    const rubric = getRubricById(CID, RUBRIC);
    const entries = [
      { assessmentId: AID, tagId: TAG_1, score: 4, mod: 0 },
      { assessmentId: AID, tagId: TAG_2, score: 2, mod: -1 },
    ];
    expect(RubricPrint.criterionLevel(entries, AID, rubric.criteria[0])).toEqual({ level: 2, mod: 0, mixed: true });
  });

  it('is unscored with no entries', () => {
    const rubric = getRubricById(CID, RUBRIC);
    expect(RubricPrint.criterionLevel([], AID, rubric.criteria[1]).level).toBe(0);
  });
});

describe('selectStudents and pageCount', () => {
  it('"all scored" keeps only students with a level on some criterion', () => {
    const scored = RubricPrint.selectStudents(CID, AID, { students: 'scored' });
    expect(scored.map(s => s.id)).toEqual([SID]);
    expect(RubricPrint.selectStudents(CID, AID, { students: 'all' })).toHaveLength(2);
    expect(RubricPrint.selectStudents(CID, AID, { students: 'pick', picked: [SID2] }).map(s => s.id)).toEqual([SID2]);
  });

  it('27 students take 27 full pages, 14 half-sheet pages and 7 quarter-sheet pages', () => {
    expect(RubricPrint.pageCount(27, 'full')).toBe(27);
    expect(RubricPrint.pageCount(27, 'half')).toBe(14);
    expect(RubricPrint.pageCount(27, 'quarter')).toBe(7);
  });

  it('sheet boxes fill letter paper inside the page margin', () => {
    const L = RubricPrint.LAYOUTS;
    expect(L.full.pageWidth + 2 * L.full.margin).toBe(8.5);
    expect(L.full.pageHeight + 2 * L.full.margin).toBe(11);
    expect(L.half.pageWidth + 2 * L.half.margin).toBeCloseTo(11, 5);
    expect(L.half.pageHeight + 2 * L.half.margin).toBeCloseTo(8.5, 5);
    expect(L.quarter.pageWidth + 2 * L.quarter.margin).toBeCloseTo(8.5, 5);
    expect(L.quarter.pageHeight + 2 * L.quarter.margin).toBeCloseTo(11, 5);
    expect(L.full.fontPt).toBeGreaterThan(L.half.fontPt);
    expect(L.half.fontPt).toBeGreaterThan(L.quarter.fontPt);
  });
});

describe('sheetData and renderSheet', () => {
  const include = { feedback: true, criterionComments: true, codes: true, overall: true };

  it('shades the scored cell with its ± mark and prints the descriptors', () => {
    const data = RubricPrint.sheetData(CID, AID, SID);
    expect(data.scored).toBe(true);
    expect(data.studentName).toBe('Ada');
    expect(data.rows[0].level).toBe(3);
    const html = RubricPrint.renderSheet(data, { include });
    expect(html).toContain('class="rubric-cell is-scored l3"');
    expect(html).toContain('✓+');
    expect(html).toContain('Plans a fair test.');
    expect(html).toContain('Designs a fair test alone.');
    expect(html).toContain('class="rubric-cell is-scored l2"');
    expect(html).toContain('Cell lab');
    expect(html).toContain('Oct 3, 2026');
  });

  it('prints a blank rubric for an unscored student', () => {
    const data = RubricPrint.sheetData(CID, AID, SID2);
    expect(data.scored).toBe(false);
    expect(data.overall).toBeNull();
    const html = RubricPrint.renderSheet(data, { include });
    expect(html).not.toContain('is-scored');
    expect(html).toContain('Alan Turing');
    expect(html).toContain('rubric-feedback is-empty');
  });

  it('prints the criterion comment under its row and leaves it out when not included', () => {
    saveRubricCriterionComment(CID, SID, AID, CRIT_A, 'Label the variables next time.');
    const data = RubricPrint.sheetData(CID, AID, SID);
    expect(data.rows[0].comment).toBe('Label the variables next time.');
    expect(RubricPrint.renderSheet(data, { include })).toContain('Label the variables next time.');
    expect(
      RubricPrint.renderSheet(data, { include: Object.assign({}, include, { criterionComments: false }) }),
    ).not.toContain('Label the variables next time.');
  });

  it('shows the overall level through calc.js and hides it when not included', () => {
    const data = RubricPrint.sheetData(CID, AID, SID);
    expect(data.overall).not.toBeNull();
    expect(data.overall.text).toBe(formatLevel(CID, data.overall.value));
    const html = RubricPrint.renderSheet(data, { include });
    expect(html).toContain('rubric-overall-value');
    expect(RubricPrint.renderSheet(data, { include: Object.assign({}, include, { overall: false }) })).not.toContain(
      'rubric-overall-value',
    );
  });

  it('escapes names and descriptors', () => {
    saveStudents(CID, [{ id: SID, firstName: '<b>Ada</b>', lastName: '' }]);
    const html = RubricPrint.renderSheet(RubricPrint.sheetData(CID, AID, SID), { include });
    expect(html).not.toContain('<b>Ada</b>');
    expect(html).toContain('&lt;b&gt;Ada&lt;/b&gt;');
  });

  it('renderPages groups sheets per page by layout and pads the last page', () => {
    const out = RubricPrint.renderPages(CID, AID, { students: 'all', layout: 'quarter', include });
    expect(out.sheets).toBe(2);
    expect(out.pages).toBe(1);
    expect(out.html.match(/class="rubric-page layout-quarter"/g)).toHaveLength(1);
    expect(out.html.match(/rubric-sheet is-blank/g)).toHaveLength(2);
  });
});

describe('criterion comments in the data layer', () => {
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
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  function rubricCalls() {
    return client.calls.filter(c => c.name === 'upsert_rubric_score');
  }

  it('stores the comment on every key of a scored criterion and sends it with the level', () => {
    saveRubricCriterionComment(CID, SID, AID, CRIT_A, 'Good control of variables.');
    const entries = getScores(CID)[SID];
    expect(entries.find(e => e.tagId === TAG_1).critNote).toBe('Good control of variables.');
    expect(entries.find(e => e.tagId === TAG_2).critNote).toBe('Good control of variables.');
    expect(getRubricCriterionComment(CID, SID, AID, getRubricById(CID, RUBRIC).criteria[0])).toBe(
      'Good control of variables.',
    );
    const calls = rubricCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.p_criterion_id).toBe(CRIT_A);
    expect(calls[0].payload.p_value).toBe(3);
    expect(calls[0].payload.p_modifier).toBe(1);
    expect(calls[0].payload.p_comment).toBe('Good control of variables.');
  });

  it('clearing sends an empty string, which the server reads as "remove"', () => {
    saveRubricCriterionComment(CID, SID, AID, CRIT_A, 'Note');
    saveRubricCriterionComment(CID, SID, AID, CRIT_A, '');
    expect(getScores(CID)[SID].find(e => e.tagId === TAG_1).critNote).toBeUndefined();
    const calls = rubricCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1].payload.p_comment).toBe('');
  });

  it('a comment on an unscored criterion waits locally and goes up with the level', () => {
    saveRubricCriterionComment(CID, SID2, AID, CRIT_B, 'Speak up.');
    expect(rubricCalls()).toHaveLength(0);
    expect(getScores(CID)[SID2].find(e => e.tagId === CRIT_B).critNote).toBe('Speak up.');
    expect(RubricPrint.isStudentScored(CID, AID, SID2)).toBe(false);

    upsertScore(CID, SID2, AID, CRIT_B, 3, '2026-10-03', 'summative', '');
    const calls = rubricCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.p_value).toBe(3);
    expect(calls[0].payload.p_comment).toBe('Speak up.');
  });

  it('a level change on a criterion with no comment sends null, which keeps the saved one', () => {
    upsertScore(CID, SID, AID, TAG_1, 4, '2026-10-03', 'summative', '');
    const calls = rubricCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.p_comment).toBeNull();
  });

  it('reads the comment from the class bundle criterion_rows sixth element', () => {
    const cells = _bundleCells({
      students: [{ enrollment_id: SID }],
      assessments: [{ id: AID }],
      tag_index: [],
      criterion_index: [CRIT_A],
      score_rows: [],
      tag_rows: [],
      criterion_rows: [[0, 0, 0, 3, 1, 'Nice work']],
    });
    expect(cells[SID][AID].rubric_scores[0]).toEqual({
      criterion_id: CRIT_A,
      value: 3,
      modifier: 1,
      comment: 'Nice work',
    });
  });

  it('fans the server comment out to each score key and drops it when the server clears it', () => {
    const assessment = getAssessments(CID)[0];
    const withComment = _scoreEntryFromCanonical(CID, assessment, TAG_1, 3, '', 1, 'From server');
    expect(withComment.critNote).toBe('From server');
    const scores = {};
    _pushHydratedScore(scores, SID, withComment);
    _pushHydratedScore(scores, SID, _scoreEntryFromCanonical(CID, assessment, TAG_1, 3, '', 1, null));
    expect(scores[SID]).toHaveLength(1);
    expect(scores[SID][0].critNote).toBeUndefined();
  });
});
