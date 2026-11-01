/**
 * Grade math audit (2026-11-01). Two layers:
 *  1. Teacher scenarios: hand-worked numbers a teacher would check on paper,
 *     one per rule in docs/DECISIONS.md (course %, Factor, extra credit,
 *     Missing/Excused, categories, Average of Percentages, rubrics, Counts As,
 *     rounding and letters, competency methods, + and −, groups, overrides).
 *  2. An independent reference model of the course % and the Mean competency
 *     level, written from the decisions rather than from calc.js, run against
 *     calc.js on hundreds of random classes, plus invariants every grade must
 *     hold (ranges, letter matches %, category shares add up, raising a score
 *     never lowers a grade).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'math-audit';
const SID = 'stu-1';

function seed(o) {
  COURSES[CID] = {
    id: CID,
    name: 'Audit',
    gradingSystem: o.gradingSystem || 'letter',
    gradeLevel: o.gradeLevel || '11',
    calcMethod: o.calcMethod || 'average',
  };
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: o.sections || [{ id: 'sec-1', name: 'S1', tags: [{ id: 't1', label: 'T1' }] }],
    competencyGroups: o.groups || [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = o.categories || [];
  _cache.assessments[CID] = o.assessments;
  _cache.scores[CID] = o.scores || {};
  _cache.statuses[CID] = o.statuses || {};
  _cache.rubrics[CID] = o.rubrics || [];
  _cache.overrides[CID] = o.overrides || {};
  _cache.courseConfigs[CID] = Object.assign({ calcMethod: o.calcMethod || 'average' }, o.config || {});
  clearProfCache();
}

const pts = (id, max, extra) =>
  Object.assign({ id, title: id, scoreMode: 'points', maxPoints: max, tagIds: ['t1'] }, extra);
const done = (id, extra) =>
  Object.assign({ id, title: id, scoreMode: 'complete', maxPoints: 1, tagIds: ['t1'] }, extra);
const lvl = (id, extra) => Object.assign({ id, title: id, tagIds: ['t1'] }, extra);
const sc = (aid, value, extra) =>
  Object.assign({ assessmentId: aid, tagId: 't1', score: value, mod: 0, date: '2026-10-10' }, extra);
const R = () => getCourseLetterData(CID, SID).R;
const S = () => getCourseLetterData(CID, SID).S;

afterEach(() => {
  delete COURSES[CID];
  localStorage.clear();
});

describe('teacher scenarios: course %', () => {
  it('points earned out of possible: 8/10 + 30/40 = 38/50 = 76%, a B', () => {
    seed({ assessments: [pts('q', 10), pts('t', 40)], scores: { [SID]: [sc('q', 8), sc('t', 30)] } });
    expect(R()).toBe(76);
    expect(S()).toBe('B');
  });

  it('a Factor multiplies earned and possible: 5/6 at 4x + 10/20 = 30/44 = 68%', () => {
    seed({
      assessments: [pts('q', 6, { weight: 4 }), pts('t', 20)],
      scores: { [SID]: [sc('q', 5), sc('t', 10)] },
    });
    expect(R()).toBe(68);
    expect(S()).toBe('C+');
  });

  it('extra credit counts up to twice the maximum', () => {
    seed({ assessments: [pts('q', 20)], scores: { [SID]: [sc('q', 25)] } });
    expect(R()).toBe(125);
    seed({ assessments: [pts('q', 20)], scores: { [SID]: [sc('q', 50)] } });
    expect(R()).toBe(200);
  });

  it('Missing is 0, Excused and ungraded are left out, a points 0 is a score', () => {
    seed({
      assessments: [pts('a', 10), pts('b', 10), pts('c', 10), pts('d', 10), pts('e', 10)],
      scores: { [SID]: [sc('a', 8), sc('e', 0)] },
      statuses: { [SID + ':b']: 'NS', [SID + ':c']: 'EXC' },
    });
    // 8 + 0 (Missing) + 0 (scored 0) out of 30
    expect(R()).toBe(27);
    // No reporting terms: the course never ends, so under 50 is IE.
    expect(S()).toBe('IE');
  });

  it('Complete is 1/1 and Incomplete 0/1', () => {
    seed({ assessments: [done('a'), done('b')], scores: { [SID]: [sc('a', 1), sc('b', 0)] } });
    expect(R()).toBe(50);
  });

  it('categories weight their own %: Tests 60% at 80, Labs 40% at 90 = 84', () => {
    const cats = [
      { id: 'tests', name: 'Tests', weight: 60 },
      { id: 'labs', name: 'Labs', weight: 40 },
    ];
    seed({
      categories: cats,
      assessments: [
        pts('t1', 20, { categoryId: 'tests' }),
        pts('t2', 30, { categoryId: 'tests' }),
        pts('l', 10, { categoryId: 'labs' }),
      ],
      scores: { [SID]: [sc('t1', 16), sc('t2', 24), sc('l', 9)] },
    });
    expect(R()).toBe(84);
    const shares = categoryCourseShares(CID, SID);
    expect(shares.tests.points + shares.labs.points).toBeCloseTo(84, 5);
  });

  it('a category with nothing graded yet drops out and the rest scale up', () => {
    seed({
      categories: [
        { id: 'tests', name: 'Tests', weight: 60 },
        { id: 'labs', name: 'Labs', weight: 40 },
      ],
      assessments: [pts('t', 50, { categoryId: 'tests' }), pts('l', 10, { categoryId: 'labs' })],
      scores: { [SID]: [sc('t', 40)] },
    });
    expect(R()).toBe(80);
  });

  it('0% category work counts toward neither the % nor the competency', () => {
    seed({
      gradingSystem: 'both',
      categories: [
        { id: 'f', name: 'Formative', weight: 0 },
        { id: 's', name: 'Summative', weight: 100 },
      ],
      assessments: [lvl('f1', { categoryId: 'f' }), lvl('s1', { categoryId: 's' })],
      scores: { [SID]: [sc('f1', 1), sc('s1', 3)] },
    });
    expect(R()).toBe(75);
    expect(getTagProficiency(CID, SID, 't1')).toBe(3);
  });

  it('Average of Percentages: 1/2 (50%) and 90/100 (90%) average to 70%', () => {
    const cats = [{ id: 'k', name: 'Work', weight: 100, calcMode: 'percent' }];
    seed({
      categories: cats,
      assessments: [pts('a', 2, { categoryId: 'k' }), pts('b', 100, { categoryId: 'k' })],
      scores: { [SID]: [sc('a', 1), sc('b', 90)] },
    });
    expect(categoryCalcMode(cats[0])).toBe('percent');
    expect(R()).toBe(70);
    _cache.categories[CID] = [{ id: 'k', name: 'Work', weight: 100 }];
    clearProfCache();
    // Total Points: 91 of 102
    expect(R()).toBe(89);
  });

  it('a level counts as level ÷ 4 by default: 3 and 3+ = 79%', () => {
    seed({ assessments: [lvl('a'), lvl('b')], scores: { [SID]: [sc('a', 3), sc('b', 3, { mod: 1 })] } });
    // (3 + 3.333) / 8
    expect(R()).toBe(79);
  });

  it('on the BC Letter Bands, 3 is 80 and 3+ is 86: 83%', () => {
    seed({
      assessments: [lvl('a'), lvl('b')],
      scores: { [SID]: [sc('a', 3), sc('b', 3, { mod: 1 })] },
      config: { gradingScale: { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents: BC_LETTER_BAND_PERCENTS } },
    });
    expect(R()).toBe(83);
    expect(formatLevel(CID, 10 / 3)).toBe('86%');
    expect(levelToPercent(CID, 2.9)).toBeGreaterThan(levelToPercent(CID, 8 / 3));
  });
});

describe('teacher scenarios: rubrics', () => {
  const rubric = {
    id: 'r',
    name: 'Essay',
    criteria: [
      { id: 'c1', name: 'Ideas', tagIds: ['t1'], weight: 2 },
      { id: 'c2', name: 'Style', tagIds: ['t1'], weight: 1 },
    ],
  };
  const essay = lvl('e', { rubricId: 'r' });
  const crit = (cid, value, extra) => sc('e', value, Object.assign({ tagId: cid }, extra));

  it('criteria count by weight: Ideas 3 (x2) and Style 4 = 10/12 = 83%, level 3.33', () => {
    seed({ rubrics: [rubric], assessments: [essay], scores: { [SID]: [crit('c1', 3), crit('c2', 4)] } });
    expect(R()).toBe(83);
    expect(getAssessmentOverallScore(CID, SID, 'e')).toBeCloseTo(10 / 3, 9);
  });

  it('Missing rubric work is 0 of every criterion; Excused is left out', () => {
    seed({
      rubrics: [rubric],
      assessments: [essay, pts('q', 12)],
      scores: { [SID]: [sc('q', 12)] },
      statuses: { [SID + ':e']: 'NS' },
    });
    // 12 of 12 + 0 of 12
    expect(R()).toBe(50);
    _cache.statuses[CID] = { [SID + ':e']: 'EXC' };
    clearProfCache();
    expect(R()).toBe(100);
  });

  it('a criterion with its own point values keeps them: 3 = 6 of 10', () => {
    const custom = {
      id: 'r2',
      name: 'Lab',
      criteria: [{ id: 'k', name: 'Data', tagIds: ['t1'], weight: 1, levelValues: { 1: 2, 2: 4, 3: 6, 4: 10 } }],
    };
    seed({ rubrics: [custom], assessments: [lvl('e', { rubricId: 'r2' })], scores: { [SID]: [crit('k', 3)] } });
    expect(R()).toBe(60);
    expect(getAssessmentOverallScore(CID, SID, 'e')).toBeCloseTo(2.4, 9);
  });

  it('each criterion is its own evidence for the competency it feeds', () => {
    seed({ rubrics: [rubric], assessments: [essay], scores: { [SID]: [crit('c1', 2), crit('c2', 4)] } });
    expect(getTagProficiency(CID, SID, 't1')).toBe(3);
  });
});

describe('teacher scenarios: rounding and letters', () => {
  const at = (pct, gradeLevel, roundPercent) => {
    seed({
      gradeLevel,
      assessments: [pts('a', 10000)],
      scores: { [SID]: [sc('a', pct * 100)] },
      config: roundPercent == null ? {} : { roundPercent },
    });
    return getCourseLetterData(CID, SID);
  };

  it('grades 10–12 show a whole % and the letter follows it', () => {
    expect(at(85.5, '11')).toMatchObject({ R: 86, S: 'A' });
    expect(at(85.49, '11')).toMatchObject({ R: 85, S: 'B' });
  });

  it('one decimal elsewhere, and the letter follows the % as shown', () => {
    expect(at(85.95, '9')).toMatchObject({ R: 86, S: 'A' });
    expect(at(85.94, '9')).toMatchObject({ R: 85.9, S: 'B' });
  });

  it('BC letter bands', () => {
    const cases = [
      [100, 'A'],
      [86, 'A'],
      [85.9, 'B'],
      [73, 'B'],
      [72.9, 'C+'],
      [67, 'C+'],
      [66.9, 'C'],
      [60, 'C'],
      [59.9, 'C-'],
      [50, 'C-'],
    ];
    cases.forEach(([p, letter]) => expect(at(p, '9').S).toBe(letter));
  });

  it('under 50 is IE until the last reporting term ends, then F', () => {
    expect(at(40, '11').S).toBe('IE');
    seed({
      assessments: [pts('a', 10)],
      scores: { [SID]: [sc('a', 4)] },
      config: { reportingTerms: [{ ordinal: 1, label: 'T1', starts_on: '2020-09-01', ends_on: '2021-01-31' }] },
    });
    expect(S()).toBe('F');
  });

  it('the student summary prints the same letter and % the calculation gives', () => {
    seed({ assessments: [pts('q', 10), pts('t', 40)], scores: { [SID]: [sc('q', 8), sc('t', 30)] } });
    expect(studentGradeSummary(CID, SID).text).toBe('B 76%');
    expect(classGradeSummary(CID, [SID]).text).toBe('B 76%');
  });
});

describe('teacher scenarios: competency levels', () => {
  const three = (method, extra) => {
    seed(
      Object.assign(
        {
          gradingSystem: 'proficiency',
          calcMethod: method,
          assessments: [lvl('a'), lvl('b'), lvl('c')],
          scores: {
            [SID]: [
              sc('a', 2, { date: '2026-09-10' }),
              sc('b', 3, { date: '2026-09-20' }),
              sc('c', 4, { date: '2026-09-30' }),
            ],
          },
        },
        extra,
      ),
    );
    return getTagProficiency(CID, SID, 't1');
  };

  it('each method on 2, 3, 4 (oldest first)', () => {
    expect(three('average')).toBe(3);
    expect(three('median')).toBe(3);
    expect(three('mostRecent')).toBe(4);
    expect(three('highest')).toBe(4);
    expect(three('mode')).toBe(4);
    // 2 → 2·0.35 + 3·0.65 = 2.65 → 2.65·0.35 + 4·0.65 = 3.5275
    expect(three('decayingAvg', { config: { calcMethod: 'decayingAvg', decayWeight: 0.65 } })).toBeCloseTo(3.5275, 9);
  });

  it('+ and − count a third of a level: 3+ and 3 average to 3.17', () => {
    seed({
      gradingSystem: 'proficiency',
      assessments: [lvl('a'), lvl('b')],
      scores: { [SID]: [sc('a', 3, { mod: 1 }), sc('b', 3)] },
    });
    expect(getTagProficiency(CID, SID, 't1')).toBeCloseTo(19 / 6, 9);
    expect(formatLevel(CID, getTagProficiency(CID, SID, 't1'))).toBe('3.2');
  });

  it('a Factor counts that many times: 2 at 3x and 4 = 2.5', () => {
    seed({
      gradingSystem: 'proficiency',
      assessments: [lvl('a', { weight: 3 }), lvl('b')],
      scores: { [SID]: [sc('a', 2), sc('b', 4)] },
    });
    expect(getTagProficiency(CID, SID, 't1')).toBe(2.5);
  });

  it('Count Only the Most Recent 2 of 1, 2, 3, 4 is 3.5', () => {
    seed({
      gradingSystem: 'proficiency',
      assessments: ['a', 'b', 'c', 'd'].map(id => lvl(id)),
      scores: { [SID]: [1, 2, 3, 4].map((v, i) => sc('abcd'[i], v, { date: '2026-09-1' + i })) },
      config: { recentScoreLimit: 2 },
    });
    expect(getTagProficiency(CID, SID, 't1')).toBe(3.5);
  });

  it('Excused work is no evidence', () => {
    seed({
      gradingSystem: 'proficiency',
      assessments: [lvl('a'), lvl('b')],
      scores: { [SID]: [sc('a', 1), sc('b', 3)] },
      statuses: { [SID + ':a']: 'EXC' },
    });
    expect(getTagProficiency(CID, SID, 't1')).toBe(3);
  });

  it('section, group and overall levels average the level below', () => {
    seed({
      gradingSystem: 'proficiency',
      sections: [
        { id: 's1', name: 'S1', groupId: 'g', tags: [{ id: 't1' }, { id: 't2' }] },
        { id: 's2', name: 'S2', groupId: 'g', tags: [{ id: 't3' }] },
        { id: 's3', name: 'S3', tags: [{ id: 't4' }] },
      ],
      groups: [{ id: 'g', name: 'G' }],
      assessments: [lvl('a', { tagIds: ['t1', 't2', 't3', 't4'] })],
      scores: {
        [SID]: [sc('a', 2), sc('a', 4, { tagId: 't2' }), sc('a', 4, { tagId: 't3' }), sc('a', 1, { tagId: 't4' })],
      },
    });
    expect(getSectionProficiency(CID, SID, 's1')).toBe(3);
    expect(getGroupProficiency(CID, SID, 'g')).toBe(3.5);
    // group 3.5 and ungrouped section 1
    expect(getOverallProficiency(CID, SID)).toBe(2.25);
  });

  it('an override replaces the calculated section level', () => {
    seed({
      gradingSystem: 'proficiency',
      assessments: [lvl('a')],
      scores: { [SID]: [sc('a', 2)] },
      overrides: { [SID]: { 'sec-1': { level: 3, reason: 'Conference' } } },
    });
    expect(getSectionProficiency(CID, SID, 'sec-1')).toBe(3);
    expect(getSectionProficiencyRaw(CID, SID, 'sec-1')).toBe(2);
  });
});

describe('teacher scenarios: class averages under a column', () => {
  it('points work: Missing counts 0, Excused is left out', () => {
    seed({
      assessments: [pts('q', 10)],
      scores: { a: [sc('q', 8)], b: [], c: [] },
      statuses: { 'b:q': 'NS', 'c:q': 'EXC' },
    });
    const avg = classColumnAverage(CID, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], {
      assessment: _cache.assessments[CID][0],
    });
    expect(avg).toMatchObject({ avg: 4, pct: 40, count: 2 });
  });

  it('proficiency work: Missing and Excused are both left out', () => {
    seed({
      gradingSystem: 'proficiency',
      assessments: [lvl('x')],
      scores: { a: [sc('x', 3)], b: [], c: [] },
      statuses: { 'b:x': 'NS', 'c:x': 'EXC' },
    });
    const avg = classColumnAverage(CID, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], {
      assessment: _cache.assessments[CID][0],
    });
    expect(avg).toMatchObject({ avg: 3, count: 1 });
  });
});

/* ── Reference model ─────────────────────────────────────────────────── */

