/**
 * rubric: the tests that were tests/rubric-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, signIn, seedClass, clearClass, stored, settle } from './helpers/pin-save-paths.js';

describe('rubric-bank-stats', () => {
  /**
   * Rubric Bank class stats (teacher/rubric-bank.js): per criterion, one level
   * per student per assessment; excused students left out; a custom-criteria
   * rubric also counts each student's overall level. Teacher only.
   */

  const CID = 'cls-bank-stats';
  const A1 = 'as-1';
  const A2 = 'as-2';
  const S1 = 'st-1';
  const S2 = 'st-2';
  const S3 = 'st-3';

  function entry(aid, tagId, score, mod) {
    return { assessmentId: aid, tagId: tagId, score: score, mod: mod || 0, type: 'summative', note: '' };
  }

  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'rubrics', 'students', 'statuses'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
    saveStudents(CID, [
      { id: S1, firstName: 'Ada', lastName: 'A' },
      { id: S2, firstName: 'Ben', lastName: 'B' },
      { id: S3, firstName: 'Cy', lastName: 'C' },
    ]);
    saveRubrics(CID, [
      {
        id: 'r-comp',
        name: 'Lab',
        criteria: [{ id: 'c-inq', name: 'Inquiry', tagIds: ['t1', 't2'], levels: { 4: '', 3: '', 2: '', 1: '' } }],
      },
      {
        id: 'r-custom',
        name: 'Talk',
        criteria: [
          { id: 'c-content', name: 'Content', tagIds: [], levels: { 4: '', 3: '', 2: '', 1: '' } },
          { id: 'c-voice', name: 'Delivery', tagIds: [], levels: { 4: '', 3: '', 2: '', 1: '' } },
        ],
      },
    ]);
    saveAssessments(CID, [
      { id: A1, title: 'Lab 1', date: '2026-09-10', type: 'summative', tagIds: ['t1', 't2'], rubricId: 'r-comp' },
      { id: A2, title: 'Lab 2', date: '2026-10-10', type: 'summative', tagIds: ['t1', 't2'], rubricId: 'r-comp' },
      { id: 'as-talk', title: 'Talks', date: '2026-10-12', type: 'summative', tagIds: [], rubricId: 'r-custom' },
    ]);
    saveScores(CID, {
      // A criterion linked to two competencies counts once.
      [S1]: [entry(A1, 't1', 3, 1), entry(A1, 't2', 3, 1), entry(A2, 't1', 4), entry(A2, 't2', 4)],
      [S2]: [entry(A1, 't1', 2), entry(A1, 't2', 2), entry('as-talk', 'c-content', 4), entry('as-talk', 'c-voice', 3)],
      [S3]: [entry(A1, 't1', 1), entry(A1, 't2', 1), entry('as-talk', 'c-content', 2), entry('as-talk', 'c-voice', 2)],
    });
  });

  describe('Rubric Bank class stats', () => {
    it('counts one level per student per assessment, ignoring + and −', () => {
      var s = RubricBank.classStats(CID, getRubricById(CID, 'r-comp'));
      expect(s.assessments).toBe(2);
      expect(s.scores).toBe(4);
      expect(s.byCrit['c-inq']).toEqual({ 4: 1, 3: 1, 2: 1, 1: 1 });
      expect(s.custom).toBe(false);
      expect(s.overallCount).toBe(0);
    });

    it('narrows to one assessment', () => {
      var s = RubricBank.classStats(CID, getRubricById(CID, 'r-comp'), A2);
      expect(s.assessments).toBe(1);
      expect(s.byCrit['c-inq']).toEqual({ 4: 1, 3: 0, 2: 0, 1: 0 });
    });

    it('leaves excused students out', () => {
      // Excused can't be set on scored work any more, but older data has both.
      saveAssignmentStatuses(CID, { [S3 + ':' + A1]: 'EXC' });
      var s = RubricBank.classStats(CID, getRubricById(CID, 'r-comp'), A1);
      expect(s.byCrit['c-inq']).toEqual({ 4: 0, 3: 1, 2: 1, 1: 0 });
    });

    it('counts overall levels for a custom-criteria rubric', () => {
      var r = getRubricById(CID, 'r-custom');
      expect(RubricBank.isCustomCriteria(r)).toBe(true);
      expect(RubricBank.isCustomCriteria(getRubricById(CID, 'r-comp'))).toBe(false);
      var s = RubricBank.classStats(CID, r);
      expect(s.custom).toBe(true);
      expect(s.overallCount).toBe(2);
      expect(s.overall[2]).toBe(1);
      expect(s.overall[4] + s.overall[3]).toBe(1);
    });

    it('draws the pie and its label in the class level order, skipping empty levels', () => {
      var counts = { 4: 1, 3: 3, 2: 0, 1: 0 };
      expect(RubricBank.pieBackground(CID, counts)).toBe(
        'conic-gradient(var(--score-4) 0.00% 25.00%, var(--score-3) 25.00% 100.00%)',
      );
      expect(RubricBank.countsText(CID, counts)).toBe('Extending 1, Proficient 3, Developing 0, Emerging 0');
      saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { levelOrder: 'asc' }));
      expect(RubricBank.countsText(CID, counts)).toBe('Emerging 0, Developing 0, Proficient 3, Extending 1');
      expect(RubricBank.pieBackground(CID, { 4: 0, 3: 0, 2: 0, 1: 0 })).toBe('');
    });
  });
});

describe('rubric-bank', () => {
  /**
   * The Rubric Bank window (teacher/rubric-bank.js): the list groups rubrics
   * by whether an assessment uses them, search matches names and linked
   * competencies, the grid follows the class's level order, and Duplicate and
   * Rename save within the class.
   */

  const A = 'cls-bank-a';
  const B = 'cls-bank-b';

  function seedClass(cid, opts) {
    _cache.categories[cid] = [];
    _cache.learningMaps[cid] = {
      subjects: [],
      sections: [
        {
          id: cid + '-s1',
          name: 'Questioning',
          color: '#123456',
          tags: [
            { id: cid + '-t1', label: 'Questioning and Predicting', text: 'Ask questions' },
            { id: cid + '-t2', label: 'Planning and Conducting', text: 'Plan' },
          ],
        },
      ],
      _customized: true,
      _version: 1,
    };
    _cache.rubrics[cid] = opts.rubrics || [];
    _cache.modules[cid] = [];
    _cache.assessments[cid] = opts.assessments || [];
  }

  function rubric(id, name, tagIds, extra) {
    return Object.assign(
      {
        id: id,
        name: name,
        criteria: [
          {
            id: id + '-c1',
            name: 'Question and Prediction',
            tagIds: tagIds,
            weight: 1,
            levels: { 4: 'Explains why', 3: 'Predicts', 2: 'Asks', 1: 'Asks with help' },
          },
        ],
      },
      extra || {},
    );
  }

  describe('Rubric Bank', () => {
    beforeEach(() => {
      localStorage.clear();
      _useSupabase = false;
      globalThis.initData = () => Promise.resolve();
      saveCourses({
        [A]: { id: A, name: 'Science 8' },
        [B]: { id: B, name: 'Science 8 Block D' },
      });
      seedClass(A, {
        rubrics: [
          rubric('r-lab', 'Lab Investigation Rubric', [A + '-t1'], { copyGroup: 'g1' }),
          rubric('r-graph', 'Graphing Rubric', [A + '-t2']),
          rubric('r-talk', 'Presentation Rubric', []),
        ],
        assessments: [
          { id: 'a1', title: 'Density Lab', date: '2026-09-18', rubricId: 'r-lab' },
          { id: 'a2', title: 'Pendulum Lab', date: '2026-10-02', rubricId: 'r-lab' },
          { id: 'a3', title: 'Talks', date: '2026-10-05', rubricId: 'r-talk' },
        ],
      });
      seedClass(B, { rubrics: [rubric('r-lab-b', 'Lab Investigation Rubric', [B + '-t1'], { copyGroup: 'g1' })] });
    });

    it('lists used rubrics before unused ones', () => {
      var g = RubricBank.groups(A, '');
      expect(g.used.map(r => r.id)).toEqual(['r-lab', 'r-talk']);
      expect(g.unused.map(r => r.id)).toEqual(['r-graph']);
    });

    it('lists the assessments that use a rubric, newest first', () => {
      expect(RubricBank.usesOf(A, 'r-lab').map(a => a.id)).toEqual(['a2', 'a1']);
      expect(RubricBank.rowMeta(A, getRubricById(A, 'r-lab'))).toBe('1 Criterion · 2 Assessments');
      expect(RubricBank.rowMeta(A, getRubricById(A, 'r-graph'))).toBe('1 Criterion · Not Used');
    });

    it('searches rubric names and linked competencies', () => {
      expect(RubricBank.groups(A, 'graph').unused.map(r => r.id)).toEqual(['r-graph']);
      var byCompetency = RubricBank.groups(A, 'planning');
      expect(byCompetency.used.length + byCompetency.unused.length).toBe(1);
      expect(byCompetency.unused[0].id).toBe('r-graph');
      var none = RubricBank.groups(A, 'zzz');
      expect(none.used.length + none.unused.length).toBe(0);
    });

    it('names the class a linked copy lives in', () => {
      expect(RubricBank.linkedLabel(A, getRubricById(A, 'r-lab'))).toBe('Linked With Science 8 Block D');
      expect(RubricBank.linkedLabel(A, getRubricById(A, 'r-graph'))).toBe('');
    });

    it('draws the grid in the class level order', () => {
      var r = getRubricById(A, 'r-lab');
      var desc = RubricBank.gridHtml(A, r);
      expect(desc.indexOf('Extending')).toBeLessThan(desc.indexOf('Emerging'));
      saveCourseConfig(A, Object.assign({}, getCourseConfig(A), { levelOrder: 'asc' }));
      var asc = RubricBank.gridHtml(A, r);
      expect(asc.indexOf('Emerging')).toBeLessThan(asc.indexOf('Extending'));
      expect(asc).toContain('Questioning and Predicting');
      expect(asc).toContain('Weight 1');
    });

    it('duplicates within the class with a numbered name and no link', () => {
      var copy = RubricBank.duplicate(A, 'r-lab');
      expect(copy.name).toBe('Lab Investigation Rubric (2)');
      expect(copy.copyGroup).toBeUndefined();
      expect(copy.id).not.toBe('r-lab');
      expect(copy.criteria[0].id).not.toBe('r-lab-c1');
      expect(getRubrics(A).length).toBe(4);
    });

    it('renames, refusing blanks and names another rubric has', () => {
      expect(RubricBank.rename(A, 'r-graph', '   ')).toBe(false);
      expect(RubricBank.rename(A, 'r-graph', 'lab investigation rubric')).toBe(false);
      expect(RubricBank.rename(A, 'r-graph', 'Data and Graphing Rubric')).toBe(true);
      expect(getRubricById(A, 'r-graph').name).toBe('Data and Graphing Rubric');
    });

    it('lists the other live classes', () => {
      expect(RubricBank.otherClasses(A).map(c => c.id)).toEqual([B]);
    });

    it('counts how many competencies match another class by name', () => {
      var lab = getRubricById(A, 'r-lab');
      expect(RubricBank.matchInfo(A, B, lab)).toEqual({ total: 1, matched: 1, byTag: { [A + '-t1']: true } });
      _cache.learningMaps[B].sections[0].tags[0].label = 'Something Else';
      _cache.learningMaps[B].sections[0].tags[0].text = 'Something else';
      var after = RubricBank.matchInfo(A, B, lab);
      expect(after.matched).toBe(0);
      expect(after.byTag[A + '-t1']).toBe(false);
    });

    it('marks chips with no match when showing another class rubric', () => {
      _cache.learningMaps[A].sections[0].tags[0].label = 'Something Else';
      _cache.learningMaps[A].sections[0].tags[0].text = 'Something else';
      var src = getRubricById(B, 'r-lab-b');
      var match = RubricBank.matchInfo(B, A, src);
      var html = RubricBank.gridHtml(A, src, { srcCid: B, match: match });
      expect(html).toContain('rb-chip is-missing');
      expect(html).toContain('Questioning and Predicting');
    });
  });

  describe('Rubric Bank, Advanced Rubrics', () => {
    it('draws each level’s checkboxes under its descriptor', () => {
      var r = {
        id: 'r-adv',
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [
          {
            id: 'c1',
            name: 'Safety',
            tagIds: [],
            levels: { 4: 'Leads', 3: 'Follows', 2: 'Reminded', 1: 'Often reminded' },
            checks: [
              { id: 'k1', level: 3, label: 'Goggles on', displayOrder: 0 },
              { id: 'k2', level: 4, label: 'Reminds others', displayOrder: 0 },
            ],
          },
        ],
      };
      expect(RubricBank.isAdvanced(r)).toBe(true);
      var html = RubricBank.gridHtml('cls-adv-only', r);
      expect(html).toContain('rb-cell-checks');
      expect(html.indexOf('Reminds others')).toBeLessThan(html.indexOf('Goggles on'));
      expect(RubricBank.isAdvanced(Object.assign({}, r, { style: 'standard' }))).toBe(false);
    });
  });
});

