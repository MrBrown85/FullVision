/**
 * Points and Proficiency, read as a draft (teacher/calc-scale.js and
 * teacher/cm-pts-model.js). withGradingScale works a class's grades out under
 * a scale that is not saved, with calc.js's own formulas, and leaves nothing
 * behind: after it every grade and every cache reads as before. CmPtsModel
 * holds the rules the ruler always had, and the ghost rule.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-0000000draft1';
const TAG = 'tag-1';
const SEC = 'sec-1';

function seed() {
  localStorage.clear();
  saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'letter', calcMethod: 'mostRecent' } });
  _cache.courseConfigs[CID] = {};
  saveStudents(CID, [
    { id: 's1', firstName: 'Amara', lastName: 'Osei', enrolledDate: '2026-09-01' },
    { id: 's2', firstName: 'Bo', lastName: 'Tran', enrolledDate: '2026-09-01' },
  ]);
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: SEC, name: 'Inquiry', tags: [{ id: TAG, label: 'Inquiry' }] }],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = ['a', 'b'].map((id, i) => ({
    id,
    title: 'Lab ' + id,
    scoreMode: 'proficiency',
    tagIds: [TAG],
    type: 'summative',
    date: '2026-10-0' + (i + 1),
  }));
  // Amara earns 3s, Bo a 2: their course % moves with what 3 and 2 count as.
  _cache.scores[CID] = {
    s1: [
      { assessmentId: 'a', tagId: TAG, score: 3, date: '2026-10-01' },
      { assessmentId: 'b', tagId: TAG, score: 3, date: '2026-10-02' },
    ],
    s2: [
      { assessmentId: 'a', tagId: TAG, score: 2, date: '2026-10-01' },
      { assessmentId: 'b', tagId: TAG, score: 2, date: '2026-10-02' },
    ],
  };
  _cache.statuses[CID] = {};
  clearProfCache();
}

const read = sid => getCourseLetterData(CID, sid);
const scaleWith = percents => ({
  boundaries: structuredClone(DEFAULT_GRADING_SCALE.boundaries),
  percents,
  labels: null,
});
const HIGH = scaleWith({ 4: 100, 3: 90, 2: 70, 1: 40 });

describe('withGradingScale', () => {
  beforeEach(seed);

  it('works a grade out under the scale it is given, and puts the saved one back', () => {
    const before = read('s1').R;
    const under = withGradingScale(CID, HIGH, () => read('s1').R);
    expect(under).not.toBe(before);
    expect(under).toBeCloseTo(90, 5);
    // After the call: the same grade, the same scale.
    expect(read('s1').R).toBe(before);
    expect(getGradingScale(CID)).toEqual(DEFAULT_GRADING_SCALE);
  });

  it('leaves every grade and every cache as it was, so nothing leaks', () => {
    // Fill the caches with the saved scale's grades first.
    const grades = ['s1', 's2'].map(s => [read(s).R, studentGradeSummary(CID, s).text]);
    const keys = () =>
      [
        _courseLetterCache,
        _tagScoresCache,
        _tagProfCache,
        _categoryAvgCache,
        _assessmentOverallCache,
        _countedScoresCache,
      ].map(c => Object.keys(c).sort().join('|'));
    const kept = keys();
    const same = _courseLetterCache;
    withGradingScale(CID, HIGH, () => {
      ['s1', 's2'].forEach(s => {
        read(s);
        studentGradeSummary(CID, s);
      });
    });
    expect(_courseLetterCache).toBe(same);
    expect(keys()).toEqual(kept);
    expect(['s1', 's2'].map(s => [read(s).R, studentGradeSummary(CID, s).text])).toEqual(grades);
  });

  it('puts everything back when what it runs throws, and refuses work that does not finish at once', () => {
    const before = read('s2').R;
    expect(() =>
      withGradingScale(CID, HIGH, () => {
        read('s2');
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(read('s2').R).toBe(before);
    expect(() => withGradingScale(CID, HIGH, () => Promise.resolve())).toThrow(/does not finish at once/);
    expect(read('s2').R).toBe(before);
  });

  it('can be nested: the inner scale holds inside, the outer one comes back after', () => {
    const saved = read('s1').R;
    const out = withGradingScale(CID, HIGH, () => [
      read('s1').R,
      withGradingScale(CID, DEFAULT_GRADING_SCALE, () => read('s1').R),
      read('s1').R,
    ]);
    expect(out[1]).toBe(saved);
    expect(out[0]).toBeCloseTo(90, 5);
    expect(out[2]).toBe(out[0]);
    expect(read('s1').R).toBe(saved);
  });

  it('writes nothing: the class config is the same object with the same scale after', () => {
    const cc = getCourseConfig(CID);
    const json = JSON.stringify(cc);
    withGradingScale(CID, HIGH, () => read('s1'));
    expect(getCourseConfig(CID)).toBe(cc);
    expect(JSON.stringify(getCourseConfig(CID))).toBe(json);
    expect(localStorage.getItem('gb-courseconfig-' + CID)).toBeNull();
  });

  it('reads another class under its own saved scale', () => {
    const other = 'e0000000-0000-4000-8000-0000000draft2';
    saveCourses({ ...COURSES, [other]: { id: other, name: 'B', gradingSystem: 'letter' } });
    _cache.courseConfigs[other] = { gradingScale: HIGH };
    expect(withGradingScale(CID, DEFAULT_GRADING_SCALE, () => getGradingScale(other))).toBe(HIGH);
  });
});

describe('CmPtsModel', () => {
  beforeEach(seed);
  const M = CmPtsModel;
  const own = o => scaleWith({ 4: 100, 3: 75, 2: 50, 1: 25, ...o });

  it('keeps the old rules: ordered steps, rising band starts, a + or − left in between', () => {
    const s = own({});
    expect(M.edit(s, { kind: 'step', key: '3' }, '100').error).toMatch(/Each step must count for more/);
    expect(M.edit(s, { kind: 'edge', level: 3 }, '90').error).toMatch(/Each proficiency must start higher/);
    expect(M.edit(s, { kind: 'step', key: '3' }, 'abc')).toEqual({ back: true });
    expect(M.edit(s, { kind: 'step', key: '3+' }, '85').scale.percents).toEqual({ ...s.percents, '3+': 85 });
    // Typed at the value it already shows: no value of its own.
    expect(M.edit(s, { kind: 'step', key: '3-' }, '66.7').scale).toBe(s);
  });

  it('draws a pill ghost for a step the teacher set, and a ring for one that followed its level', () => {
    const saved = own({});
    const shown = own({ 3: 80 });
    const g = M.ghosts(saved, shown, false);
    const by = k => g.ghosts.find(x => x.key === k);
    // 3 was set by hand and nothing else on its row is within 4.2% of its saved 75: a pill. It is
    // tied to its live marker on the same row.
    expect(by('3').ring).toBe(false);
    expect(by('3').title).toBe('Put 3 back at 75%');
    expect(g.tethers.length).toBeGreaterThan(0);
    // 3+ and 3− moved only because 3 did: rings.
    expect(by('3+').ring).toBe(true);
    expect(by('3-').ring).toBe(true);
    expect(by('4')).toBeUndefined();
    // A preset's markers were not set by hand: every ghost is a ring.
    expect(M.ghosts(saved, shown, true).ghosts.every(x => x.ring)).toBe(true);
  });

  it('leaves a ring when a live marker is within 4.2% of the saved place on its row', () => {
    const g = M.ghosts(own({}), own({ 3: 77 }), false);
    expect(g.ghosts.find(x => x.key === '3').ring).toBe(true);
  });

  it('marks a band start that moved, and nothing when nothing moved', () => {
    const saved = own({});
    const moved = { ...saved, boundaries: [{ min: 88, proficiency: 4 }, ...saved.boundaries.slice(1)] };
    expect(M.ghosts(saved, moved, false).edges).toEqual([
      { level: 4, at: 86, label: '86%', title: 'Put Extending back at 86%' },
    ]);
    const none = M.ghosts(saved, saved, false);
    expect([none.ghosts, none.tethers, none.edges]).toEqual([[], [], []]);
  });

  it('lists what moved for the question at Save and for Copy Grading Setup', () => {
    const lines = M.lines(own({}), {
      boundaries: [
        { min: 86, proficiency: 4 },
        { min: 70, proficiency: 3 },
        { min: 50, proficiency: 2 },
        { min: 0, proficiency: 1 },
      ],
      percents: { 4: 100, 3: 80, 2: 50, 1: 25 },
      labels: null,
    });
    expect(lines).toContain('3: 75% → 80%.');
    expect(lines).toContain('3−: 66.7% → 70%.');
    expect(lines).toContain('Proficient starts at 73% → 70%.');
    expect(M.lines(own({}), own({}))).toEqual([]);
  });

  it('says which course % and letters a scale would move, from calc.js', () => {
    const fx = M.gradeEffects(CID, DEFAULT_GRADING_SCALE, HIGH);
    expect(fx.pctMoves).toBe(true);
    // 75% (B) → 90% (A) for Amara; 50% (C−) → 70% (C+) for Bo.
    expect(fx.moves).toEqual([
      { name: 'Amara Osei', from: 'B', to: 'A' },
      { name: 'Bo Tran', from: 'C-', to: 'C+' },
    ]);
    // Only a band start that changes no course %: nothing moves.
    const bands = {
      ...DEFAULT_GRADING_SCALE,
      boundaries: [{ min: 90, proficiency: 4 }, ...DEFAULT_GRADING_SCALE.boundaries.slice(1)],
    };
    expect(M.gradeEffects(CID, DEFAULT_GRADING_SCALE, bands)).toEqual({ pctMoves: false, moves: [] });
    // And reading them changed nothing.
    expect(getGradingScale(CID)).toEqual(DEFAULT_GRADING_SCALE);
  });

  it('shows no course % in a Proficiency class', () => {
    COURSES[CID].gradingSystem = 'proficiency';
    expect(M.gradeEffects(CID, DEFAULT_GRADING_SCALE, HIGH)).toEqual({ pctMoves: false, moves: [] });
  });
});