// A level 0–4 as the percent it counts as (Counts As by step, straight lines between).
function refLevelPct(steps, v) {
  if (!(v > 0)) return 0;
  v = Math.min(4, v);
  const at = COUNTS_AS_STEPS.map(s => s.at);
  if (v <= 1) return steps[0] * v;
  for (let i = 0; i < at.length - 1; i++) {
    if (v <= at[i + 1] + 1e-9) return steps[i] + ((steps[i + 1] - steps[i]) * (v - at[i])) / (at[i + 1] - at[i]);
  }
  return steps[steps.length - 1];
}
const modVal = e => {
  const l = Number(e.score);
  let m = e.mod > 0 ? 1 : e.mod < 0 ? -1 : 0;
  if ((l === 1 && m < 0) || (l === 4 && m > 0)) m = 0;
  return l + m / 3;
};

function refEarnedPossible(cls, sid, a) {
  const status = cls.statuses[sid + ':' + a.id];
  const mine = (cls.scores[sid] || []).filter(e => e.assessmentId === a.id);
  if (status === 'EXC') return null;
  if (a.scoreMode === 'points' || a.scoreMode === 'complete') {
    const possible = a.scoreMode === 'complete' ? 1 : a.maxPoints;
    if (status === 'NS') return { e: 0, p: possible };
    const entry = mine.find(e => e.score != null);
    if (!entry) return null;
    const cap = a.scoreMode === 'complete' ? 1 : 2 * possible;
    return { e: Math.max(0, Math.min(cap, entry.score)), p: possible };
  }
  if (a.rubricId) {
    const rubric = cls.rubrics.find(r => r.id === a.rubricId);
    const anyW = rubric.criteria.some(c => c.weight > 0);
    if (status === 'NS') return { e: 0, p: rubric.criteria.reduce((s, c) => s + (anyW ? c.weight : 1) * 4, 0) };
    const scored = [];
    rubric.criteria.forEach(c => {
      const entry = mine.find(e => e.tagId === c.id && e.score >= 1 && e.score <= 4);
      if (entry) scored.push({ v: (refLevelPct(cls.steps, modVal(entry)) / 100) * 4, w: c.weight });
    });
    if (!scored.length) return null;
    const allZero = !scored.some(c => c.w > 0);
    return scored.reduce((acc, c) => ({ e: acc.e + (allZero ? 1 : c.w) * c.v, p: acc.p + (allZero ? 1 : c.w) * 4 }), {
      e: 0,
      p: 0,
    });
  }
  if (status === 'NS') return { e: 0, p: 4 };
  const vals = mine.filter(e => a.tagIds.includes(e.tagId) && e.score > 0).map(modVal);
  if (!vals.length) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { e: (refLevelPct(cls.steps, mean) / 100) * 4, p: 4 };
}