describe('rubric-criterion-own-scores', () => {
  /**
   * Each rubric criterion keeps its own score, under its criterion id
   * (docs/DECISIONS.md, "Rubric criteria score on their own"). Two criteria on
   * one competency used to share one slot keyed by the competency, so scoring
   * one changed the other (Colin, 2026-10-29: "Rubric criterion are
   * influencing each other???"). A criterion's score now rolls up to each of
   * its competencies as its own evidence, and older competency-keyed saves
   * are moved to criterion keys when read.
   */

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

    it('is downloaded again from any earlier schema; only a copy this code saved is reused', () => {
      // Since schema 6 (S0-F1e: assessments carry when they were made), no
      // older copy is used as it is, with or without old rubric keys
      // (tests/saved-copy-created-at.test.js).
      expect(_BUNDLE_SCHEMA).toBe(6);
      seed([entry(CRIT_Q1, 3)]);
      _teacherId = 'teacher-uuid';
      _saveClassMeta(CID, { schema: 3, owner: _teacherId, version: 9, lastOpenedAt: Date.now(), savedAt: Date.now() });
      expect(_savedCopyHasLegacyRubricKeys(CID)).toBe(false);
      expect(_savedCopyUsable(CID)).toBe(false);
      localStorage.setItem('gb-scores-' + CID, JSON.stringify({ [SID]: [entry(CI, 3)] }));
      expect(_savedCopyHasLegacyRubricKeys(CID)).toBe(true);
      expect(_savedCopyUsable(CID)).toBe(false);
      _saveClassMeta(CID, { schema: 4 });
      expect(_savedCopyUsable(CID)).toBe(false);
      _saveClassMeta(CID, { schema: 5 });
      expect(_savedCopyUsable(CID)).toBe(false);
      _saveClassMeta(CID, { schema: 6 });
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
});

describe('rubric-criterion-weights', () => {
  /**
   * Rubric assessment overall (getAssessmentOverallScore). Each criterion
   * counts once, at its level's point value, and criteria are combined by
   * their weights (docs/backend-design/read-paths.md §1.1, matching the
   * server's fv_assessment_overall). Reported 2026-10-15: the overall was a
   * plain average of every competency score, so criterion weights and level
   * point values changed nothing, and a criterion linked to two competencies
   * counted twice.
   */

  const CID = 'course-rubric';
  const SID = 'stu-1';

  const rubric = criteria => ({ id: 'r1', name: 'Essay rubric', criteria });
  const crit = (id, tagIds, weight, levelValues) => ({
    id,
    name: id,
    tagIds,
    levels: { 4: '', 3: '', 2: '', 1: '' },
    weight,
    levelValues: levelValues || null,
  });
  const assessment = { id: 'a1', title: 'Essay', rubricId: 'r1', tagIds: ['t1', 't2', 't3'], type: 'summative' };
  const score = (tagId, value, mod) => ({ assessmentId: 'a1', tagId, score: value, mod: mod || 0, date: '2026-10-10' });

  function seed({ criteria, scores, statuses, assessments }) {
    _cache.rubrics[CID] = [rubric(criteria)];
    _cache.assessments[CID] = assessments || [assessment];
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = statuses || {};
    _cache.categories[CID] = [];
    _cache.courseConfigs[CID] = {};
    clearProfCache();
  }

  describe('rubric assessment overall', () => {
    beforeEach(() => localStorage.clear());

    it('weights criteria by their weight', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
        scores: [score('t1', 4), score('t2', 2)],
      });
      // (1 × 4 + 3 × 2) / 4 — a plain average would give 3.
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.5, 5);
    });

    it('counts a criterion linked to two competencies once', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2', 't3'], 1)],
        scores: [score('t1', 4), score('t2', 2), score('t3', 2)],
      });
      // (4 + 2) / 2 — counting B twice would give 2.67.
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(3, 5);
    });

    it('keeps one level per criterion under its own id, even on a shared competency', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t1'], 1)],
        scores: [score('A', 4), score('B', 2)],
      });
      // (4 + 2) / 2: two criteria on one competency are two levels.
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(3, 5);
    });

    it("uses a criterion's level point values", () => {
      seed({
        criteria: [crit('A', ['t1'], 1, { 3: 3.5 }), crit('B', ['t2'], 1)],
        scores: [score('t1', 3), score('t2', 2)],
      });
      // A's level 3 is worth 3.5: (3.5 + 2) / 2
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.75, 5);
    });

    it('moves + and − a third of the way to the next level value', () => {
      seed({
        criteria: [crit('A', ['t1'], 1, { 4: 4, 3: 3.5 }), crit('B', ['t2'], 1)],
        scores: [score('t1', 3, 1), score('t2', 3, -1)],
      });
      // A: 3.5 + (4 − 3.5) / 3; B: 3 − 1/3
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo((3.5 + 0.5 / 3 + (3 - 1 / 3)) / 2, 5);
    });

    it('keeps default rubrics on the level scale', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 1)],
        scores: [score('t1', 3, 1), score('t2', 2)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo((10 / 3 + 2) / 2, 5);
    });

    it('keeps the overall on the 0–4 scale when a level is worth more than 4', () => {
      seed({
        criteria: [crit('A', ['t1'], 1, { 4: 6 }), crit('B', ['t2'], 1)],
        scores: [score('t1', 4), score('t2', 4)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(4);
    });

    it('skips criteria that are not scored yet', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
        scores: [score('t1', 4)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(4);
    });

    it('leaves out a criterion weighted 0', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 0)],
        scores: [score('t1', 4), score('t2', 1)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(4);
    });

    it('counts equally when every scored criterion is weighted 0', () => {
      seed({
        criteria: [crit('A', ['t1'], 0), crit('B', ['t2'], 0)],
        scores: [score('t1', 4), score('t2', 2)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(3);
    });

    it('treats a missing weight as 1', () => {
      seed({
        criteria: [crit('A', ['t1'], undefined), crit('B', ['t2'], 3)],
        scores: [score('t1', 4), score('t2', 2)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.5, 5);
    });

    it('finds the score of a criterion with no competencies by its id', () => {
      seed({
        criteria: [crit('A', [], 1), crit('B', ['t2'], 3)],
        scores: [score('A', 4), score('t2', 2)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.5, 5);
    });

    it('returns null when nothing is scored', () => {
      seed({ criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)], scores: [] });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeNull();
    });

    it('keeps excused as null and not submitted as 0', () => {
      const criteria = [crit('A', ['t1'], 1), crit('B', ['t2'], 3)];
      const scores = [score('t1', 4), score('t2', 2)];
      seed({ criteria, scores, statuses: { [SID + ':a1']: 'EXC' } });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeNull();
      seed({ criteria, scores, statuses: { [SID + ':a1']: 'NS' } });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(0);
    });

    it('changes when a criterion weight is saved', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 1)],
        scores: [score('t1', 4), score('t2', 2)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(3);
      saveRubrics(CID, [rubric([crit('A', ['t1'], 1), crit('B', ['t2'], 3)])]);
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.5, 5);
    });

    it('carries the weighting into the course grade', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
        scores: [score('t1', 4), score('t2', 2)],
      });
      const letter = getCourseLetterData(CID, SID);
      expect(letter.Q).toBeCloseTo(2.5, 5);
      expect(letter.R).toBe(62.5);
    });

    it('gives the gradebook and report views the same weighted value', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
        scores: [score('A', 4), score('B', 2), { ...score('A', 1), assessmentId: 'other' }],
      });
      expect(getRubricAssessmentScore(CID, assessment, _cache.scores[CID][SID])).toBeCloseTo(2.5, 5);
      expect(getRubricAssessmentScore(CID, assessment, [])).toBeNull();
      expect(getRubricAssessmentScore(CID, { id: 'a2', tagIds: ['t1'] }, _cache.scores[CID][SID])).toBeUndefined();
    });

    it('leaves non-rubric assessments as a plain average', () => {
      const plain = { id: 'a1', title: 'Quiz', tagIds: ['t1', 't2'], type: 'summative' };
      seed({
        assessments: [plain],
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
        scores: [score('t1', 4), score('t2', 2)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(3);
    });

    it('leaves competency proficiency unweighted', () => {
      seed({
        criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
        scores: [score('t1', 4), score('t2', 2)],
      });
      expect(getTagScores(CID, SID, 't1').map(s => s.score)).toEqual([4]);
      expect(getTagScores(CID, SID, 't2').map(s => s.score)).toEqual([2]);
    });

    describe('custom level points', () => {
      const tenPoint = crit('A', ['t1'], 1, { 4: 10, 3: 8, 2: 6, 1: 4 });

      it('counts a level as its share of the top value on the 0–4 scale', () => {
        seed({ criteria: [tenPoint], scores: [score('t1', 2)] });
        // 6 of 10 points = 2.4; it was clamped to 4 before.
        expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.4, 5);
      });

      it('counts rubric points in the course %', () => {
        seed({ criteria: [tenPoint], scores: [score('t1', 2)] });
        expect(getCourseLetterData(CID, SID).R).toBe(60);
      });

      it('pools rubric points with points work', () => {
        const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['t2'], type: 'summative' };
        seed({
          assessments: [assessment, quiz],
          criteria: [tenPoint],
          scores: [score('t1', 2), { ...score('t2', 8), assessmentId: 'q1' }],
        });
        // (6 + 8) / (10 + 10)
        expect(getCourseLetterData(CID, SID).R).toBe(70);
      });

      it('weights criteria points by criterion weight', () => {
        seed({
          criteria: [tenPoint, crit('B', ['t2'], 3)],
          scores: [score('t1', 2), score('t2', 4)],
        });
        // (1 × 6 + 3 × 4) / (1 × 10 + 3 × 4) = 18 / 22
        expect(getCourseLetterData(CID, SID).R).toBe(81.8);
      });

      it('counts not submitted as 0 of the full rubric and leaves excused out', () => {
        const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['t2'], type: 'summative' };
        const base = {
          assessments: [assessment, quiz],
          criteria: [tenPoint],
          scores: [{ ...score('t2', 8), assessmentId: 'q1' }],
        };
        seed({ ...base, statuses: { [SID + ':a1']: 'NS' } });
        // 8 / (10 + 10)
        expect(getCourseLetterData(CID, SID).R).toBe(40);
        seed({ ...base, statuses: { [SID + ':a1']: 'EXC' } });
        expect(getCourseLetterData(CID, SID).R).toBe(80);
      });
    });
  });
});

