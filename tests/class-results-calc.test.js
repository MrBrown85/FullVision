/**
 * Class Results (docs/plans/class-results-plan.md): the numbers behind the
 * Class Average's hover card and the Class Results panel. Every helper
 * counts a student the way the Class Average does (classColumnAverage):
 * Missing is 0 in a Letter class and left out in a Proficiency or Both
 * class; Excused is always left out.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'teacher/class-results.js'), 'utf-8'), { filename: 'class-results.js' });

const CID = 'course-cr';
const STUDENTS = ['s1', 's2', 's3', 's4', 's5'].map(id => ({ id, firstName: id, lastName: 'Test' }));
const TAG = 'T1';
const TAG2 = 'T2';

const level = (id, extra) =>
  Object.assign(
    { id, title: id, scoreMode: 'proficiency', tagIds: [TAG], type: 'summative', date: '2026-10-10' },
    extra,
  );
const points = (id, max, extra) =>
  Object.assign({ id, title: id, scoreMode: 'points', maxPoints: max, tagIds: [], date: '2026-10-10' }, extra);
const complete = (id, extra) =>
  Object.assign({ id, title: id, scoreMode: 'complete', maxPoints: 1, tagIds: [], date: '2026-10-10' }, extra);
const entry = (assessmentId, value, tagId = TAG, extra) =>
  Object.assign({ assessmentId, tagId, score: value, date: '2026-10-10' }, extra);

function seed({ gradingSystem = 'proficiency', assessments, scores = {}, statuses = {}, rubrics = [], obs = {} }) {
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem, levelOrder: 'asc' };
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = scores;
  _cache.statuses[CID] = statuses;
  _cache.rubrics[CID] = rubrics;
  _cache.categories[CID] = [];
  _cache.observations[CID] = obs;
  _cache.students[CID] = STUDENTS;
  _cache.courseConfigs[CID] = { roundPercent: true };
  clearProfCache();
}

afterEach(() => {
  delete COURSES[CID];
  localStorage.clear();
});

describe('medianOf', () => {
  it('takes the middle, or the mean of the two middle values', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
});

describe('classColumnSpread and classColumnLevelCounts', () => {
  const a = level('lv');
  const scores = {
    s1: [entry('lv', 1)],
    s2: [entry('lv', 2)],
    s3: [entry('lv', 3, TAG, { mod: 1 })],
    s4: [],
    s5: [],
  };
  const statuses = { 's4:lv': 'NS', 's5:lv': 'EXC' };

  it('leaves Missing and Excused out in a Proficiency class', () => {
    seed({ assessments: [a], scores, statuses });
    const spread = classColumnSpread(CID, STUDENTS, { assessment: a });
    expect(spread.count).toBe(3);
    expect(spread.values.map(v => v.sid)).toEqual(['s1', 's2', 's3']);
    expect(spread.median).toBe(2);
    expect(spread.low).toBe(1);
    expect(spread.high).toBeCloseTo(3.333, 2);
    const counts = classColumnLevelCounts(CID, STUDENTS, { assessment: a });
    expect(counts.counts).toEqual({ 1: 1, 2: 1, 3: 1, 4: 0 });
    expect(counts.scored).toBe(3);
  });

  it('counts Missing as 0 (Emerging) and still leaves Excused out in a Letter class', () => {
    seed({ gradingSystem: 'letter', assessments: [a], scores, statuses });
    const spread = classColumnSpread(CID, STUDENTS, { assessment: a });
    expect(spread.count).toBe(4);
    expect(spread.values[0]).toEqual({ sid: 's4', value: 0 });
    expect(spread.median).toBe(1.5);
    const counts = classColumnLevelCounts(CID, STUDENTS, { assessment: a });
    expect(counts.counts[1]).toBe(2);
    expect(counts.ids[1].sort()).toEqual(['s1', 's4']);
    // The same students as the Class Average.
    expect(classColumnAverage(CID, STUDENTS, { assessment: a }).count).toBe(spread.count);
  });

  it('writes figures as the class reads them', () => {
    seed({ gradingSystem: 'letter', assessments: [a], scores, statuses });
    const spread = classColumnSpread(CID, STUDENTS, { assessment: a });
    expect(classSpreadRangeText(CID, a, spread)).toMatch(/^0–\d+%$/);
    seed({ gradingSystem: 'both', assessments: [a], scores, statuses });
    const both = classColumnSpread(CID, STUDENTS, { assessment: a });
    expect(classSpreadText(CID, a, both.median)).toBe('2.0 · 50%');
    expect(classSpreadRangeText(CID, a, both)).toBe('1.0–3.3');
    seed({ assessments: [a], scores, statuses });
    expect(classSpreadText(CID, a, 2)).toBe('2.0');
  });

  it('reads points work as points, Missing as 0 and Excused out', () => {
    const q = points('quiz', 20);
    seed({
      assessments: [q],
      scores: { s1: [entry('quiz', 18, 'overall')], s2: [entry('quiz', 10, 'overall')], s3: [], s4: [], s5: [] },
      statuses: { 's3:quiz': 'NS', 's4:quiz': 'EXC' },
    });
    const spread = classColumnSpread(CID, STUDENTS, { assessment: q });
    expect(spread.points).toBe(true);
    expect(spread.values.map(v => v.value)).toEqual([0, 10, 18]);
    expect(spread.median).toBe(10);
    expect(classSpreadText(CID, q, spread.median, true)).toBe('10/20');
    expect(classSpreadRangeText(CID, q, spread)).toBe('0–18/20');
    // Default scale: 18/20 is Extending, 10/20 Developing, 0 Emerging.
    expect(classColumnLevelCounts(CID, STUDENTS, { assessment: q }).counts).toEqual({ 1: 1, 2: 1, 3: 0, 4: 1 });
  });

  it('puts the level bands in the class order', () => {
    seed({ assessments: [a] });
    expect(levelBands(CID).map(b => b.level)).toEqual([1, 2, 3, 4]);
    _cache.courseConfigs[CID] = { levelOrder: 'desc' };
    expect(levelBands(CID).map(b => b.label)).toEqual(['Extending', 'Proficient', 'Developing', 'Emerging']);
  });
});

describe('the panel median agrees with the Assignments ledger', () => {
  it('uses the same median with Missing as 0', () => {
    const q = points('quiz', 50);
    seed({
      assessments: [q],
      scores: {
        s1: [entry('quiz', 38, 'overall')],
        s2: [entry('quiz', 27, 'overall')],
        s3: [entry('quiz', 44, 'overall')],
        s4: [],
        s5: [],
      },
      statuses: { 's4:quiz': 'NS', 's5:quiz': 'EXC' },
    });
    // The ledger's rule (refreshLedgerSummary): every marked score, plus a 0
    // for each Missing row; Excused and unmarked rows left out.
    const ledger = medianOf([38, 27, 44, 0]);
    expect(classColumnSpread(CID, STUDENTS, { assessment: q }).median).toBe(ledger);
    expect(ledger).toBe(32.5);
  });
});

describe('results grids', () => {
  const rubric = {
    id: 'rb',
    name: 'Lab Rubric',
    criteria: [
      { id: 'c2', name: 'Analysis', tagIds: [TAG], displayOrder: 1 },
      { id: 'c1', name: 'Method', tagIds: [TAG], displayOrder: 0 },
      { id: 'c3', name: 'Neatness', tagIds: [], displayOrder: 2 },
    ],
  };
  const lab = level('lab', { rubricId: 'rb', tagIds: [TAG] });
  const scores = {
    s1: [entry('lab', 3, 'c1'), entry('lab', 1, 'c2'), entry('lab', 4, 'c3')],
    s2: [entry('lab', 2, 'c1'), entry('lab', 2, 'c2')],
    s3: [entry('lab', 4, 'c1'), entry('lab', 4, 'c2'), entry('lab', 3, 'c3')],
    s4: [],
    s5: [entry('lab', 4, 'c1')],
  };

  it('counts each criterion in rubric order, Excused left out', () => {
    seed({ assessments: [lab], scores, rubrics: [rubric], statuses: { 's5:lab': 'EXC' } });
    const grid = classRubricGrid(CID, STUDENTS, lab);
    expect(grid.rows.map(r => r.name)).toEqual(['Method', 'Analysis', 'Neatness']);
    expect(grid.rows[0].counts).toEqual({ 1: 0, 2: 1, 3: 1, 4: 1 });
    expect(grid.rows[0].avg).toBe(3);
    expect(grid.rows[1].ids[1]).toEqual(['s1']);
    expect(grid.rows[2].count).toBe(2);
  });

  it('is null with no rubric', () => {
    seed({ assessments: [level('lv')] });
    expect(classRubricGrid(CID, STUDENTS, level('lv'))).toBeNull();
  });

  it('gives a competency the lowest of criteria that disagree, and a criterion with no competency its own row', () => {
    seed({ assessments: [lab], scores, rubrics: [rubric] });
    const grid = classCompetencyGrid(CID, STUDENTS, lab);
    expect(grid.rows.map(r => r.id)).toEqual([TAG, 'c3']);
    // s1: 3 and 1 disagree, so 1. s2: 2. s3: 4. s5: only Method, 4.
    expect(grid.rows[0].counts).toEqual({ 1: 1, 2: 1, 3: 0, 4: 2 });
    expect(grid.rows[0].kind).toBe('competency');
    expect(grid.rows[1].kind).toBe('criterion');
    expect(grid.rows[1].name).toBe('Neatness');
  });

  it('reads each competency score on work with no rubric', () => {
    const two = level('two', { tagIds: [TAG, TAG2] });
    seed({
      assessments: [two],
      scores: { s1: [entry('two', 3), entry('two', 2, TAG2)], s2: [entry('two', 4)], s3: [], s4: [], s5: [] },
    });
    const grid = classCompetencyGrid(CID, STUDENTS, two);
    expect(grid.rows.map(r => r.id)).toEqual([TAG, TAG2]);
    expect(grid.rows[0].counts).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1 });
    expect(grid.rows[1].counts[2]).toBe(1);
  });
});

describe('classColumnStatusCounts', () => {
  it('lists Missing, Excused, Late and unmarked students', () => {
    const a = level('lv');
    seed({
      assessments: [a],
      scores: { s1: [entry('lv', 3)], s2: [entry('lv', 2)], s3: [], s4: [], s5: [] },
      statuses: { 's2:lv': 'LATE', 's3:lv': 'NS', 's4:lv': 'EXC' },
    });
    const res = classColumnStatusCounts(CID, STUDENTS, a);
    expect(res).toMatchObject({
      scored: 2,
      total: 5,
      missing: ['s3'],
      excused: ['s4'],
      late: ['s2'],
      unmarked: ['s5'],
    });
  });
});

describe('classFeedbackCounts', () => {
  it('counts an overall comment or a criterion comment, over scored students only', () => {
    const rubric = { id: 'rb', criteria: [{ id: 'c1', name: 'Method', tagIds: [TAG] }] };
    const lab = level('lab', { rubricId: 'rb' });
    seed({
      assessments: [lab],
      rubrics: [rubric],
      scores: {
        s1: [entry('lab', 3, 'c1', { note: 'Good work' })],
        s2: [entry('lab', 2, 'c1', { critNote: 'Label the axes' })],
        s3: [entry('lab', 2, 'c1')],
        s4: [],
        s5: [],
      },
      statuses: { 's4:lab': 'NS' },
    });
    const res = classFeedbackCounts(CID, STUDENTS, lab);
    expect(res.withComment).toEqual(['s1', 's2']);
    expect(res.without).toEqual(['s3']);
  });
});

describe('ClassResults.assessmentObservations (observations stay out of calc.js)', () => {
  it('lists the observations linked to the assessment, newest first', () => {
    const a = level('lv');
    seed({
      assessments: [a],
      obs: {
        s1: [
          { id: 'o1', text: 'Older', created: '2026-10-01T10:00:00Z', assignmentContext: { assessmentId: 'lv' } },
          { id: 'o2', text: 'Other work', created: '2026-10-05T10:00:00Z', assignmentContext: { assessmentId: 'x' } },
        ],
        s2: [
          {
            id: 'o3',
            text: 'Newer',
            sentiment: 'growth',
            created: '2026-10-09T10:00:00Z',
            assignmentContext: { assessmentId: 'lv' },
          },
        ],
      },
    });
    const list = ClassResults.assessmentObservations(CID, a);
    expect(list.map(o => o.id)).toEqual(['o3', 'o1']);
    expect(list[0]).toMatchObject({ studentId: 's2', sentiment: 'growth', date: '2026-10-09' });
  });
});

describe('earlierInCategory', () => {
  it('takes earlier work in the same category scored the same way, newest first', () => {
    const now = level('now', { categoryId: 'cat', date: '2026-10-20' });
    const work = [
      level('e1', { categoryId: 'cat', date: '2026-09-01' }),
      level('e2', { categoryId: 'cat', date: '2026-09-15' }),
      level('e3', { categoryId: 'cat', date: '2026-10-01' }),
      level('e4', { categoryId: 'cat', date: '2026-10-05' }),
      points('pts', 10, { categoryId: 'cat', date: '2026-10-06' }),
      level('other', { categoryId: 'cat2', date: '2026-10-07' }),
      level('later', { categoryId: 'cat', date: '2026-10-25' }),
      level('empty', { categoryId: 'cat', date: '2026-10-08' }),
      now,
    ];
    const scores = { s1: [], s2: [], s3: [], s4: [], s5: [] };
    ['e1', 'e2', 'e3', 'e4', 'pts', 'other', 'later', 'now'].forEach(id => {
      scores.s1.push(entry(id, id === 'pts' ? 8 : 3, id === 'pts' ? 'overall' : TAG));
    });
    seed({ assessments: work, scores });
    const res = earlierInCategory(CID, now);
    expect(res.map(r => r.assessment.id)).toEqual(['e4', 'e3', 'e2']);
    expect(res[0].text).toBe('3.0');
    expect(earlierInCategory(CID, work[0])).toBeNull();
    // Points work compares with points work only.
    expect(earlierInCategory(CID, work[4])).toBeNull();
  });
});

describe('pointsBands', () => {
  it('bands scores by points, each by level, and names the points each level takes', () => {
    const q = points('quiz', 50);
    seed({
      assessments: [q],
      scores: {
        s1: [entry('quiz', 18, 'overall')],
        s2: [entry('quiz', 27, 'overall')],
        s3: [entry('quiz', 50, 'overall')],
        s4: [entry('quiz', 49, 'overall')],
        s5: [],
      },
      statuses: { 's5:quiz': 'NS' },
    });
    const res = pointsBands(CID, STUDENTS, q);
    expect(res.size).toBe(5);
    expect(res.bands).toHaveLength(10);
    expect(res.bands[9]).toMatchObject({ lo: 45, hi: 50 });
    expect(res.bands[9].ids.sort()).toEqual(['s3', 's4']);
    expect(res.bands[0].ids).toEqual(['s5']); // Missing counts as 0
    expect(res.bands[3].byLevel[1]).toEqual(['s1']);
    expect(res.bands[5].byLevel[2]).toEqual(['s2']);
    // Default scale: 86% Extending, 73% Proficient, 50% Developing.
    expect(res.levelRanges).toEqual({ 1: 'under 25', 2: '25–36', 3: '37–42', 4: '43–50' });
  });

  it('is null for Complete/Incomplete work', () => {
    seed({ assessments: [complete('hw')] });
    expect(pointsBands(CID, STUDENTS, complete('hw'))).toBeNull();
  });
});

describe('completionCounts', () => {
  it('sorts students by mark and status, with the % as the Class Average counts it', () => {
    const hw = complete('hw');
    seed({
      assessments: [hw],
      scores: {
        s1: [entry('hw', 1, 'overall')],
        s2: [entry('hw', 1, 'overall')],
        s3: [entry('hw', 0, 'overall')],
        s4: [],
        s5: [],
      },
      statuses: { 's4:hw': 'NS' },
    });
    const res = completionCounts(CID, STUDENTS, hw);
    expect(res).toMatchObject({
      complete: ['s1', 's2'],
      incomplete: ['s3'],
      unmarked: ['s5'],
      missing: ['s4'],
      excused: [],
    });
    expect(res.pct).toBe(50);
  });
});

describe('dibelsClassResults', () => {
  const d = { id: 'dib', title: 'DIBELS 8 Benchmark', scoreMode: 'dibels', tagIds: [], date: '2026-09-15' };
  const put = (sid, period, wrc, errors) => {
    const key = sid + ':dib';
    _cache.dibels[CID] = _cache.dibels[CID] || {};
    _cache.dibels[CID][key] = _cache.dibels[CID][key] || {};
    _cache.dibels[CID][key][period] = { orfWrc: wrc, orfErrors: errors, mazeCorrect: null, mazeIncorrect: null };
  };

  beforeEach(() => {
    _cache.dibels[CID] = {};
  });

  it('counts reading levels per window and who moved', () => {
    seed({ assessments: [d], statuses: { 's5:dib': 'EXC' } });
    put('s1', 'boy', 130, null); // core
    put('s1', 'moy', 120, null); // strategic: down
    put('s2', 'boy', 100, null); // intensive
    put('s2', 'moy', 140, null); // core: up
    put('s3', 'boy', 150, null); // above
    put('s3', 'moy', 160, null); // above: same
    put('s5', 'moy', 50, null); // excused, left out
    const res = dibelsClassResults(CID, STUDENTS, d);
    expect(res.latest).toBe('moy');
    expect(res.previous).toBe('boy');
    expect(res.periods.moy.counts).toEqual({ intensive: 0, strategic: 1, core: 1, above: 1 });
    expect(res.periods.moy.tested).toBe(3);
    expect(res.periods.moy.medianWrc).toBe(140);
    expect(res.periods.moy.medianAccuracy).toBeNull();
    expect(res.moved.down).toEqual([{ sid: 's1', from: 'core', to: 'strategic' }]);
    expect(res.moved.up.map(m => m.sid)).toEqual(['s2']);
    expect(res.moved.same.map(m => m.sid)).toEqual(['s3']);
    expect(res.periods.eoy.tested).toBe(0);
  });

  it('gives the median accuracy where errors are entered', () => {
    seed({ assessments: [d] });
    put('s1', 'boy', 90, 10); // 90%
    put('s2', 'boy', 95, 5); // 95%
    put('s3', 'boy', 120, null);
    const res = dibelsClassResults(CID, STUDENTS, d);
    expect(res.periods.boy.medianAccuracy).toBe(92.5);
    expect(res.rows.s1.boy).toEqual({ wrc: 90, accuracy: 90, level: 'intensive' });
    expect(res.moved).toEqual({ up: [], same: [], down: [] });
  });
});

describe('assessmentCourseShare', () => {
  it("gives the piece's share of its category times the category's weight", () => {
    seed({
      gradingSystem: 'letter',
      assessments: [
        points('q1', 20, { categoryId: 'quiz' }),
        points('q2', 30, { categoryId: 'quiz' }),
        level('lab', { categoryId: 'labs' }),
      ],
    });
    _cache.categories[CID] = [
      { id: 'quiz', name: 'Quizzes', weight: 40 },
      { id: 'labs', name: 'Labs', weight: 60 },
    ];
    clearProfCache();
    // 20 of the category's 50 points, in a 40% category: 16%.
    expect(assessmentCourseShare(CID, points('q1', 20, { categoryId: 'quiz' }))).toBe(16);
    expect(assessmentCourseShare(CID, level('lab', { categoryId: 'labs' }))).toBe(60);
  });

  it('is null in a Proficiency class', () => {
    seed({ assessments: [points('q1', 20)] });
    expect(assessmentCourseShare(CID, points('q1', 20))).toBeNull();
  });
});

describe('ClassResults.cardHtml (the Class Average card)', () => {
  it('shows the average, the counts, the median and range and the status chips, escaped', () => {
    const a = level('lv', { title: '<b>Lab</b>' });
    seed({
      gradingSystem: 'letter',
      assessments: [a],
      scores: { s1: [entry('lv', 3)], s2: [entry('lv', 2)], s3: [entry('lv', 4)], s4: [], s5: [] },
      statuses: { 's4:lv': 'NS', 's5:lv': 'EXC', 's2:lv': 'LATE' },
    });
    const html = ClassResults.cardHtml(CID, STUDENTS, a);
    expect(html).toContain('Class Average');
    expect(html).toContain('3 of 5 scored');
    expect(html).toContain('Median');
    expect(html).toContain('1 missing');
    expect(html).toContain('1 excused');
    expect(html).toContain('1 late');
    expect(html).toContain('View Class Results');
    expect(html).not.toContain('<b>Lab</b>');
  });

  it('is empty for DIBELS work', () => {
    const d = { id: 'dib', title: 'DIBELS', scoreMode: 'dibels', tagIds: [] };
    seed({ assessments: [d] });
    expect(ClassResults.cardHtml(CID, STUDENTS, d)).toBe('');
  });
});