function refGroupPct(cls, sid, list, mode) {
  let e = 0;
  let p = 0;
  let sum = 0;
  let f = 0;
  list.forEach(a => {
    const x = refEarnedPossible(cls, sid, a);
    if (!x) return;
    const k = a.weight || 1;
    if (mode === 'percent') {
      sum += k * (x.e / x.p) * 100;
      f += k;
    } else {
      e += k * x.e;
      p += k * x.p;
    }
  });
  if (mode === 'percent') return f > 0 ? sum / f : null;
  return p > 0 ? (e / p) * 100 : null;
}

function refCoursePct(cls, sid) {
  if (!cls.categories.length) return refGroupPct(cls, sid, cls.assessments, 'points');
  let sum = 0;
  let w = 0;
  cls.categories.forEach(c => {
    const pct = refGroupPct(
      cls,
      sid,
      cls.assessments.filter(a => a.categoryId === c.id),
      c.calcMode,
    );
    if (pct == null) return;
    sum += c.weight * pct;
    w += c.weight;
  });
  return w > 0 ? sum / w : null;
}

// Mean competency level: each piece of evidence counted its Factor times.
function refTagMean(cls, sid, tagId) {
  let sum = 0;
  let w = 0;
  (cls.scores[sid] || []).forEach(e => {
    const a = cls.assessments.find(x => x.id === e.assessmentId);
    if (!a || cls.statuses[sid + ':' + a.id] === 'EXC') return;
    const cat = cls.categories.find(c => c.id === a.categoryId);
    if (cat && !(cat.weight > 0)) return;
    let v;
    if (a.scoreMode === 'points' || a.scoreMode === 'complete') {
      if (!a.tagIds.includes(e.tagId) || e.tagId !== tagId) return;
      const pct = (e.score / (a.scoreMode === 'complete' ? 1 : a.maxPoints)) * 100;
      v = pct >= 86 ? 4 : pct >= 73 ? 3 : pct >= 50 ? 2 : 1;
    } else if (a.rubricId) {
      const crit = cls.rubrics.find(r => r.id === a.rubricId).criteria.find(c => c.id === e.tagId);
      if (!crit || !crit.tagIds.includes(tagId) || !(e.score > 0)) return;
      v = modVal(e);
    } else {
      if (e.tagId !== tagId || !(e.score > 0)) return;
      v = modVal(e);
    }
    const k = a.weight || 1;
    sum += k * v;
    w += k;
  });
  return w > 0 ? sum / w : 0;
}

