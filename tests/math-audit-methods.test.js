/**
 * Grade math audit, round two (2026-11-01). Extends tests/math-audit.test.js:
 *  1. The reference model for competency levels under every calculation
 *     method (Most Recent, Highest, Mean, Median, Mode, Decaying Average),
 *     with Count Only the Most Recent N and a reporting term in view.
 *  2. Invariants across screens: a competency's growth line ends at its
 *     level; a term's grades count only the term's work.
 *  3. Grades follow every kind of edit made through the app's own save
 *     functions (no stale cached grade).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'math-audit-2';
const TAGS = ['t1', 't2', 't3', 't4'];
const SECTIONS = [
  { id: 'sa', name: 'A', tags: [{ id: 't1' }, { id: 't2' }] },
  { id: 'sb', name: 'B', tags: [{ id: 't3' }, { id: 't4' }] },
];

function seed(o) {
  COURSES[CID] = { id: CID, name: 'Audit', gradingSystem: o.gradingSystem || 'both', gradeLevel: '9' };
  _cache.learningMaps[CID] = { subjects: [], sections: SECTIONS, _customized: true, _version: 1 };
  _cache.categories[CID] = o.categories || [];
  _cache.assessments[CID] = o.assessments;
  _cache.scores[CID] = o.scores;
  _cache.statuses[CID] = o.statuses || {};
  _cache.rubrics[CID] = o.rubrics || [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = Object.assign({}, o.config);
  setActiveTerm(CID, null);
  clearProfCache();
}

afterEach(() => {
  setActiveTerm(CID, null);
  delete COURSES[CID];
  localStorage.clear();
});

function rng(seedValue) {
  let s = seedValue >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const METHODS = ['mostRecent', 'highest', 'average', 'median', 'mode', 'decayingAvg'];
const TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-09-30' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-10-01', ends_on: '2026-10-31' },
];

function randomClass(k) {
  const r = rng(k * 7919);
  const pick = list => list[Math.floor(r() * list.length)];
  const withCats = r() < 0.5;
  const categories = withCats
    ? [
        { id: 'k1', name: 'Tests', weight: 60 },
        { id: 'k2', name: 'Work', weight: 40 },
        { id: 'k0', name: 'Practice', weight: 0 },
      ]
    : [];
  const rubrics = [
    {
      id: 'r1',
      name: 'R1',
      criteria: [
        { id: 'c1', name: 'C1', tagIds: ['t1'], weight: 1 },
        { id: 'c2', name: 'C2', tagIds: ['t2', 't3'], weight: 2 },
      ],
    },
  ];
  const n = 5 + Math.floor(r() * 7);
  const assessments = [];
  for (let i = 0; i < n; i++) {
    const kind = pick(['points', 'level', 'level', 'level', 'rubric']);
    // Distinct dates across two months, so "most recent" is never a tie.
    const day = 1 + Math.floor((i * 58) / n);
    const date = day <= 30 ? '2026-09-' + String(day).padStart(2, '0') : '2026-10-' + String(day - 30).padStart(2, '0');
    const a = {
      id: 'a' + i,
      title: 'A' + i,
      date,
      weight: pick([1, 1, 2, 0.5]),
      tagIds: kind === 'rubric' ? ['t1', 't2', 't3'] : [...new Set([pick(TAGS), pick(TAGS)])],
    };
    if (kind === 'points') Object.assign(a, { scoreMode: 'points', maxPoints: pick([10, 20]) });
    if (kind === 'rubric') a.rubricId = 'r1';
    // Categorized work is summative; work outside a category is formative,
    // as the server loads it.
    if (withCats) a.categoryId = pick(['k1', 'k2', 'k0']);
    a.type = a.categoryId ? 'summative' : 'formative';
    assessments.push(a);
  }
  const sid = 's1';
  const scores = { [sid]: [] };
  const statuses = {};
  assessments.forEach(a => {
    const roll = r();
    if (roll < 0.1) return (statuses[sid + ':' + a.id] = 'EXC');
    if (roll < 0.18) return;
    if (a.scoreMode === 'points') {
      const v = Math.round(r() * a.maxPoints);
      a.tagIds.forEach(t => scores[sid].push({ assessmentId: a.id, tagId: t, score: v, date: a.date, type: a.type }));
    } else if (a.rubricId) {
      rubrics[0].criteria.forEach(c =>
        scores[sid].push({
          assessmentId: a.id,
          tagId: c.id,
          score: 1 + Math.floor(r() * 4),
          mod: pick([0, 1, -1]),
          date: a.date,
          type: a.type,
        }),
      );
    } else {
      a.tagIds.forEach(t =>
        scores[sid].push({
          assessmentId: a.id,
          tagId: t,
          score: 1 + Math.floor(r() * 4),
          mod: pick([0, 0, 1, -1]),
          date: a.date,
          type: a.type,
        }),
      );
    }
  });
  return {
    categories,
    rubrics,
    assessments,
    scores,
    statuses,
    sid,
    method: pick(METHODS),
    recent: pick([null, null, 3, 5]),
    term: pick([null, null, 1, 2]),
    decay: pick([0.65, 0.4, 0.9]),
  };
}

/* ── Reference model for a competency level ── */