describe('rubric-draft', () => {
  /**
   * A rubric criterion drafted from a curricular competency
   * (shared/rubric-draft.js): named after it, linked to it, descriptors from
   * its I-can statements and the BC proficiency scale.
   */

  const metal = {
    id: 'tag-metal',
    label: 'Design Metal Objects Considering',
    i_can_statements: [
      'I can develop designs for metal fabrication',
      'I can consider metalworking process capabilities',
      'I can design for welding and joining methods',
      'I can design with material and cost constraints',
    ],
  };

  describe('rubric draft from a competency', () => {
    it('writes the four levels in the student voice from the I-can statements', () => {
      const d = RubricDraft.draftLevels(metal);
      expect(d.generic).toBe(false);
      expect(d.levels[4]).toBe(
        'Independently and in new situations, I can develop designs for metal fabrication, and I can explain my thinking to others.',
      );
      expect(d.levels[3]).toBe(
        'I can develop designs for metal fabrication. I can consider metalworking process capabilities. I can design for welding and joining methods.',
      );
      expect(d.levels[2]).toBe(
        'In familiar situations and with some help, I can develop designs for metal fabrication.',
      );
      expect(d.levels[1]).toBe('With support, I am beginning to develop designs for metal fabrication.');
    });

    it('keeps at most three statements in the Proficient column', () => {
      const d = RubricDraft.draftLevels(metal);
      expect(d.levels[3].split('I can ').length - 1).toBe(RubricDraft.MAX_PROFICIENT);
    });

    it('reads the server text when the class has no statement list', () => {
      const tag = {
        id: 't',
        label: 'Question and Predict',
        i_can_text: 'I can ask questions.\nI can make predictions.',
      };
      expect(RubricDraft.statementsOf(tag)).toEqual(['I can ask questions', 'I can make predictions']);
      expect(RubricDraft.draftLevels(tag).levels[3]).toBe('I can ask questions. I can make predictions.');
    });

    it('falls back to the scale words when there is no I-can text', () => {
      const d = RubricDraft.draftLevels({ id: 't', label: 'Collaboration' });
      expect(d.generic).toBe(true);
      expect(d.levels[1]).toBe('With support, I am beginning to show this competency.');
    });

    it('keeps a statement that does not start with "I can" as written', () => {
      expect(RubricDraft.actionOf('Use tools safely.')).toBe('Use tools safely');
      expect(RubricDraft.actionOf('  I can   trace   patterns. ')).toBe('trace patterns');
    });

    it('builds a criterion named after and linked to the competency', () => {
      let n = 0;
      const crit = RubricDraft.draftCriterion(metal, () => 'id' + ++n);
      expect(crit).toMatchObject({
        id: 'id1',
        name: 'Design Metal Objects Considering',
        tagIds: ['tag-metal'],
        weight: 1,
        levelValues: null,
      });
      expect(Object.keys(crit.levels).sort()).toEqual(['1', '2', '3', '4']);
    });

    it('knows an untouched criterion from one with work in it', () => {
      const blank = { name: 'Criterion 1', tagIds: [], levels: { 4: '', 3: '', 2: '', 1: '' } };
      expect(RubricDraft.isBlankCriterion(blank)).toBe(true);
      expect(RubricDraft.isBlankCriterion({ ...blank, name: 'Safety' })).toBe(false);
      expect(RubricDraft.isBlankCriterion({ ...blank, tagIds: ['t'] })).toBe(false);
      expect(RubricDraft.isBlankCriterion({ ...blank, levels: { 4: 'x' } })).toBe(false);
      expect(RubricDraft.hasDescriptors(blank)).toBe(false);
      expect(RubricDraft.hasDescriptors({ levels: { 2: ' some ' } })).toBe(true);
    });
  });

  describe('a teacher’s own wording for a competency', () => {
    const q8 = {
      id: 'a-t1',
      label: 'Question and Predict',
      i_can_statements: ['I can ask questions', 'I can predict'],
    };

    it('keys a competency by label and I-can text, never by tag id', () => {
      const otherClass = { ...q8, id: 'b-t9' };
      expect(RubricDraft.competencyKey(q8)).toBe(RubricDraft.competencyKey(otherClass));
      expect(RubricDraft.competencyKey(q8)).toMatch(/^question and predict#[0-9a-z]+$/);
      const grade9 = { ...q8, i_can_statements: ['I can ask testable questions'] };
      expect(RubricDraft.competencyKey(grade9)).not.toBe(RubricDraft.competencyKey(q8));
      // The server keeps the statements as one text; the key is the same.
      expect(
        RubricDraft.competencyKey({
          id: 'x',
          label: 'Question and Predict',
          i_can_text: 'I can ask questions\nI can predict.',
        }),
      ).toBe(RubricDraft.competencyKey(q8));
      expect(RubricDraft.competencyKey({ id: 'x', label: 'Collaboration' })).toBe('collaboration');
      expect(RubricDraft.competencyKey({ id: 'x' })).toBe('');
    });

    it('uses saved wording level by level and says so', () => {
      const d = RubricDraft.draftLevels(q8, { 4: 'Mine for extending', 2: '  ' });
      expect(d.fromSaved).toBe(true);
      expect(d.levels[4]).toBe('Mine for extending');
      expect(d.levels[2]).toBe('In familiar situations and with some help, I can ask questions.');
      expect(RubricDraft.draftLevels(q8, null).fromSaved).toBe(false);
      expect(RubricDraft.draftCriterion(q8, () => 'c1', { 1: 'Starting out' }).levels[1]).toBe('Starting out');
    });

    it('learns only the teacher’s own text from a saved rubric', () => {
      const plain = RubricDraft.draftLevels(q8).levels;
      const key = RubricDraft.competencyKey(q8);
      const rubric = {
        criteria: [
          { id: 'c1', tagIds: ['a-t1'], levels: { 4: 'Rewritten', 3: plain[3], 2: 'Already saved', 1: '' } },
          { id: 'c2', tagIds: ['a-t1', 'a-t2'], levels: { 4: 'Two competencies: skipped' } },
          { id: 'c3', tagIds: [], levels: { 4: 'No competency: skipped' } },
        ],
      };
      const tags = { 'a-t1': q8 };
      const entries = RubricDraft.savedEntries(
        rubric,
        id => tags[id],
        k => (k === key ? { 2: 'Already saved' } : null),
      );
      expect(entries).toEqual([{ key, level: 4, text: 'Rewritten' }]);
    });
  });
});

describe('rubric-guard', () => {
  /**
   * Editing a rubric that already carries scores (teacher/rubric-guard.js).
   * Removing a scored criterion drops its scores, so the editor asks first;
   * changing a scored criterion's top value changes what past scores are
   * worth, so the editor says so.
   */

  const C = 'cls-sci8';

  function rubric() {
    return {
      id: 'rub1',
      name: 'Lab rubric',
      criteria: [
        { id: 'cr1', name: 'Scientific inquiry', tagIds: ['t1', 't2'], levelValues: null },
        { id: 'cr2', name: 'Communication', tagIds: [], levelValues: null },
        { id: 'cr3', name: 'Neatness', tagIds: ['t3'], levelValues: null },
      ],
    };
  }

  describe('rubric edit guard', () => {
    beforeEach(() => {
      localStorage.clear();
      _useSupabase = false;
      _cache.assessments[C] = [
        { id: 'a1', name: 'Lab 1', rubricId: 'rub1' },
        { id: 'a2', name: 'Quiz', tagIds: ['t1'] },
      ];
      _cache.scores[C] = {
        // Rubric scores sit under their criterion's id.
        st1: [
          { assessmentId: 'a1', tagId: 'cr1', score: 3 },
          { assessmentId: 'a1', tagId: 'cr2', score: 2 },
        ],
        st2: [
          { assessmentId: 'a1', tagId: 'cr1', score: 4 },
          // A quiz score on the same competency is not a rubric score.
          { assessmentId: 'a2', tagId: 't3', score: 2 },
        ],
        st3: [{ assessmentId: 'a2', tagId: 't1', score: 1 }],
      };
    });

    it('counts a student once per criterion, only on assessments that use the rubric', () => {
      const counts = RubricGuard.scoredStudentsByCriterion(C, rubric());
      expect(counts).toEqual({ cr1: 2, cr2: 1, cr3: 0 });
    });

    it('reports removed and re-valued criteria that have scores, and ignores the rest', () => {
      const before = rubric();
      const counts = RubricGuard.scoredStudentsByCriterion(C, before);
      const after = rubric();
      after.criteria.splice(1, 1); // Communication removed (scored)
      after.criteria.splice(1, 1); // Neatness removed (unscored)
      after.criteria[0].levelValues = { 4: 10 }; // inquiry now out of 10
      const review = RubricGuard.reviewEdit(before, after, counts);
      expect(review.removed).toEqual([{ id: 'cr2', name: 'Communication', students: 1 }]);
      expect(review.topChanged).toEqual([{ id: 'cr1', name: 'Scientific inquiry', from: 4, to: 10, students: 2 }]);
    });

    it('is quiet when nothing scored changed', () => {
      const before = rubric();
      const after = rubric();
      after.criteria[2].levelValues = { 4: 8 }; // Neatness has no scores
      after.criteria[0].levelValues = { 2: 2.5 }; // not the top value
      const review = RubricGuard.reviewEdit(before, after, RubricGuard.scoredStudentsByCriterion(C, before));
      expect(review).toEqual({ removed: [], topChanged: [] });
      expect(RubricGuard.topChangeNote(review)).toBe('');
    });

    it('words the question and the note plainly', () => {
      expect(RubricGuard.removeMessage({ name: 'Communication' }, 1)).toBe(
        '"Communication" has scores from 1 student. Removing it drops those scores from every assessment that uses this rubric.',
      );
      const note = RubricGuard.topChangeNote({
        topChanged: [{ id: 'cr1', name: 'Scientific inquiry', from: 4, to: 10, students: 2 }],
      });
      expect(note).toContain('"Scientific inquiry" (4 to 10 points)');
      expect(note).toContain('Past scores keep their level');
    });

    it('reads the top value from level overrides', () => {
      expect(RubricGuard.topValue({ levelValues: null })).toBe(4);
      expect(RubricGuard.topValue({ levelValues: { 4: 6 } })).toBe(6);
      expect(RubricGuard.topValue({ levelValues: { 1: 7 } })).toBe(7);
    });
  });
});

describe('rubric-library', () => {
  /**
   * One rubric in several classes (teacher/rubric-library.js). A rubric is
   * copied into another class with its competencies matched by name; what
   * has no match is listed, and a same-named rubric in the target gives the
   * copy a numbered name. Copies have their own ids, so scores stay put.
   */

  const A = 'cls-sci8-a';
  const B = 'cls-sci8-b';
  const H = 'cls-hist12';

  function section(id, name, tags) {
    return {
      id: id,
      name: name,
      color: '#123456',
      tags: tags.map(function (t) {
        return { id: t[0], label: t[1], text: t[1] + ' text' };
      }),
    };
  }

  function seedClass(cid, opts) {
    _cache.categories[cid] = [];
    _cache.learningMaps[cid] = { subjects: [], sections: opts.sections || [], _customized: true, _version: 1 };
    _cache.rubrics[cid] = opts.rubrics || [];
    _cache.modules[cid] = [];
    _cache.assessments[cid] = opts.assessments || [];
  }

  function labRubric() {
    return {
      id: 'a-rub',
      name: 'Lab rubric',
      criteria: [
        {
          id: 'a-c1',
          name: 'Scientific inquiry',
          tagIds: ['a-t1', 'a-t2'],
          weight: 1,
          levels: { 4: 'Designs', 3: 'Plans', 2: 'Follows', 1: 'Joins' },
        },
        { id: 'a-c2', name: 'Neatness', tagIds: [], weight: 0.5, levels: { 4: '', 3: '', 2: '', 1: '' } },
      ],
    };
  }

  describe('rubric library', () => {
    beforeEach(() => {
      localStorage.clear();
      _useSupabase = false;
      globalThis.initData = () => Promise.resolve();
      saveCourses({
        [A]: { id: A, name: 'Science 8 - Block A' },
        [B]: { id: B, name: 'Science 8 B' },
        [H]: { id: H, name: 'History 12' },
      });
      seedClass(A, {
        sections: [
          section('a-s1', 'Questioning', [
            ['a-t1', 'Question and predict'],
            ['a-t2', 'Plan investigations'],
          ]),
        ],
        rubrics: [labRubric()],
      });
      seedClass(B, {
        sections: [
          section('b-s1', 'Questioning', [
            ['b-t1', 'Question and predict'],
            ['b-t2', 'Plan investigations'],
          ]),
        ],
      });
      seedClass(H, {
        sections: [section('h-s1', 'Significance', [['h-t1', 'Assess significance']])],
        rubrics: [{ id: 'h-rub', name: 'lab rubric', criteria: [{ id: 'h-c1', name: 'Other', tagIds: [] }] }],
      });
    });

    it('matches every competency in the other section of the course', () => {
      const plan = RubricLibrary.planCopy(A, labRubric(), B);
      expect(plan.name).toBe('Lab rubric');
      expect(plan.collision).toBe(false);
      expect(plan.matchedCount).toBe(2);
      expect(plan.tagCount).toBe(2);
      expect(plan.mostlyDropped).toBe(false);
      expect(plan.criteria[0].matched).toEqual(['Question and predict', 'Plan investigations']);
      expect(plan.criteria[0].dropped).toEqual([]);
      expect(RubricLibrary.summaryLines(plan)).toEqual(['2 criteria, 2 of 2 competencies matched']);
    });

    it('lists what a different course cannot match and renames on a name clash', () => {
      const plan = RubricLibrary.planCopy(A, labRubric(), H);
      expect(plan.name).toBe('Lab rubric (2)');
      expect(plan.collision).toBe(true);
      expect(plan.matchedCount).toBe(0);
      expect(plan.mostlyDropped).toBe(true);
      expect(plan.criteria[0].dropped).toEqual(['Question and predict', 'Plan investigations']);
      const lines = RubricLibrary.summaryLines(plan);
      expect(lines[0]).toBe('2 criteria, 0 of 2 competencies matched');
      expect(lines[1]).toBe('This class teaches a different course; most competencies will be left off.');
      expect(lines[2]).toBe('History 12 already has a rubric with this name; the copy will be called Lab rubric (2).');
    });

    it('numbers past every taken name', () => {
      const existing = [{ name: 'Lab rubric' }, { name: 'Lab rubric (2)' }];
      expect(RubricLibrary.uniqueName('Lab rubric', existing)).toBe('Lab rubric (3)');
      expect(RubricLibrary.uniqueName('Essay rubric', existing)).toBe('Essay rubric');
    });

    it('copies with new ids, mapped competencies and the descriptors intact', async () => {
      const done = await RubricLibrary.copyTo(A, labRubric(), [B, H]);
      expect(done.map(d => d.dstCid)).toEqual([B, H]);
      const inB = getRubrics(B);
      expect(inB).toHaveLength(1);
      expect(inB[0].id).not.toBe('a-rub');
      expect(inB[0].criteria[0].id).not.toBe('a-c1');
      expect(inB[0].criteria[0].tagIds).toEqual(['b-t1', 'b-t2']);
      expect(inB[0].criteria[0].levels[4]).toBe('Designs');
      expect(inB[0].criteria[1].weight).toBe(0.5);
      const inH = getRubrics(H);
      expect(inH).toHaveLength(2);
      expect(inH[1].name).toBe('Lab rubric (2)');
      expect(inH[1].criteria[0].tagIds).toEqual([]);
      // The source is untouched.
      expect(getRubrics(A)[0].criteria[0].tagIds).toEqual(['a-t1', 'a-t2']);
    });

    it('maps the whole rubric’s competencies too', () => {
      const src = Object.assign(labRubric(), { tagIds: ['a-t2'] });
      src.criteria[0].tagIds = ['a-t1'];
      expect(RubricLibrary.cloneRubric(A, B, src).tagIds).toEqual(['b-t2']);
      expect(RubricLibrary.cloneRubric(A, H, src).tagIds).toEqual([]);
      expect(RubricLibrary.cloneRubric(A, B, labRubric()).tagIds).toEqual([]);
    });

    it('links the source and its copies with one copy group', async () => {
      const done = await RubricLibrary.copyTo(A, labRubric(), [B]);
      const src = getRubrics(A)[0];
      expect(src.copyGroup).toMatch(/^[0-9a-f-]{36}$/);
      expect(done[0].rubric.copyGroup).toBe(src.copyGroup);
      expect(getRubrics(B)[0].copyGroup).toBe(src.copyGroup);
      expect(RubricLibrary.localCopies(A, src)).toEqual([
        { cid: B, rubricId: getRubrics(B)[0].id, className: 'Science 8 B' },
      ]);
      expect(RubricLibrary.deleteNote(A, src)).toBe(' It is also in Science 8 B; that copy stays.');
      expect(RubricLibrary.renderCopies(A, src)).toContain('Also in');
      // A second copy joins the same group.
      await RubricLibrary.copyTo(A, getRubrics(A)[0], [H]);
      expect(getRubrics(H)[1].copyGroup).toBe(src.copyGroup);
      const copies = await RubricLibrary.findCopies(A, getRubrics(A)[0]);
      expect(copies.map(c => c.cid).sort()).toEqual([B, H].sort());
    });

    describe('linked edit', () => {
      let before, copy;
      beforeEach(async () => {
        await RubricLibrary.copyTo(A, labRubric(), [B]);
        before = structuredClone(getRubrics(A)[0]);
        copy = getRubrics(B)[0];
      });

      it('carries descriptor, value, weight and name changes the copy still shares', () => {
        const after = structuredClone(before);
        after.name = 'Lab rubric v2';
        after.criteria[0].levels[4] = 'Designs independently';
        after.criteria[0].levelValues = { 4: 10 };
        after.criteria[1].weight = 2;
        const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
        expect(plan.changed).toBe(true);
        expect(plan.next.name).toBe('Lab rubric v2');
        expect(plan.next.criteria[0].levels[4]).toBe('Designs independently');
        expect(plan.next.criteria[0].levelValues).toEqual({ 4: 10 });
        expect(plan.next.criteria[1].weight).toBe(2);
        expect(plan.next.criteria[0].tagIds).toEqual(['b-t1', 'b-t2']);
        expect(plan.lines).toEqual([
          'Name → Lab rubric v2',
          'Descriptors of “Scientific inquiry” updated',
          'Point values of “Scientific inquiry” updated',
          'Weight of “Neatness” → 2',
        ]);
        expect(plan.skipped).toEqual([]);
      });

      it('leaves alone what the other class changed on its own', () => {
        copy.criteria[0].levels[4] = 'Their own wording';
        copy.name = 'Lab rubric (B)';
        const after = structuredClone(before);
        after.name = 'Lab rubric v2';
        after.criteria[0].levels[4] = 'Designs independently';
        after.criteria[0].levels[3] = 'Plans carefully';
        const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
        expect(plan.changed).toBe(false);
        expect(plan.next.criteria[0].levels[4]).toBe('Their own wording');
        expect(plan.skipped).toEqual(['name', 'the descriptors of “Scientific inquiry”']);
      });

      it('adds a new criterion with matched competencies and removes an unscored one', () => {
        const after = structuredClone(before);
        after.criteria.splice(1, 1); // Neatness removed, no scores in B
        after.criteria.push({
          id: 'a-c3',
          name: 'Safety',
          tagIds: ['a-t2'],
          weight: 1,
          levels: { 4: 'x', 3: '', 2: '', 1: '' },
        });
        const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
        expect(plan.lines).toEqual(['Remove criterion “Neatness”', 'Add criterion “Safety”']);
        expect(plan.next.criteria.map(c => c.name)).toEqual(['Scientific inquiry', 'Safety']);
        expect(plan.next.criteria[1].tagIds).toEqual(['b-t2']);
        expect(plan.next.criteria[1].id).not.toBe('a-c3');
        expect(plan.removals).toEqual([{ id: copy.criteria[1].id, name: 'Neatness', students: 0, index: 0 }]);
      });

      it('keeps a scored criterion in the copy unless the teacher removes it too', () => {
        _cache.assessments[B] = [{ id: 'b-a1', name: 'Lab 1', rubricId: copy.id }];
        _cache.scores[B] = { st1: [{ assessmentId: 'b-a1', tagId: copy.criteria[1].id, score: 3 }] };
        const after = structuredClone(before);
        after.criteria.splice(1, 1);
        const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
        expect(plan.changed).toBe(true);
        expect(plan.lines).toEqual([]);
        expect(plan.next.criteria.map(c => c.name)).toEqual(['Scientific inquiry', 'Neatness']);
        expect(plan.removals[0]).toMatchObject({ name: 'Neatness', students: 1 });
      });

      it('matches a renamed criterion by position when names differ', () => {
        copy.criteria[0].name = 'Inquiry (B)';
        const after = structuredClone(before);
        after.criteria[0].levels[2] = 'Follows with help';
        const plan = RubricLibrary.planLinkedEdit(A, before, after, B, copy);
        expect(plan.next.criteria[0].levels[2]).toBe('Follows with help');
        expect(plan.lines).toEqual(['Descriptors of “Scientific inquiry” updated']);
      });
    });

    it('skips the source class and ignores unknown targets', async () => {
      const done = await RubricLibrary.copyTo(A, labRubric(), [A, '', B]);
      expect(done.map(d => d.dstCid)).toEqual([B]);
      expect(getRubrics(A)).toHaveLength(1);
    });
  });
});

describe('rubric-mixed-mark-blocks', () => {
  /**
   * Mixed rubric criteria on one competency (Colin, 2026-11-03): Progress in
   * One Area, Next Steps (Latest) and Generate's trend read the competency's
   * mark on the piece as the gradebook shows it, the lowest when the criteria
   * disagree (calc.js tagMarksByAssessment, #831), not the criteria's average
   * (tagScoresByAssessment). Thesis 4 and Evidence Use 1 on Significance: the
   * gradebook cell says 1, striped; these blocks said 2.5. Start of Term (and
   * Generate's start and now) stay on the level's footing, each criterion its
   * own score, so they compare like with like with Now (Nov 3 review).
   */

  const CID = 'rubric-mixed-blocks';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Owen', lastName: 'Martens' };

  const rubric = {
    id: 'rub-1',
    name: 'Essay',
    criteria: [
      { id: 'crit-thesis', name: 'Thesis', tagIds: ['t1'], levels: {} },
      { id: 'crit-evidence', name: 'Evidence Use', tagIds: ['t1'], levels: {} },
    ],
  };
  const debate = { id: 'debate', title: 'Treaty Debate', date: '2026-10-01', tagIds: ['t1'] };
  const essay = { id: 'essay', title: 'Causes of the War', date: '2026-10-12', tagIds: ['t1'], rubricId: 'rub-1' };
  const sc = (assessmentId, tagId, score, date) => ({ assessmentId, tagId, score, date });

  function seed() {
    COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: 'proficiency' };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec-1', name: 'Significance', tags: [{ id: 't1', label: 'Significance' }] }],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = [debate, essay];
    _cache.scores[CID] = {
      [SID]: [
        sc('debate', 't1', 3, '2026-10-01'),
        sc('essay', 'crit-thesis', 4, '2026-10-12'),
        sc('essay', 'crit-evidence', 1, '2026-10-12'),
      ],
    };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [rubric];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  describe('a competency fed by two rubric criteria that disagree', () => {
    afterEach(() => delete COURSES[CID]);

    it('Next Steps prints the latest piece at the gradebook’s mark', () => {
      seed();
      expect(tagMarksByAssessment(CID, SID, 't1').find(m => m.assessmentId === 'essay')).toMatchObject({
        score: 1,
        mixed: true,
      });
      const out = text(ReportBlocks.renderBlockNextSteps(CID, STUDENT, {}, {}));
      // The gradebook's mark, 1, as a student reads it (DECISIONS, "Student-facing levels are proficiencies").
      expect(out).toContain('Latest: Causes of the War, Oct 12 · Emerging');
      expect(out).not.toContain('2.5');
    });

    it('Progress in One Area lists the piece at the gradebook’s mark', () => {
      seed();
      const out = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
      expect(out).toContain('Causes of the War');
      expect(out).toContain('Latest Causes of the War, Oct 12 · Emerging');
      expect(out).not.toMatch(/\d\.\d/);
    });

    it('steady essays whose criteria disagree show no change from Start of Term', () => {
      seed();
      // Thesis 4 and Evidence Use 1 on four essays, two weeks apart.
      const essays = [0, 1, 2, 3].map(i => ({
        id: 'e' + i,
        title: 'Essay ' + (i + 1),
        date: '2026-09-' + String(7 + i * 7).padStart(2, '0'),
        tagIds: ['t1'],
        rubricId: 'rub-1',
      }));
      _cache.assessments[CID] = essays;
      _cache.scores[CID] = {
        [SID]: essays.flatMap(a => [sc(a.id, 'crit-thesis', 4, a.date), sc(a.id, 'crit-evidence', 1, a.date)]),
      };
      clearProfCache();
      expect(getSectionProficiency(CID, SID, 'sec-1')).toBe(2.5);
      const out = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
      // Words, not figures (DECISIONS, "Student-facing levels are proficiencies").
      expect(out).toContain('Start of term Proficient Now Proficient (Same this term)');
      expect(out).toContain('Latest Essay 4, Sep 28 · Emerging');
      // The Proficiency block's Start of Term agrees.
      expect(text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, { compare: 'start' }))).toContain(
        'Significance Proficient Proficient Same',
      );
    });

    it('Generate does not write up disagreeing criteria as growth', () => {
      seed();
      _cache.learningMaps[CID].sections[0].tags[0].bank_id = 'bc.ss10.cc.3';
      // Early essays 4 and 1 (mark 1), later ones 3 and 2 (mark 2): the marks
      // rise, the level holds at 2.5.
      const essays = [0, 1, 2, 3, 4, 5].map(i => ({
        id: 'e' + i,
        title: 'Essay ' + (i + 1),
        date: '2026-09-' + String(2 + i * 6).padStart(2, '0'),
        tagIds: ['t1'],
        rubricId: 'rub-1',
      }));
      _cache.assessments[CID] = essays;
      _cache.scores[CID] = {
        [SID]: essays.flatMap((a, i) =>
          i < 3
            ? [sc(a.id, 'crit-thesis', 4, a.date), sc(a.id, 'crit-evidence', 1, a.date)]
            : [sc(a.id, 'crit-thesis', 3, a.date), sc(a.id, 'crit-evidence', 2, a.date)],
        ),
      };
      clearProfCache();
      const f = CommentBank.facts(CID, STUDENT, null);
      const comp = f.comps.find(c => c.id === 'sec-1');
      expect(comp.scores.map(s => s.v)).toEqual([1, 1, 1, 2, 2, 2]);
      expect(comp.start).toBeCloseTo(2.5, 9);
      expect(comp.level).toBe(2.5);
      expect(CommentBank.progressOf(f)).toBeNull();
    });

    it('Generate’s trend reads the same mark', () => {
      seed();
      const comp = CommentBank.facts(CID, STUDENT, null).comps.find(c => c.id === 'sec-1');
      expect(comp.scores.map(s => s.id + ' ' + s.v)).toEqual(['debate 3', 'essay 1']);
    });
  });
});