/* ── Random classes ──────────────────────────────────────────────────── */

function rng(seedValue) {
  let s = seedValue >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomClass(seedValue) {
  const r = rng(seedValue);
  const pick = list => list[Math.floor(r() * list.length)];
  const tags = ['t1', 't2', 't3', 't4'];
  const withCats = r() < 0.6;
  const categories = withCats
    ? [
        { id: 'k1', name: 'Tests', weight: 50, calcMode: r() < 0.3 ? 'percent' : 'points' },
        { id: 'k2', name: 'Work', weight: 50, calcMode: r() < 0.3 ? 'percent' : 'points' },
        { id: 'k0', name: 'Practice', weight: 0, calcMode: 'points' },
      ]
    : [];
  const rubrics = [
    {
      id: 'r1',
      name: 'R1',
      criteria: [
        { id: 'c1', name: 'C1', tagIds: ['t1'], weight: pick([1, 2]) },
        { id: 'c2', name: 'C2', tagIds: ['t1', 't2'], weight: 1 },
        { id: 'c3', name: 'C3', tagIds: ['t3'], weight: pick([1, 3]) },
      ],
    },
  ];
  const assessments = [];
  const n = 4 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const kind = pick(['points', 'points', 'complete', 'level', 'level', 'rubric']);
    const a = {
      id: 'a' + i,
      title: 'A' + i,
      tagIds: kind === 'rubric' ? ['t1', 't2', 't3'] : [pick(tags)].concat(r() < 0.4 ? [pick(tags)] : []),
      weight: pick([1, 1, 1, 2, 0.5, 4]),
      date: '2026-09-' + String(10 + i).padStart(2, '0'),
    };
    a.tagIds = [...new Set(a.tagIds)];
    if (kind === 'points') Object.assign(a, { scoreMode: 'points', maxPoints: pick([5, 10, 20, 36]) });
    if (kind === 'complete') Object.assign(a, { scoreMode: 'complete', maxPoints: 1 });
    if (kind === 'rubric') a.rubricId = 'r1';
    if (withCats) a.categoryId = pick(['k1', 'k1', 'k2', 'k2', 'k0']);
    assessments.push(a);
  }
  const students = ['s1', 's2', 's3'];
  const scores = {};
  const statuses = {};
  students.forEach(sid => {
    scores[sid] = [];
    assessments.forEach(a => {
      const roll = r();
      if (roll < 0.1) return (statuses[sid + ':' + a.id] = 'EXC');
      if (roll < 0.2) return (statuses[sid + ':' + a.id] = 'NS');
      if (roll < 0.3) return;
      if (roll < 0.35) statuses[sid + ':' + a.id] = 'LATE';
      const date = a.date;
      if (a.scoreMode === 'points') {
        const v = Math.round(r() * a.maxPoints * 1.2 * 4) / 4;
        a.tagIds.forEach(t => scores[sid].push({ assessmentId: a.id, tagId: t, score: v, date }));
      } else if (a.scoreMode === 'complete') {
        const v = r() < 0.7 ? 1 : 0;
        a.tagIds.forEach(t => scores[sid].push({ assessmentId: a.id, tagId: t, score: v, date }));
      } else if (a.rubricId) {
        rubrics[0].criteria.forEach(c => {
          if (r() < 0.15) return;
          scores[sid].push({
            assessmentId: a.id,
            tagId: c.id,
            score: 1 + Math.floor(r() * 4),
            mod: pick([0, 0, 1, -1]),
            date,
          });
        });
      } else {
        a.tagIds.forEach(t => {
          if (r() < 0.15) return;
          scores[sid].push({
            assessmentId: a.id,
            tagId: t,
            score: 1 + Math.floor(r() * 4),
            mod: pick([0, 0, 1, -1]),
            date,
          });
        });
      }
    });
  });
  const bands = r() < 0.5;
  return {
    gradingSystem: pick(['letter', 'both', 'proficiency']),
    gradeLevel: pick(['8', '11']),
    sections: [
      { id: 'sa', name: 'A', tags: [{ id: 't1' }, { id: 't2' }] },
      { id: 'sb', name: 'B', tags: [{ id: 't3' }, { id: 't4' }] },
    ],
    categories,
    rubrics,
    assessments,
    scores,
    statuses,
    students,
    config: bands
      ? { gradingScale: { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents: BC_LETTER_BAND_PERCENTS } }
      : {},
    steps: countsAsStepPercents(bands ? BC_LETTER_BAND_PERCENTS : null),
  };
}

