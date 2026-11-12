/**
 * math: the tests that were tests/math-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('math-audit-methods', () => {
  /**
   * Grade math audit, round two (2026-11-01). Extends tests/math-audit.test.js:
   *  1. The reference model for competency levels under every calculation
   *     method (Most Recent, Highest, Mean, Median, Mode, Decaying Average),
   *     with Count Only the Most Recent N and a reporting term in view.
   *  2. Invariants across screens: a competency's growth line ends at its
   *     level; a report's grades count the year to date as of its term's end
   *     (Colin, 2026-11-03).
   *  3. Grades follow every kind of edit made through the app's own save
   *     functions (no stale cached grade).
   */

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
      const date =
        day <= 30 ? '2026-09-' + String(day).padStart(2, '0') : '2026-10-' + String(day - 30).padStart(2, '0');
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
      // A report counts the year to date as of its term's end.
      if (term && a.date && !(a.date <= term.ends_on)) return;
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

    it("a report counts the work up to its term's end", () => {
      const bad = [];
      SEEDS.slice(0, 200).forEach(k => {
        const cls = randomClass(k);
        cls.term = 1;
        load(cls);
        const inTerm = cls.assessments.filter(a => !a.date || a.date <= TERMS[0].ends_on);
        const viaTerm = getCourseLetterData(CID, cls.sid).R;
        // The same class with only the work up to Report 1's end, the year so far.
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
});

describe('math-audit-whole-rubric', () => {
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
});