describe('rubric-piece-percent', () => {
  /**
   * A rubric piece's own % (Colin, 2026-11-03; Nov 3 bug sweep, step 4 group
   * 2 #1). Local History Inquiry is the only work in Projects, on the BC
   * Letter Bands (3- = 73, 4 = 100). Its criteria are 3- and 4, so its
   * category counts (73 + 100) / 2 = 86.5%, "A 87%". Its row on the Quick
   * Report and in Assignment Grades, and its gradebook cell, averaged the
   * levels first (3.33 = 3+ = 86%). Every reader now prints the category's
   * math for the piece, from calc.js assessmentCellValue.
   */

  const CID = 'rubric-piece-pct';
  const SID = 'stu-1';
  const STUDENT = { id: SID, firstName: 'Zoe', lastName: 'Chen' };

  const rubric = {
    id: 'rub-1',
    name: 'Inquiry Project',
    criteria: [
      { id: 'crit-inquiry', name: 'Inquiry', tagIds: ['t1'], levels: {} },
      { id: 'crit-evidence', name: 'Evidence', tagIds: ['t2'], levels: {} },
    ],
  };
  const inquiry = {
    id: 'lhi',
    title: 'Local History Inquiry',
    date: '2026-10-01',
    categoryId: 'cat-proj',
    tagIds: ['t1', 't2'],
    rubricId: 'rub-1',
  };
  const plain = { id: 'quiz', title: 'Map Quiz', date: '2026-10-02', categoryId: 'cat-quiz', tagIds: ['t1'] };
  const sc = (assessmentId, tagId, score, extra) => ({ assessmentId, tagId, score, date: '2026-10-05', ...extra });

  function seed(mode) {
    COURSES[CID] = { id: CID, name: 'Social Studies 10', gradeLevel: '10', gradingSystem: mode };
    _cache.students[CID] = [STUDENT];
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [
        { id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] },
        { id: 'sec-2', name: 'Evidence', tags: [{ id: 't2', label: 'Evidence' }] },
      ],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [
      { id: 'cat-proj', name: 'Projects', weight: 50 },
      { id: 'cat-quiz', name: 'Quizzes', weight: 50 },
    ];
    _cache.assessments[CID] = [inquiry, plain];
    _cache.scores[CID] = {
      [SID]: [
        sc('lhi', 'crit-inquiry', 3, { mod: -1 }),
        sc('lhi', 'crit-evidence', 4),
        sc('quiz', 't1', 3, { mod: 1 }),
      ],
    };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [rubric];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = {
      calcMethod: 'average',
      gradingScale: { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents: { ...BC_LETTER_BAND_PERCENTS } },
    };
    clearProfCache();
  }
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  describe('a rubric piece alone in its category', () => {
    afterEach(() => delete COURSES[CID]);

    it('shows the category’s % in its cell, its Assessments row and Assignment Grades', () => {
      seed('letter');
      const projects = getCategories(CID).find(c => c.id === 'cat-proj');
      expect(assessmentGroupGrade(CID, SID, [inquiry], categoryCalcMode(projects)).text).toBe('A 87%');

      const cell = assessmentCellValue(CID, SID, inquiry);
      expect(cell.value).toBeCloseTo(10 / 3, 9);
      expect(cell.percent).toBeCloseTo(86.5, 9);
      expect(cell).toMatchObject({ kind: 'level', percentText: '87%', text: '87%' });

      const row = GradeReport.rows(CID, STUDENT).find(r => r.id === 'lhi');
      expect(row).toMatchObject({ score: '3.3', outOf: '4', percent: '87%' });
      expect(GradeReport.categorySummary(CID, STUDENT).find(c => c.name === 'Projects').grade).toBe('A 87%');

      // The printed graded rubric's Overall.
      expect(RubricPrint.sheetData(CID, 'lhi', SID).overall).toMatchObject({ text: '87%' });

      const grades = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, {}));
      expect(grades).toContain('Local History Inquiry 3.3 / 4 \u00B7 87%');
    });

    it('Generate’s best and weakest piece print the same %', () => {
      seed('letter');
      const f = CommentBank.facts(CID, STUDENT, null);
      const w = f.work.find(x => x.id === 'lhi');
      expect(w.pct).toBeCloseTo(86.5, 9);
      expect(CommentBank.workMark(f, w)).toBe(assessmentCellValue(CID, SID, inquiry).percentText);
      expect(CommentBank.workMark(f, w)).toBe('87%');
      // Plain proficiency work keeps its level's % (3+ = 86).
      expect(
        CommentBank.workMark(
          f,
          f.work.find(x => x.id === 'quiz'),
        ),
      ).toBe('86%');
    });

    it('a Both class pairs the level with the same %', () => {
      seed('both');
      expect(assessmentCellValue(CID, SID, inquiry)).toMatchObject({ text: '3.3 · 87%', percentText: '87%' });
    });

    it('other proficiency work keeps the % its level counts as', () => {
      seed('letter');
      // 3+ on the BC Letter Bands is 86.
      expect(assessmentCellValue(CID, SID, plain)).toMatchObject({ percentText: '86%', text: '86%' });
      expect(formatLevel(CID, 10 / 3)).toBe('86%');
    });
  });
});