const roundShown = (cls, v) => {
  const whole = Number(cls.gradeLevel) >= 10;
  const f = whole ? 1 : 10;
  return Math.round(Number((v * f).toPrecision(12))) / f;
};

describe('reference model agrees with calc.js on random classes', () => {
  beforeEach(() => localStorage.clear());
  const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

  it('course % matches points earned out of possible, category by category', () => {
    const misses = [];
    SEEDS.forEach(k => {
      const cls = randomClass(k);
      seed(cls);
      cls.students.forEach(sid => {
        const want = refCoursePct(cls, sid);
        const got = getCourseLetterData(CID, sid).R;
        const wantShown = want == null ? null : roundShown(cls, want);
        if (got !== wantShown) misses.push({ seed: k, sid, want: wantShown, got });
      });
    });
    expect(misses.slice(0, 5)).toEqual([]);
  });

  it('Mean competency level matches the Factor-weighted mean of the evidence', () => {
    const misses = [];
    SEEDS.forEach(k => {
      const cls = randomClass(k);
      seed(cls);
      cls.students.forEach(sid => {
        ['t1', 't2', 't3', 't4'].forEach(t => {
          const want = refTagMean(cls, sid, t);
          const got = getTagProficiency(CID, sid, t);
          if (Math.abs(want - got) > 1e-9) misses.push({ seed: k, sid, t, want, got });
        });
      });
    });
    expect(misses.slice(0, 5)).toEqual([]);
  });

  it('every grade stays in range and the shown letter is the letter of the shown %', () => {
    const bad = [];
    SEEDS.forEach(k => {
      const cls = randomClass(k);
      seed(cls);
      cls.students.forEach(sid => {
        const lg = getCourseLetterData(CID, sid);
        if (lg.R != null && (lg.R < 0 || lg.R > 200 || lg.S !== percentageToLetter(lg.R, CID)))
          bad.push({ k, sid, lg });
        const overall = getOverallProficiency(CID, sid);
        if (!(overall >= 0 && overall <= 4)) bad.push({ k, sid, overall });
        cls.assessments.forEach(a => {
          const v = getAssessmentOverallScore(CID, sid, a.id);
          if (v != null && !(v >= 0 && v <= 4)) bad.push({ k, sid, a: a.id, v });
        });
        const shares = categoryCourseShares(CID, sid);
        const total = Object.values(shares).reduce((s, x) => s + x.points, 0);
        if (lg.R != null && cls.categories.length && Math.abs(total - lg.R) > 0.05 * 3 + 0.5)
          bad.push({ k, sid, total, R: lg.R });
        const summary = studentGradeSummary(CID, sid).text;
        if (cls.gradingSystem !== 'proficiency' && lg.R != null && summary.indexOf(lg.S + ' ' + lg.R + '%') < 0)
          bad.push({ k, sid, summary, lg });
      });
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('raising one score never lowers the course % or a Mean competency level', () => {
    const bad = [];
    SEEDS.slice(0, 200).forEach(k => {
      const cls = randomClass(k);
      seed(cls);
      const sid = 's1';
      const beforeR = getCourseLetterData(CID, sid).R;
      const beforeT = ['t1', 't2', 't3', 't4'].map(t => getTagProficiency(CID, sid, t));
      const entry = (cls.scores[sid] || []).find(e => {
        const a = cls.assessments.find(x => x.id === e.assessmentId);
        return a.scoreMode !== 'complete' && !(a.scoreMode !== 'points' && e.score >= 4);
      });
      if (!entry) return;
      const a = cls.assessments.find(x => x.id === entry.assessmentId);
      cls.scores[sid].forEach(e => {
        if (e.assessmentId !== a.id) return;
        if (a.scoreMode === 'points') e.score = e.score + 1;
        else if (a.rubricId ? e === entry : true) {
          e.score = Math.min(4, e.score + 1);
          if (e.score === 4) e.mod = Math.min(0, e.mod || 0);
        }
      });
      clearProfCache();
      const afterR = getCourseLetterData(CID, sid).R;
      const afterT = ['t1', 't2', 't3', 't4'].map(t => getTagProficiency(CID, sid, t));
      if (beforeR != null && afterR != null && afterR < beforeR) bad.push({ k, beforeR, afterR });
      afterT.forEach((v, i) => {
        if (v < beforeT[i] - 1e-9) bad.push({ k, t: i, before: beforeT[i], after: v });
      });
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('score entry order never changes a grade', () => {
    const bad = [];
    SEEDS.slice(0, 200).forEach(k => {
      const cls = randomClass(k);
      seed(cls);
      const before = cls.students.map(sid => [getCourseLetterData(CID, sid).R, getOverallProficiency(CID, sid)]);
      cls.students.forEach(sid => cls.scores[sid].reverse());
      clearProfCache();
      const after = cls.students.map(sid => [getCourseLetterData(CID, sid).R, getOverallProficiency(CID, sid)]);
      const same = before.every((b, i) => b[0] === after[i][0] && Math.abs(b[1] - after[i][1]) < 1e-9);
      if (!same) bad.push({ k, before, after });
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