const modVal = e => {
  const l = Number(e.score);
  let m = e.mod > 0 ? 1 : e.mod < 0 ? -1 : 0;
  if ((l === 1 && m < 0) || (l === 4 && m > 0)) m = 0;
  return l + m / 3;
};
const tableLevel = pct => (pct >= 86 ? 4 : pct >= 73 ? 3 : pct >= 50 ? 2 : 1);

// The evidence for one competency: { v, whole, date, f, bucket }, oldest first.
function refEvidence(cls, tagId, term) {
  const out = [];
  cls.scores[cls.sid].forEach(e => {
    const a = cls.assessments.find(x => x.id === e.assessmentId);
    if (cls.statuses[cls.sid + ':' + a.id] === 'EXC') return;
    if (term && !(a.date >= term.starts_on && a.date <= term.ends_on)) return;
    const cat = cls.categories.find(c => c.id === a.categoryId);
    if (cat && !(cat.weight > 0)) return;
    let v;
    let whole;
    if (a.scoreMode === 'points') {
      if (e.tagId !== tagId) return;
      v = whole = tableLevel((e.score / a.maxPoints) * 100);
    } else if (a.rubricId) {
      const c = cls.rubrics[0].criteria.find(x => x.id === e.tagId);
      if (!c || !c.tagIds.includes(tagId)) return;
      v = modVal(e);
      whole = e.score;
    } else {
      if (e.tagId !== tagId) return;
      v = modVal(e);
      whole = e.score;
    }
    out.push({ v, whole, date: a.date, f: a.weight || 1, bucket: a.categoryId ? 'cat' : 'none' });
  });
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

function refGroup(ev, method, decay) {
  if (!ev.length) return 0;
  switch (method) {
    case 'mostRecent':
      return ev[ev.length - 1].v;
    case 'highest':
      return Math.max(...ev.map(e => e.v));
    case 'average':
      return ev.reduce((s, e) => s + e.f * e.v, 0) / ev.reduce((s, e) => s + e.f, 0);
    case 'median': {
      const s = ev.map(e => e.v).sort((a, b) => a - b);
      const n = s.length;
      return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    }
    case 'mode': {
      const freq = {};
      ev.forEach(e => (freq[e.whole] = (freq[e.whole] || 0) + e.f));
      const top = Math.max(...Object.values(freq));
      for (let i = ev.length - 1; i >= 0; i--) if (freq[ev[i].whole] === top) return ev[i].v;
      return 0;
    }
    case 'decayingAvg': {
      let avg = ev[0].v;
      for (let i = 1; i < ev.length; i++) {
        avg = (avg * (1 - decay) + ev[i].v * decay * ev[i].f) / (1 - decay + decay * ev[i].f);
      }
      return avg;
    }
  }
  return 0;
}

function refTagLevel(cls, tagId) {
  const term = cls.term ? TERMS[cls.term - 1] : null;
  let ev = refEvidence(cls, tagId, term);
  if (cls.recent && cls.method !== 'mostRecent') ev = ev.slice(-cls.recent);
  // Work outside a category counts only when there is no other evidence.
  const cat = ev.filter(e => e.bucket === 'cat');
  const none = ev.filter(e => e.bucket === 'none');
  return refGroup(cat, cls.method, cls.decay) || refGroup(none, cls.method, cls.decay);
}

function load(cls) {
  seed({
    categories: cls.categories,
    rubrics: cls.rubrics,
    assessments: cls.assessments,
    scores: cls.scores,
    statuses: cls.statuses,
    config: {
      calcMethod: cls.method,
      decayWeight: cls.decay,
      recentScoreLimit: cls.recent,
      reportingTerms: TERMS,
    },
  });
  if (cls.term) setActiveTerm(CID, cls.term);
  clearProfCache();
}

const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);

