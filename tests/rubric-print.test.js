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
    expect(data.studentName).toBe('Ada Lovelace');
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
    // No feedback written: ruled lines to write on, not an empty box.
    expect(html).toContain('rubric-feedback is-lines');
    expect(html).toContain('rubric-lines');
  });

  it('prints written feedback in its box, without lines', () => {
    const data = Object.assign({}, RubricPrint.sheetData(CID, AID, SID), { feedback: 'Clear method.' });
    const html = RubricPrint.renderSheet(data, { include });
    expect(html).toContain('Clear method.');
    expect(html).not.toContain('rubric-lines');
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

  it('a comment on an unscored criterion is saved with no level, then goes up with the level', () => {
    saveRubricCriterionComment(CID, SID2, AID, CRIT_B, 'Speak up.');
    let calls = rubricCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.p_value).toBeNull();
    expect(calls[0].payload.p_comment).toBe('Speak up.');
    expect(getScores(CID)[SID2].find(e => e.tagId === CRIT_B).critNote).toBe('Speak up.');
    expect(RubricPrint.isStudentScored(CID, AID, SID2)).toBe(false);

    upsertScore(CID, SID2, AID, CRIT_B, 3, '2026-10-03', 'summative', '');
    calls = rubricCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1].payload.p_value).toBe(3);
    expect(calls[1].payload.p_comment).toBe('Speak up.');
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
      beyond: null,
    });
  });

  it('reads Went Beyond from the seventh element and saves it on its own', () => {
    const cells = _bundleCells({
      students: [{ enrollment_id: SID }],
      assessments: [{ id: AID }],
      tag_index: [],
      criterion_index: [CRIT_A],
      score_rows: [],
      tag_rows: [],
      criterion_rows: [[0, 0, 0, 3, 0, 'Label axes', 'Added a trend line']],
    });
    expect(cells[SID][AID].rubric_scores[0].beyond).toBe('Added a trend line');
    const entry = _scoreEntryFromCanonical(CID, getAssessments(CID)[0], TAG_1, 3, '', 0, 'Label axes', 'Extra');
    expect(entry.critBeyond).toBe('Extra');

    saveRubricCriterionBeyond(CID, SID, AID, CRIT_A, 'Added a trend line');
    expect(getRubricCriterionBeyond(CID, SID, AID, getRubricById(CID, RUBRIC).criteria[0])).toBe('Added a trend line');
    const calls = rubricCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.p_beyond).toBe('Added a trend line');
    // The comment isn't sent, so the server keeps it.
    expect('p_comment' in calls[0].payload).toBe(false);
    // A level change sends the saved Went Beyond along.
    upsertScore(CID, SID, AID, TAG_1, 4, '2026-10-03', 'summative', '');
    expect(rubricCalls()[1].payload.p_beyond).toBe('Added a trend line');
  });

  it('knows the single-point style', () => {
    expect(rubricStyle({ style: 'single_point' })).toBe('single_point');
    expect(rubricStyle({ style: 'advanced' })).toBe('advanced');
    expect(rubricStyle({ style: 'odd' })).toBe('standard');
    expect(rubricStyle(null)).toBe('standard');
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

/* An assessment with no rubric of its own prints a Tag Rubric (a row per
   competency) or a General Rubric (one Overall row), with the teacher's own
   wording for a competency where saved, else the BC proficiency scale's
   general descriptors: never empty boxes. */
describe('Tag and General Rubrics', () => {
  const AID_TAGS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const AID_GEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const AID_PTS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  beforeEach(() => {
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [
        { id: 'sec1', name: 'Inquiry', tags: [{ id: TAG_1, label: 'Questioning', code: 'QAP' }] },
        { id: 'sec2', name: 'Planning', tags: [{ id: TAG_2, label: 'Planning' }] },
      ],
      _customized: true,
      _flatVersion: 2,
    };
    saveAssessments(CID, [
      { id: AID_TAGS, title: 'Lab write-up', date: '2026-10-03', type: 'summative', tagIds: [TAG_1, TAG_2] },
      { id: AID_GEN, title: 'Reading check', date: '2026-10-03', type: 'summative', tagIds: [] },
      {
        id: AID_PTS,
        title: 'Quiz',
        date: '2026-10-03',
        type: 'summative',
        tagIds: [],
        scoreMode: 'points',
        maxPoints: 10,
      },
    ]);
    saveScores(CID, {
      [SID]: [
        { id: 'g1', assessmentId: AID_TAGS, tagId: TAG_1, score: 3, mod: 1, date: '2026-10-03', note: '' },
        { id: 'g2', assessmentId: AID_GEN, tagId: UNLINKED_TAG_ID, score: 4, date: '2026-10-03', note: '' },
      ],
    });
  });

  it('builds a Tag Rubric from the competencies, with the general wording', () => {
    const r = RubricPrint.defaultRubric(CID, getAssessments(CID)[0]);
    expect(r.name).toBe('Tag Rubric');
    expect(r.criteria.map(c => c.name)).toEqual(['Questioning', 'Planning']);
    expect(r.criteria[0].levels[3]).toBe(RubricPrint.GENERAL_LEVELS[3]);
    expect(RubricPrint.GENERAL_LEVELS[1]).toBe(
      'The student demonstrates an initial understanding of the concepts and competencies relevant to the expected learning.',
    );
  });

  it('prints a competency’s feedback under its Tag Rubric row', () => {
    saveTagComment(CID, SID, AID_TAGS, TAG_1, 'Asks sharp questions.');
    const data = RubricPrint.sheetData(CID, AID_TAGS, SID);
    expect(data.rows[0].comment).toBe('Asks sharp questions.');
    expect(data.rows[1].comment).toBe('');
    const include = { feedback: true, criterionComments: true, codes: true, overall: true };
    expect(RubricPrint.renderSheet(data, { include })).toContain('Asks sharp questions.');
  });

  it('uses the teacher’s own wording for a competency where saved', () => {
    const tag = getTagById(CID, TAG_1);
    localStorage.setItem(
      'gb-competency-descriptors',
      JSON.stringify({ [RubricDraft.competencyKey(tag)]: { 3: 'Asks a testable question.' } }),
    );
    _competencyDescriptors = null;
    const r = RubricPrint.defaultRubric(CID, getAssessments(CID)[0]);
    expect(r.criteria[0].levels[3]).toBe('Asks a testable question.');
    expect(r.criteria[0].levels[4]).toBe(RubricPrint.GENERAL_LEVELS[4]);
    _competencyDescriptors = null;
  });

  it('builds a General Rubric with one Overall row when there are no competencies, and none for points work', () => {
    const r = RubricPrint.defaultRubric(CID, getAssessments(CID)[1]);
    expect(r.name).toBe('General Rubric');
    expect(r.criteria.map(c => c.name)).toEqual(['Overall']);
    expect(RubricPrint.defaultRubric(CID, getAssessments(CID)[2])).toBeNull();
  });

  it('prints the student’s levels on them, and the general wording in every cell', () => {
    const tags = RubricPrint.sheetData(CID, AID_TAGS, SID);
    expect(tags.rows[0]).toMatchObject({ level: 3, mod: 1, codes: ['QAP'] });
    // Named for the competency, so no code means nothing under the name.
    expect(tags.rows[1].codes).toEqual([]);
    const html = RubricPrint.renderSheet(RubricPrint.sheetData(CID, AID_GEN, SID), RubricPrint.DEFAULT_OPTIONS);
    expect(html).toContain('General Rubric');
    expect(html).toContain('a sophisticated understanding');
    expect(html).toMatch(/is-scored l4/);
    expect(RubricPrint.isStudentScored(CID, AID_GEN, SID)).toBe(true);
    expect(RubricPrint.isStudentScored(CID, AID_GEN, SID2)).toBe(false);
  });
});

describe('Print Rubrics layout for picked students', () => {
  it('is a full page for one, two to a page for two, four to a page for three or more', () => {
    expect(RubricPrint.layoutForCount(1)).toBe('full');
    expect(RubricPrint.layoutForCount(2)).toBe('half');
    expect(RubricPrint.layoutForCount(3)).toBe('quarter');
    expect(RubricPrint.layoutForCount(27)).toBe('quarter');
  });
});

describe('Print Rubrics student name', () => {
  const nora = { firstName: 'Eleanor', preferred: 'Nora', lastName: 'Kim' };
  it('prints the preferred name, or the first name, and always the last name', () => {
    expect(RubricPrint.printName(nora, 'preferred')).toBe('Nora Kim');
    expect(RubricPrint.printName(nora, 'first')).toBe('Eleanor Kim');
  });
  it('uses the first name when there is no preferred name', () => {
    expect(RubricPrint.printName({ firstName: 'Alan', lastName: 'Turing' }, 'preferred')).toBe('Alan Turing');
  });
  it('does not repeat a last name the preferred name already has', () => {
    expect(
      RubricPrint.printName({ firstName: 'Robert', preferred: 'Bobby Smith', lastName: 'Smith' }, 'preferred'),
    ).toBe('Bobby Smith');
  });
});

describe('Blank rubrics', () => {
  it('draws a Name line and no levels, scores or feedback', () => {
    const rubric = getRubricById(CID, RUBRIC);
    const data = RubricPrint.blankSheetData(CID, rubric, null);
    expect(data.blank).toBe(true);
    expect(data.rows.every(r => r.level === 0)).toBe(true);
    const html = RubricPrint.renderSheet(data, { include: { codes: true } });
    expect(html).toContain('rubric-name-line');
    expect(html).not.toContain('is-scored');
    expect(html).not.toContain('rubric-feedback');
  });

  it('prints the number of copies asked for, at most 40', () => {
    const base = { mode: 'blank', rubricId: RUBRIC, layout: 'half', include: { codes: true } };
    const out = RubricPrint.renderPages(CID, null, Object.assign({ copies: 5 }, base));
    expect(out).toMatchObject({ sheets: 5, pages: 3 });
    expect(RubricPrint.renderPages(CID, null, Object.assign({ copies: 99 }, base)).sheets).toBe(RubricPrint.MAX_COPIES);
    expect(RubricPrint.renderPages(CID, null, Object.assign({ copies: 0 }, base)).sheets).toBe(1);
  });

  it('uses the assessment for the title and date when there is one', () => {
    const out = RubricPrint.renderPages(CID, AID, { mode: 'blank', copies: 1, layout: 'full', include: {} });
    expect(out.html).toContain('Cell lab');
    expect(out.html).not.toContain('Ada');
  });

  it('lists the assessments that use a rubric, newest first', () => {
    saveAssessments(
      CID,
      getAssessments(CID).concat([{ id: 'later', title: 'Later lab', date: '2026-11-01', rubricId: RUBRIC }]),
    );
    expect(RubricPrint.usesOf(CID, RUBRIC).map(a => a.id)).toEqual(['later', AID]);
  });
});

describe('Advanced Rubric checkboxes on the sheet', () => {
  function makeAdvanced() {
    saveRubrics(
      CID,
      getRubrics(CID).map(r =>
        Object.assign({}, r, {
          style: 'advanced',
          criteria: r.criteria.map((c, i) =>
            i === 0
              ? Object.assign({}, c, {
                  checks: [
                    { id: 'kA', level: 3, label: 'Plans a fair test', displayOrder: 0 },
                    { id: 'kB', level: 3, label: 'Names the variables', displayOrder: 1 },
                  ],
                })
              : c,
          ),
        }),
      ),
    );
  }

  it('prints each box, filled when ticked, when Checkboxes is included', () => {
    makeAdvanced();
    setRubricCheck(CID, SID, AID, 'kA', true);
    const data = RubricPrint.sheetData(CID, AID, SID);
    const html = RubricPrint.renderSheet(data, { include: { checks: true } });
    expect(html).toContain('rubric-check is-on');
    expect(html).toContain('Plans a fair test');
    expect((html.match(/class="rubric-check"/g) || []).length).toBe(1);
    expect(RubricPrint.renderSheet(data, { include: { checks: false } })).not.toContain('rubric-checks');
  });

  it('prints empty boxes on a blank rubric', () => {
    makeAdvanced();
    const out = RubricPrint.renderPages(CID, null, {
      mode: 'blank',
      rubricId: RUBRIC,
      copies: 1,
      layout: 'full',
      include: { checks: true },
    });
    expect(out.html).toContain('Names the variables');
    expect(out.html).not.toContain('is-on');
  });
});