describe('rubric-print-tracking', () => {
  /**
   * Printed rubrics (migrations/20261102_rubric_print.sql): the prints in the
   * data layer (getRubricPrint / setRubricPrints and their set_rubric_printed
   * write, the bundle's print_rows), and in teacher/rubric-print.js the
   * fingerprint, each student's print state, Not Yet Printed / Changed Since
   * Printed, marking a print job and the marker beside a name.
   */

  const CID = '11111111-1111-1111-1111-111111111111';
  const AID = '22222222-2222-4222-8222-222222222222';
  const SID = '33333333-3333-4333-8333-333333333333';
  const SID2 = '44444444-4444-4444-8444-444444444444';
  const SID3 = '45454545-4545-4545-8545-454545454545';
  const RUBRIC = '55555555-5555-4555-8555-555555555555';
  const CRIT_A = '66666666-6666-4666-8666-666666666666';
  const CRIT_B = '77777777-7777-4777-8777-777777777777';

  function entry(sid, tagId, score) {
    return {
      id: sid + ':' + tagId,
      assessmentId: AID,
      tagId: tagId,
      score: score,
      date: '2026-10-03',
      type: 'summative',
      note: '',
    };
  }

  function seedClass() {
    saveStudents(CID, [
      { id: SID, firstName: 'Ada', lastName: 'Lovelace' },
      { id: SID2, firstName: 'Alan', lastName: 'Turing' },
      { id: SID3, firstName: 'Grace', lastName: 'Hopper' },
    ]);
    saveRubrics(CID, [
      {
        id: RUBRIC,
        name: 'Lab rubric',
        criteria: [
          { id: CRIT_A, name: 'Inquiry', tagIds: [], levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } },
          { id: CRIT_B, name: 'Communication', tagIds: [], levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } },
        ],
      },
    ]);
    saveAssessments(CID, [
      { id: AID, title: 'Cell lab', date: '2026-10-03', type: 'summative', tagIds: [], rubricId: RUBRIC },
    ]);
    // Ada and Alan are scored; Grace is not.
    saveScores(CID, {
      [SID]: [entry(SID, CRIT_A, 3), entry(SID, CRIT_B, 2)],
      [SID2]: [entry(SID2, CRIT_A, 4), entry(SID2, CRIT_B, 4)],
    });
  }

  function makeRecordingClient() {
    var calls = [];
    return {
      calls: calls,
      rpc(name, payload) {
        calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'rubrics', 'students', 'rubricPrints'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    seedClass();
  });

  describe('fingerprint and print state', () => {
    it('is the same for the same sheet and different after a level changes', () => {
      var before = RubricPrint.fingerprint(CID, AID, SID);
      expect(before).toMatch(/^[0-9a-f]{14}$/);
      expect(RubricPrint.fingerprint(CID, AID, SID)).toBe(before);
      expect(RubricPrint.fingerprint(CID, AID, SID2)).not.toBe(before);
      var scores = getScores(CID);
      scores[SID][1].score = 3;
      saveScores(CID, scores);
      expect(RubricPrint.fingerprint(CID, AID, SID)).not.toBe(before);
    });

    it('changes when a criterion comment is added', () => {
      var before = RubricPrint.fingerprint(CID, AID, SID);
      var scores = getScores(CID);
      scores[SID][0].critNote = 'Good fair test.';
      saveScores(CID, scores);
      expect(RubricPrint.fingerprint(CID, AID, SID)).not.toBe(before);
    });

    it('is empty for an unscored student', () => {
      expect(RubricPrint.fingerprint(CID, AID, SID3)).toBe('');
    });

    it('reads unscored, unprinted, printed and changed', () => {
      expect(RubricPrint.printState(CID, AID, SID3).kind).toBe('unscored');
      expect(RubricPrint.printState(CID, AID, SID).kind).toBe('unprinted');
      expect(RubricPrint.hasPrints(CID, AID)).toBe(false);

      RubricPrint.markPrinted(CID, AID, [SID, SID2, SID3]);
      expect(RubricPrint.hasPrints(CID, AID)).toBe(true);
      expect(RubricPrint.printState(CID, AID, SID).kind).toBe('printed');
      // Nothing to print for Grace, so nothing was recorded.
      expect(getRubricPrint(CID, SID3, AID)).toBeNull();

      var scores = getScores(CID);
      scores[SID][0].score = 4;
      saveScores(CID, scores);
      expect(RubricPrint.printState(CID, AID, SID).kind).toBe('changed');
      expect(RubricPrint.printState(CID, AID, SID2).kind).toBe('printed');
    });
  });

  describe('Not Yet Printed and Changed Since Printed', () => {
    it('select the unprinted and the changed scored students', () => {
      RubricPrint.markPrinted(CID, AID, [SID]);
      var ids = function (list) {
        return list.map(function (s) {
          return s.id;
        });
      };
      expect(ids(RubricPrint.selectStudents(CID, AID, { students: 'unprinted' }))).toEqual([SID2]);
      expect(ids(RubricPrint.selectStudents(CID, AID, { students: 'changed' }))).toEqual([]);
      var scores = getScores(CID);
      scores[SID][0].score = 1;
      saveScores(CID, scores);
      expect(ids(RubricPrint.selectStudents(CID, AID, { students: 'changed' }))).toEqual([SID]);
    });

    it('markPrinted returns what Undo puts back', () => {
      RubricPrint.markPrinted(CID, AID, [SID]);
      var first = getRubricPrint(CID, SID, AID);
      var before = RubricPrint.markPrinted(CID, AID, [SID, SID2]);
      expect(before).toEqual([
        { sid: SID, hash: first.hash, at: first.at },
        { sid: SID2, hash: null },
      ]);
      setRubricPrints(CID, AID, before);
      expect(getRubricPrint(CID, SID, AID)).toEqual(first);
      expect(getRubricPrint(CID, SID2, AID)).toBeNull();
    });

    it('Mark Not Printed clears one student', () => {
      RubricPrint.markPrinted(CID, AID, [SID, SID2]);
      RubricPrint.unmarkPrinted(CID, AID, SID);
      expect(RubricPrint.printState(CID, AID, SID).kind).toBe('unprinted');
      expect(RubricPrint.printState(CID, AID, SID2).kind).toBe('printed');
    });
  });

  describe('the marker beside a name', () => {
    it('is hidden and empty before a print', () => {
      var html = RubricPrint.markHtml(CID, AID, SID);
      expect(html).toContain(' hidden');
      expect(html).not.toContain('Printed');
    });

    it('says Printed with the date, then Changed Since Printed', () => {
      setRubricPrints(CID, AID, [
        { sid: SID, hash: RubricPrint.fingerprint(CID, AID, SID), at: '2026-10-30T18:00:00Z' },
      ]);
      var html = RubricPrint.markHtml(CID, AID, SID);
      expect(html).not.toContain(' hidden');
      expect(html).toContain('Printed Oct 30');
      expect(html).not.toContain('is-changed');
      var scores = getScores(CID);
      scores[SID][0].score = 1;
      saveScores(CID, scores);
      html = RubricPrint.markHtml(CID, AID, SID);
      expect(html).toContain('Changed Since Printed');
      expect(html).toContain('rp-mark is-changed');
    });
  });

  describe('prints in the data layer', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      client = makeRecordingClient();
      globalThis.getSupabase = () => client;
      _useSupabase = true;
    });
    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    function rpcCalls() {
      return client.calls.filter(function (c) {
        return c.name === 'set_rubric_printed';
      });
    }

    it('keeps prints in the cache and localStorage', () => {
      setRubricPrints(CID, AID, [{ sid: SID, hash: 'abc', at: '2026-10-30T18:00:00.000Z' }]);
      expect(getRubricPrint(CID, SID, AID)).toEqual({ at: '2026-10-30T18:00:00.000Z', hash: 'abc' });
      expect(JSON.parse(localStorage.getItem('gb-rubric-prints-' + CID))).toEqual({
        [SID + ':' + AID]: { at: '2026-10-30T18:00:00.000Z', hash: 'abc' },
      });
    });

    it('writes set_rubric_printed for a print and for a clear, and nothing for a repeat', async () => {
      var at = '2026-10-30T18:00:00.000Z';
      setRubricPrints(CID, AID, [{ sid: SID, hash: 'abc', at: at }]);
      setRubricPrints(CID, AID, [{ sid: SID, hash: 'abc', at: at }]); // the same
      setRubricPrints(CID, AID, [{ sid: SID, hash: null }]);
      setRubricPrints(CID, AID, [{ sid: SID2, hash: null }]); // nothing to clear
      await Promise.resolve();
      var calls = rpcCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0].payload).toMatchObject({
        p_enrollment_id: SID,
        p_assessment_id: AID,
        p_hash: 'abc',
        p_printed_at: at,
      });
      expect(calls[1].payload).toMatchObject({
        p_enrollment_id: SID,
        p_assessment_id: AID,
        p_hash: null,
        p_printed_at: null,
      });
      // Every write RPC is idempotent by key (CLAUDE.md rule 7).
      expect(FV_IDEMPOTENT_RPCS.set_rubric_printed).toBe(true);
    });

    it('sends nothing in Demo Mode', () => {
      localStorage.setItem('gb-demo-mode', '1');
      setRubricPrints(CID, AID, [{ sid: SID, hash: 'abc' }]);
      expect(getRubricPrint(CID, SID, AID)).not.toBeNull();
      expect(rpcCalls()).toHaveLength(0);
    });

    it('is echo-safe: a print landing does not reload the class', () => {
      expect(_ECHO_SAFE_RPCS.set_rubric_printed).toBe(true);
    });

    it('rebuilds { sid:aid → { at, hash } } from the bundle print_rows', () => {
      var gb = {
        students: [{ enrollment_id: SID }, { enrollment_id: SID2 }],
        assessments: [{ id: AID }],
        print_rows: [
          [1, 0, '2026-10-30T18:00:00+00:00', 'def'],
          [0, 0, '2026-10-29T18:00:00+00:00', 'abc'],
          [0, 3, '2026-10-29T18:00:00+00:00', 'zzz'], // an assessment not in the list is skipped
        ],
      };
      expect(_bundleRubricPrints(gb)).toEqual({
        [SID + ':' + AID]: { at: '2026-10-29T18:00:00+00:00', hash: 'abc' },
        [SID2 + ':' + AID]: { at: '2026-10-30T18:00:00+00:00', hash: 'def' },
      });
      // A bundle from before print_rows has none.
      expect(_bundleRubricPrints({ students: [], assessments: [] })).toEqual({});
    });
  });
});