describe('competency levels match the reference model under every method', () => {
  beforeEach(() => localStorage.clear());

  it('every method, Most Recent N and reporting term', () => {
    const misses = [];
    const covered = new Set();
    SEEDS.forEach(k => {
      const cls = randomClass(k);
      load(cls);
      covered.add(cls.method);
      TAGS.forEach(t => {
        const want = refTagLevel(cls, t);
        const got = getTagProficiency(CID, cls.sid, t);
        if (Math.abs(want - got) > 1e-9) misses.push({ k, t, method: cls.method, recent: cls.recent, want, got });
      });
    });
    expect([...covered].sort()).toEqual([...METHODS].sort());
    expect(misses.slice(0, 5)).toEqual([]);
  });

  it('a term counts only the work dated inside it', () => {
    const bad = [];
    SEEDS.slice(0, 200).forEach(k => {
      const cls = randomClass(k);
      cls.term = 2;
      load(cls);
      const inTerm = cls.assessments.filter(a => a.date >= TERMS[1].starts_on);
      const viaTerm = getCourseLetterData(CID, cls.sid).R;
      // The same class with only the term's work, all time.
      const only = { ...cls, term: null, assessments: inTerm };
      only.scores = { [cls.sid]: cls.scores[cls.sid].filter(e => inTerm.some(a => a.id === e.assessmentId)) };
      load(only);
      const viaFilter = getCourseLetterData(CID, cls.sid).R;
      if (viaTerm !== viaFilter) bad.push({ k, viaTerm, viaFilter });
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("a competency's growth line ends at its level", () => {
    const bad = [];
    SEEDS.forEach(k => {
      const cls = randomClass(k);
      load(cls);
      SECTIONS.forEach(sec => {
        const line = getSectionGrowthData(CID, cls.sid, sec.id);
        const level = getSectionProficiencyRaw(CID, cls.sid, sec.id);
        const end = line.length ? line[line.length - 1].prof : 0;
        if (Math.abs(end - level) > 1e-9) bad.push({ k, sec: sec.id, method: cls.method, end, level });
      });
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('grades follow every edit made through the save functions', () => {
  beforeEach(() => localStorage.clear());

  // Each edit, then the grades read with the cache as it is and from scratch.
  const EDITS = {
    'a level is entered': c => upsertScore(CID, 's1', 'a1', 't1', 1, '2026-09-10', 'summative', '', 0),
    'a points score is entered': c => setPointsScore(CID, 's1', 'a2', 3),
    'work is marked Missing': c => setAssignmentStatus(CID, 's1', 'a3', 'NS'),
    'an assessment gets a Factor': c =>
      saveAssessments(
        CID,
        getAssessments(CID).map(a => (a.id === 'a1' ? { ...a, weight: 5 } : a)),
      ),
    'an assessment moves category': c =>
      saveAssessments(
        CID,
        getAssessments(CID).map(a => (a.id === 'a2' ? { ...a, categoryId: 'k2', category_id: 'k2' } : a)),
      ),
    'a category weight changes': c =>
      saveCategories(CID, [
        { id: 'k1', name: 'Tests', weight: 10 },
        { id: 'k2', name: 'Work', weight: 90 },
      ]),
    'the method changes': c => saveCourseConfig(CID, { ...getCourseConfig(CID), calcMethod: 'highest' }),
    'Counts As changes': c =>
      saveCourseConfig(CID, {
        ...getCourseConfig(CID),
        gradingScale: { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents: BC_LETTER_BAND_PERCENTS },
      }),
    'Points to Proficiency changes': c =>
      saveCourseConfig(CID, {
        ...getCourseConfig(CID),
        gradingScale: {
          boundaries: [
            { min: 95, proficiency: 4 },
            { min: 80, proficiency: 3 },
            { min: 60, proficiency: 2 },
            { min: 0, proficiency: 1 },
          ],
        },
      }),
    'the rounding changes': c => saveCourseConfig(CID, { ...getCourseConfig(CID), roundPercent: true }),
    'a rubric criterion weight changes': c =>
      saveRubrics(CID, [
        {
          id: 'r1',
          name: 'R1',
          criteria: [
            { id: 'c1', name: 'C1', tagIds: ['t1'], weight: 5 },
            { id: 'c2', name: 'C2', tagIds: ['t2'], weight: 1 },
          ],
        },
      ]),
    'the grade level changes': c => updateCourse(CID, { gradeLevel: '11' }),
    'the reporting term changes': c => setActiveTerm(CID, 2),
  };

  const base = () => ({
    categories: [
      { id: 'k1', name: 'Tests', weight: 50 },
      { id: 'k2', name: 'Work', weight: 50 },
    ],
    rubrics: [
      {
        id: 'r1',
        name: 'R1',
        criteria: [
          { id: 'c1', name: 'C1', tagIds: ['t1'], weight: 1 },
          { id: 'c2', name: 'C2', tagIds: ['t2'], weight: 1 },
        ],
      },
    ],
    assessments: [
      { id: 'a1', title: 'A1', date: '2026-09-05', tagIds: ['t1'], categoryId: 'k1', type: 'summative' },
      {
        id: 'a2',
        title: 'A2',
        date: '2026-09-12',
        tagIds: ['t1'],
        categoryId: 'k1',
        scoreMode: 'points',
        maxPoints: 10,
        type: 'summative',
      },
      { id: 'a3', title: 'A3', date: '2026-10-03', tagIds: ['t1', 't3'], categoryId: 'k2', type: 'summative' },
      {
        id: 'a4',
        title: 'A4',
        date: '2026-10-09',
        tagIds: ['t1', 't2'],
        categoryId: 'k2',
        rubricId: 'r1',
        type: 'summative',
      },
    ],
    scores: {
      s1: [
        { assessmentId: 'a1', tagId: 't1', score: 3, date: '2026-09-05' },
        // 7/10: the course % is 73.2, so a change of rounding shows.
        { assessmentId: 'a2', tagId: 't1', score: 7, date: '2026-09-12' },
        { assessmentId: 'a4', tagId: 'c1', score: 2, date: '2026-10-09' },
        { assessmentId: 'a4', tagId: 'c2', score: 4, date: '2026-10-09' },
      ],
    },
    config: { calcMethod: 'average', reportingTerms: TERMS },
  });

  const snapshot = () => ({
    lg: getCourseLetterData(CID, 's1'),
    overall: getOverallProficiency(CID, 's1'),
    tags: TAGS.map(t => getTagProficiency(CID, 's1', t)),
    group: assessmentGroupGrade(CID, 's1', getAssessments(CID)),
    a: getAssessments(CID).map(a => getAssessmentOverallScore(CID, 's1', a.id)),
  });

  Object.entries(EDITS).forEach(([name, edit]) => {
    it(name, () => {
      seed(base());
      snapshot(); // warm every cache
      edit();
      const cached = snapshot();
      clearProfCache();
      expect(cached).toEqual(snapshot());
    });
  });
});