describe('rubric-print', () => {
  /**
   * Printable graded rubric handouts — teacher/rubric-print.js, and the
   * criterion comment it prints (shared/data.js: rubric_score.comment).
   */

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
            levels: {
              4: 'Designs a fair test alone.',
              3: 'Plans a fair test.',
              2: 'Follows a plan.',
              1: 'Needs help.',
            },
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
        {
          id: 'e1',
          assessmentId: AID,
          tagId: TAG_1,
          score: 3,
          mod: 1,
          date: '2026-10-03',
          type: 'summative',
          note: '',
        },
        {
          id: 'e2',
          assessmentId: AID,
          tagId: TAG_2,
          score: 3,
          mod: 1,
          date: '2026-10-03',
          type: 'summative',
          note: '',
        },
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

    it("reads the criterion's own entry, not its competencies'", () => {
      const rubric = getRubricById(CID, RUBRIC);
      const entries = [
        { assessmentId: AID, tagId: CRIT_A, score: 2, mod: -1 },
        { assessmentId: AID, tagId: TAG_1, score: 4, mod: 0 },
      ];
      expect(RubricPrint.criterionLevel(entries, AID, rubric.criteria[0])).toEqual({ level: 2, mod: -1, mixed: false });
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

    it('lists and prints students by last name', () => {
      saveStudents(CID, [
        { id: SID2, firstName: 'Alan', lastName: 'Turing' },
        { id: SID, firstName: 'Ada', lastName: 'Lovelace', preferred: 'Ada' },
        { id: 's-b', firstName: 'Zed', lastName: 'Byron' },
      ]);
      expect(RubricPrint.selectStudents(CID, AID, { students: 'all' }).map(s => s.lastName)).toEqual([
        'Byron',
        'Lovelace',
        'Turing',
      ]);
      expect(
        RubricPrint.selectStudents(CID, AID, { students: 'pick', picked: [SID2, 's-b'] }).map(s => s.lastName),
      ).toEqual(['Byron', 'Turing']);
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

    it('adds the Next Steps Reflection with lines to write on only when included', () => {
      const data = Object.assign({}, RubricPrint.sheetData(CID, AID, SID), { feedback: 'Clear method.' });
      expect(RubricPrint.renderSheet(data, { include })).not.toContain('Next Steps');
      const html = RubricPrint.renderSheet(data, { include: Object.assign({}, include, { nextSteps: true }) });
      expect(html).toContain('rubric-reflect');
      expect(html).toContain('What will you work on next, and how will you do it?');
      expect(html).toContain('rubric-lines');
    });

    it('lets a long rubric shrink further on half and quarter sheets, never below the layout floor', () => {
      const full = RubricPrint.shrinkSteps(RubricPrint.LAYOUTS.full);
      const half = RubricPrint.shrinkSteps(RubricPrint.LAYOUTS.half);
      const quarter = RubricPrint.shrinkSteps(RubricPrint.LAYOUTS.quarter);
      expect(full[0]).toBe(1);
      expect(full[full.length - 1] * 12.5).toBeCloseTo(9, 1);
      expect(half[half.length - 1] * 10).toBeCloseTo(6.5, 1);
      expect(quarter[quarter.length - 1] * 8).toBeCloseTo(5.5, 1);
      expect(quarter.every((f, i) => i === 0 || f < quarter[i - 1])).toBe(true);
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
      // The handout goes to the student: the level with its ±, no figure (DECISIONS, "Student-facing levels are proficiencies").
      expect(data.overall.text).toBe(nearestScoreLevelName(data.overall.value));
      expect(data.overall.text).not.toMatch(/\d/);
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

    it("stores the comment on the criterion's entry and sends it with the level", () => {
      saveRubricCriterionComment(CID, SID, AID, CRIT_A, 'Good control of variables.');
      const entries = getScores(CID)[SID];
      expect(entries.find(e => e.tagId === CRIT_A).critNote).toBe('Good control of variables.');
      expect(entries.some(e => e.tagId === TAG_1 || e.tagId === TAG_2)).toBe(false);
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
      expect(getScores(CID)[SID].find(e => e.tagId === CRIT_A).critNote).toBeUndefined();
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
      upsertScore(CID, SID, AID, CRIT_A, 4, '2026-10-03', 'summative', '');
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
      const entry = _scoreEntryFromCanonical(CID, getAssessments(CID)[0], CRIT_A, 3, '', 0, 'Label axes', 'Extra');
      expect(entry.critBeyond).toBe('Extra');

      saveRubricCriterionBeyond(CID, SID, AID, CRIT_A, 'Added a trend line');
      expect(getRubricCriterionBeyond(CID, SID, AID, getRubricById(CID, RUBRIC).criteria[0])).toBe(
        'Added a trend line',
      );
      const calls = rubricCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].payload.p_beyond).toBe('Added a trend line');
      // No comment is cached, so it goes as null and the server keeps its own.
      expect(calls[0].payload.p_comment).toBeNull();
      // A level change sends the saved Went Beyond along.
      upsertScore(CID, SID, AID, CRIT_A, 4, '2026-10-03', 'summative', '');
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

  describe('Single-point rubrics', () => {
    const include = { feedback: true, criterionComments: true, codes: true, overall: true };
    beforeEach(() => {
      const rubrics = getRubrics(CID).map(r =>
        Object.assign({}, r, {
          style: 'single_point',
          criteria: r.criteria.map(c =>
            Object.assign({}, c, { levels: Object.assign({}, c.levels, { 3: 'Meets: ' + c.name }) }),
          ),
        }),
      );
      saveRubrics(CID, rubrics);
    });

    it('prints Work On | Proficient Standard | Went Beyond with the level named', () => {
      saveRubricCriterionComment(CID, SID, AID, CRIT_A, 'Label the variables.');
      saveRubricCriterionBeyond(CID, SID, AID, CRIT_A, 'Ran a second trial.');
      const data = RubricPrint.sheetData(CID, AID, SID);
      expect(data.rows[0].beyond).toBe('Ran a second trial.');
      const html = RubricPrint.renderSheet(data, { include });
      expect(html).toContain('rubric-table is-single-point');
      expect(html).toContain('>Work On</th>');
      expect(html).toContain('>Went Beyond</th>');
      expect(html).toContain('Label the variables.');
      expect(html).toContain('Ran a second trial.');
      expect(html).toContain('Meets: Inquiry');
      expect(html).toContain('<span class="rubric-sp-level">Proficient +</span>');
      // No four-level columns.
      expect(html).not.toContain('>Extending</th>');
    });

    it('leaves out a note column nobody wrote in, and both when notes are off', () => {
      saveRubricCriterionComment(CID, SID, AID, CRIT_A, 'Label the variables.');
      const data = RubricPrint.sheetData(CID, AID, SID);
      const html = RubricPrint.renderSheet(data, { include });
      expect(html).toContain('>Work On</th>');
      expect(html).not.toContain('>Went Beyond</th>');
      const off = RubricPrint.renderSheet(data, { include: Object.assign({}, include, { criterionComments: false }) });
      expect(off).not.toContain('>Work On</th>');
      expect(off).not.toContain('Label the variables.');
    });

    it('a blank copy keeps both note columns empty to write in', () => {
      const data = RubricPrint.blankSheetData(CID, getRubricById(CID, RUBRIC), getAssessments(CID)[0]);
      const html = RubricPrint.renderSheet(data, { include: { codes: true } });
      expect(html).toContain('>Work On</th>');
      expect(html).toContain('>Went Beyond</th>');
      expect(html).not.toContain('rubric-sp-level');
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
      expect(r.name).toBe('Competency Rubric');
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

    describe('a competency from the curriculum bank', () => {
      const BANK = {
        ids: { 'bc.sci9.cc.1': 0 },
        levels: [
          [
            'The student is beginning to ask questions about the natural world.',
            'The student asks questions about the natural world with growing consistency.',
            'The student consistently asks questions about the natural world.',
            'The student asks questions about the natural world with depth and complexity.',
          ],
        ],
      };
      beforeEach(() => {
        getTagById(CID, TAG_1).bank_id = 'bc.sci9.cc.1';
      });
      afterEach(() => {
        delete window.BANK_PROFICIENCY;
        delete getTagById(CID, TAG_1).bank_id;
        _competencyDescriptors = null;
      });

      it('prints the bank’s four descriptors once they have loaded', () => {
        window.BANK_PROFICIENCY = BANK;
        const r = RubricPrint.defaultRubric(CID, getAssessments(CID)[0]);
        expect(r.criteria[0].levels).toEqual({
          1: BANK.levels[0][0],
          2: BANK.levels[0][1],
          3: BANK.levels[0][2],
          4: BANK.levels[0][3],
        });
        // A competency with no bank id keeps the general wording.
        expect(r.criteria[1].levels[3]).toBe(RubricPrint.GENERAL_LEVELS[3]);
      });

      it('prints the general wording until the bank’s wording has loaded', () => {
        const r = RubricPrint.defaultRubric(CID, getAssessments(CID)[0]);
        expect(r.criteria[0].levels[3]).toBe(RubricPrint.GENERAL_LEVELS[3]);
        expect(RubricPrint.classUsesBankLevels(CID)).toBe(true);
        window.BANK_PROFICIENCY = BANK;
        expect(RubricPrint.classUsesBankLevels(CID)).toBe(false);
      });

      it('lets the teacher’s own wording win, level by level', () => {
        window.BANK_PROFICIENCY = BANK;
        const tag = getTagById(CID, TAG_1);
        localStorage.setItem(
          'gb-competency-descriptors',
          JSON.stringify({ [RubricDraft.competencyKey(tag)]: { 3: 'Asks a testable question.' } }),
        );
        _competencyDescriptors = null;
        const r = RubricPrint.defaultRubric(CID, getAssessments(CID)[0]);
        expect(r.criteria[0].levels[3]).toBe('Asks a testable question.');
        expect(r.criteria[0].levels[4]).toBe(BANK.levels[0][3]);
      });

      it('prints the bank’s wording on the student’s sheet', () => {
        window.BANK_PROFICIENCY = BANK;
        const html = RubricPrint.renderSheet(RubricPrint.sheetData(CID, AID_TAGS, SID), RubricPrint.DEFAULT_OPTIONS);
        expect(html).toContain('consistently asks questions about the natural world');
      });

      it('needs no load when the wording is already there', async () => {
        window.BANK_PROFICIENCY = BANK;
        await expect(RubricPrint.loadBankLevels()).resolves.toBe(true);
      });
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

  describe('Score sheets for points and Complete/Incomplete work', () => {
    const AID_PTS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const AID_CI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    beforeEach(() => {
      saveAssessments(CID, [
        {
          id: AID_PTS,
          title: 'Quiz 3',
          date: '2026-10-10',
          type: 'summative',
          scoreMode: 'points',
          maxPoints: 20,
          tagIds: [],
        },
        { id: AID_CI, title: 'Reading log', date: '2026-10-11', type: 'formative', scoreMode: 'complete', tagIds: [] },
      ]);
      saveScores(CID, {
        [SID]: [
          {
            id: 'p1',
            assessmentId: AID_PTS,
            tagId: 'overall',
            score: 18,
            date: '2026-10-10',
            type: 'summative',
            note: 'Check question 4.',
          },
          {
            id: 'c1',
            assessmentId: AID_CI,
            tagId: 'overall',
            score: 1,
            date: '2026-10-11',
            type: 'formative',
            note: '',
          },
        ],
        [SID2]: [
          {
            id: 'c2',
            assessmentId: AID_CI,
            tagId: 'overall',
            score: 0,
            date: '2026-10-11',
            type: 'formative',
            note: '',
          },
        ],
      });
    });

    it('prints the points, out of the most, the percent and the feedback', () => {
      const data = RubricPrint.sheetData(CID, AID_PTS, SID);
      expect(data.scoreOnly).toBe(true);
      expect(data.overall).toMatchObject({ text: '18 / 20', word: '90%' });
      const html = RubricPrint.renderSheet(data, RubricPrint.DEFAULT_OPTIONS);
      expect(html).toContain('Score');
      expect(html).toContain('18 / 20');
      expect(html).toContain('Check question 4.');
      expect(html).not.toContain('rubric-table');
    });

    it('prints Complete or Incomplete, and an Incomplete counts as scored', () => {
      expect(RubricPrint.sheetData(CID, AID_CI, SID).overall.text).toBe('Complete');
      expect(RubricPrint.sheetData(CID, AID_CI, SID2).overall.text).toBe('Incomplete');
      expect(RubricPrint.isStudentScored(CID, AID_CI, SID2)).toBe(true);
      expect(RubricPrint.isStudentScored(CID, AID_PTS, SID2)).toBe(false);
    });

    it('leaves the score off when not included, and prints a sheet per scored student', () => {
      const opts = Object.assign({}, RubricPrint.DEFAULT_OPTIONS, {
        include: Object.assign({}, RubricPrint.DEFAULT_OPTIONS.include, { overall: false }),
      });
      expect(RubricPrint.renderSheet(RubricPrint.sheetData(CID, AID_PTS, SID), opts)).not.toContain('18 / 20');
      const out = RubricPrint.renderPages(
        CID,
        AID_CI,
        Object.assign({}, RubricPrint.DEFAULT_OPTIONS, { students: 'scored' }),
      );
      expect(out.sheets).toBe(2);
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
      expect(RubricPrint.renderPages(CID, null, Object.assign({ copies: 99 }, base)).sheets).toBe(
        RubricPrint.MAX_COPIES,
      );
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
});

describe('rubric-attached-to-scored-work', () => {
  /**
   * Work graded by competency, then given a rubric (the assessment form's
   * Save Changes, a linked copy's edit, another tab). The marks under the
   * competencies move to the rubric's criteria when the scores are read
   * (_migrateRubricScoreKeys), as a reload moves them. They used to stay
   * where they were until a reload, once the scores had been read under the
   * same rubrics: the criteria read blank, the next grade anywhere in a
   * class that holds grades made every student's grade on the work a
   * Draft, and signed in, a whole-class save sent upsert_score 0 for every
   * student on the work, because the server writers read the piece as the
   * class load sent it (_assessmentById), without its rubric.
   */
  const CID = U(901);
  const SIDS = [U(911), U(912), U(913)];
  const ESSAY = U(931); // graded by competency, then given the rubric
  const QUIZ = U(932); // other work, graded after
  const RUBRIC = U(971);
  const Q1 = U(972);
  const Q2 = U(973);
  const Q3 = U(974);
  const CI = U(981);
  const CP = U(982);

  const rubric = {
    id: RUBRIC,
    name: 'Reading Questions',
    criteria: [
      { id: Q1, name: 'Question 1', tagIds: [CI], levels: {} },
      { id: Q2, name: 'Question 2', tagIds: [CI], levels: {} },
      { id: Q3, name: 'Question 3', tagIds: [CP], levels: {} },
    ],
  };
  const essay = { id: ESSAY, title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: [CI, CP] };
  const quiz = { id: QUIZ, title: 'Quiz', date: '2026-10-12', type: 'summative', tagIds: [CI] };
  const mark = (sid, aid, tid, score) => ({
    id: sid + ':' + aid + ':' + tid,
    assessmentId: aid,
    tagId: tid,
    score,
    date: '2026-10-10',
    type: 'summative',
    note: '',
    created: '2026-10-10T17:00:00.000Z',
  });
  // CI and CP levels per student, before the rubric.
  const LEVELS = [
    [3, 2],
    [4, 3],
    [2, 1],
  ];
  const byCriterion = LEVELS.map(([ci, cp]) => ({ [Q1]: ci, [Q2]: ci, [Q3]: cp }));

  function seed(withRubric) {
    const scores = {};
    SIDS.forEach((sid, i) => {
      scores[sid] = withRubric
        ? [mark(sid, ESSAY, Q1, LEVELS[i][0]), mark(sid, ESSAY, Q2, LEVELS[i][0]), mark(sid, ESSAY, Q3, LEVELS[i][1])]
        : [mark(sid, ESSAY, CI, LEVELS[i][0]), mark(sid, ESSAY, CP, LEVELS[i][1])];
    });
    seedClass(CID, {
      students: SIDS.map((id, i) => ({ id, firstName: ['Ava', 'Ben', 'Cy'][i], lastName: 'Test' })),
      assessments: [Object.assign({}, essay, withRubric ? { rubricId: RUBRIC } : {}), structuredClone(quiz)],
      rubrics: [structuredClone(rubric)],
      scores,
      courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
    });
    _noteRubricsSet(CID);
  }
  /* The class's pieces as the class load keeps them (_v2GradebookToCache):
     the server's rows, read by the server writers through _assessmentById. */
  function loadedRows() {
    _cache.v2Gradebook[CID] = {
      assessments: getAssessments(CID).map(a => ({
        id: a.id,
        title: a.title,
        score_mode: 'proficiency',
        rubric_id: a.rubricId || null,
        has_rubric: !!a.rubricId,
        tag_ids: a.tagIds.slice(),
        collab_mode: null,
      })),
    };
  }
  // Attach the rubric as the assessment form's Save Changes does: the stored
  // row changed in place, then the list saved.
  function attach() {
    const list = getAssessments(CID);
    list.find(a => a.id === ESSAY).rubricId = RUBRIC;
    saveAssessments(CID, list);
  }
  const essayLevels = blob =>
    SIDS.map(sid => {
      const out = {};
      (blob[sid] || []).forEach(e => {
        if (e.assessmentId === ESSAY) out[e.tagId] = e.score;
      });
      return out;
    });
  const scoreCalls = calls => calls.filter(([name]) => /score|clear/.test(name));
  const onEssay = calls => scoreCalls(calls).filter(([, p]) => p.p_assessment_id === ESSAY);

  afterEach(() => {
    if (_cache.v2Gradebook) delete _cache.v2Gradebook[CID];
    clearClass(CID);
  });

  describe('on this device only', () => {
    beforeEach(() => {
      localStorage.clear();
      seed(false);
    });

    it('moves the marks to the criteria at once, and the next grade makes no Draft on the work', () => {
      // A screen read the scores before the rubric was attached.
      expect(essayLevels(getScores(CID))).toEqual(LEVELS.map(([ci, cp]) => ({ [CI]: ci, [CP]: cp })));
      attach();
      expect(essayLevels(getScores(CID))).toEqual(byCriterion);
      // Each criterion reads its level through the key the screens use.
      expect(
        SIDS.map(sid =>
          rubric.criteria.map(c => {
            const keys = rubricCriterionScoreKeys(c);
            const e = getScores(CID)[sid].find(x => x.assessmentId === ESSAY && keys.includes(x.tagId));
            return e ? e.score : null;
          }),
        ),
      ).toEqual(byCriterion.map(b => [b[Q1], b[Q2], b[Q3]]));

      upsertScore(CID, SIDS[1], QUIZ, CI, 4, '2026-10-12', 'summative', '');
      SIDS.forEach(sid => expect(GradeState.stateOf(CID, sid, ESSAY)).toBe(null));
      expect(getGradeReturns(CID)[ESSAY]).toBeUndefined();
      // The quiz's own grade is a Draft, as any grade in a class that holds them.
      expect(GradeState.stateOf(CID, SIDS[1], QUIZ)).toBe('draft');
      // No level changed, on the screen or in the saved copy.
      expect(essayLevels(getScores(CID))).toEqual(byCriterion);
      expect(essayLevels(stored('scores', CID))).toEqual(byCriterion);
    });

    it('a whole-class save after the attach makes no Draft on the work either', () => {
      getScores(CID);
      attach();
      const scores = getScores(CID);
      scores[SIDS[0]].push(mark(SIDS[0], QUIZ, CI, 3));
      saveScores(CID, scores);
      SIDS.forEach(sid => expect(GradeState.stateOf(CID, sid, ESSAY)).toBe(null));
      expect(essayLevels(stored('scores', CID))).toEqual(byCriterion);
    });
  });

  describe('signed in', () => {
    let session;
    beforeEach(() => {
      localStorage.clear();
      session = signIn();
    });
    afterEach(() => session.signOut());

    it('a whole-class save after the attach sends nothing for the work', async () => {
      seed(false);
      loadedRows();
      getScores(CID);
      attach();
      await settle();
      session.since();
      const scores = getScores(CID);
      scores[SIDS[0]].push(mark(SIDS[0], QUIZ, CI, 3));
      saveScores(CID, scores);
      await settle();
      const sent = session.since();
      expect(onEssay(sent)).toEqual([]);
      expect(scoreCalls(sent)).toEqual([
        ['upsert_tag_score', expect.objectContaining({ p_assessment_id: QUIZ, p_tag_id: CI, p_value: 3 })],
      ]);
      expect(essayLevels(getScores(CID))).toEqual(byCriterion);
    });

    it('a criterion graded after the attach goes up as its rubric score', async () => {
      seed(false);
      loadedRows();
      getScores(CID);
      attach();
      await settle();
      session.since();
      upsertScore(CID, SIDS[0], ESSAY, Q3, 4, '2026-10-10', 'summative', '');
      await settle();
      expect(onEssay(session.since())).toEqual([
        ['upsert_rubric_score', expect.objectContaining({ p_enrollment_id: SIDS[0], p_criterion_id: Q3, p_value: 4 })],
      ]);
    });

    it('a competency graded after the rubric is taken off goes up as its competency score', async () => {
      seed(true);
      loadedRows();
      getScores(CID);
      const list = getAssessments(CID);
      list.find(a => a.id === ESSAY).rubricId = undefined;
      saveAssessments(CID, list);
      await settle();
      session.since();
      upsertScore(CID, SIDS[0], ESSAY, CP, 4, '2026-10-10', 'summative', '');
      await settle();
      expect(onEssay(session.since())).toEqual([
        ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: SIDS[0], p_tag_id: CP, p_value: 4 })],
      ]);
    });

    it('work whose rubric did not change is read as the class load sent it', () => {
      seed(false);
      loadedRows();
      const row = _cache.v2Gradebook[CID].assessments.find(a => a.id === QUIZ);
      expect(_assessmentById(CID, QUIZ)).toBe(row);
      expect(_assessmentById(CID, ESSAY)).toBe(_cache.v2Gradebook[CID].assessments.find(a => a.id === ESSAY));
    });
  });
});
