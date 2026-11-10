/**
 * Returned-only grades fail closed (S0-F1b, after the independent review of
 * S0-F1). Two things a family must never get from a report worked out with
 * returned grades only: a draft, and a page of blank grades that looks like
 * a real report.
 *
 * 1. A returned set in the wrong shape is refused. shared/calc.js takes only
 *    a plain object of { studentId: [entries] }. A list, a Map, a promise or
 *    a student whose scores are not a list would otherwise read as "nobody
 *    has a score", with no error.
 * 2. It never falls open. These are behaviour tests, not checks of the
 *    source: each one fails if calc.js reads every score when
 *    - the builder throws (the error must come through);
 *    - the returned set is empty (nobody has a grade; nothing is thrown);
 *    - a student is not in the returned set (that student has no grade);
 *    - a student's returned list is empty: every grade the student has is a
 *      draft never returned. This is the dangerous one. Such a student has
 *      no grade in returned-only, in everything the golden file records,
 *      while all-work shows the grades.
 *
 * The returned set here is given straight to calc.js as `getReturnedScores`
 * (no builder), so these tests hold calc.js alone.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, canonical, levelsOf, loadDemoClass, loadEvalClass, shownOf } from './helpers/golden-grades.js';

// Makes `getReturnedScores` give `set` (or what `set()` gives) until removed.
function giveReturned(set) {
  globalThis.getReturnedScores = typeof set === 'function' ? set : () => set;
}
function removeReturned() {
  delete globalThis.getReturnedScores;
}

/* ── A small class ───────────────────────────────────────────── */

const CID = 'course-closed';
const TAG = 'T1';
const STUDENTS = ['s1', 's2'].map(id => ({ id, firstName: id, lastName: 'Test' }));
const ASSESSMENTS = [
  { id: 'lv', title: 'Level', scoreMode: 'proficiency', tagIds: [TAG], date: '2026-10-01', categoryId: 'cat' },
  { id: 'pt', title: 'Points', scoreMode: 'points', maxPoints: 10, tagIds: [], date: '2026-10-02', categoryId: 'cat' },
  { id: 'cp', title: 'Check', scoreMode: 'complete', maxPoints: 1, tagIds: [], date: '2026-10-03', categoryId: 'cat' },
];
const entry = (assessmentId, score, tagId, extra) =>
  Object.assign({ assessmentId, tagId, score, date: ASSESSMENTS.find(a => a.id === assessmentId).date }, extra);
// Both students have a level 3, 8/10 and Complete in the working copy.
const working = () => ({
  s1: [entry('lv', 3, TAG, { note: 'Draft words.' }), entry('pt', 8, 'overall'), entry('cp', 1, 'overall')],
  s2: [entry('lv', 3, TAG), entry('pt', 8, 'overall'), entry('cp', 1, 'overall')],
});

function seedSmallClass() {
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: 'both', levelOrder: 'asc' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = ASSESSMENTS;
  _cache.scores[CID] = working();
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.categories[CID] = [{ id: 'cat', name: 'Work', weight: 100 }];
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SUB', name: 'Science 9' }],
    sections: [{ id: 'S1', subject: 'SUB', name: 'Inquiry', tags: [{ id: TAG, label: 'Inquiry' }] }],
  };
  _cache.courseConfigs[CID] = {};
  setActiveTerm(CID, null);
  clearProfCache();
}
function dropSmallClass() {
  removeReturned();
  _scoreSet = 'all';
  delete COURSES[CID];
  localStorage.clear();
  clearProfCache();
}

// What one student's grade reads as, through the public functions.
const read = sid => ({
  level: getTagProficiency(CID, sid, TAG),
  section: getSectionProficiency(CID, sid, 'S1'),
  overall: getOverallProficiency(CID, sid),
  course: getCourseLetterData(CID, sid),
  summary: studentGradeSummary(CID, sid),
  pieces: ASSESSMENTS.map(a => getAssessmentOverallScore(CID, sid, a.id)),
  cells: ASSESSMENTS.map(a => assessmentCellValue(CID, sid, a).kind),
  points: _scoreRead.pointsScore(CID, sid, 'pt'),
  mark: _scoreRead.completionMark(CID, sid, 'cp'),
  comment: _scoreRead.comment(CID, sid, 'lv'),
});
const GRADED = {
  level: 3,
  section: 3,
  overall: 3,
  course: { Q: 3.333333333333334, R: 80, S: 'B' },
  summary: { text: '3.0 · B 80%', level: 3 },
  pieces: [3, 3, 4],
  cells: ['level', 'points', 'complete'],
  points: 8,
  mark: 'complete',
};
const NO_GRADE = {
  level: 0,
  section: 0,
  overall: 0,
  course: { Q: null, R: null, S: null },
  summary: { text: '', level: 0 },
  pieces: [null, null, null],
  cells: ['none', 'none', 'none'],
  points: null,
  mark: null,
  comment: '',
};

/* ── 1. The wrong shape is refused ───────────────────────────── */

describe('a returned set in the wrong shape is refused', () => {
  beforeEach(seedSmallClass);
  afterEach(dropSmallClass);

  class Scores {
    constructor() {
      this.s1 = [];
      this.s2 = [];
    }
  }
  const one = () => entry('lv', 4, TAG);
  const WRONG = {
    'an empty list': () => [],
    'a list of entries': () => [one()],
    'a list of students’ lists': () => [[one()], [one()]],
    'a Map': () => new Map([['s1', [one()]]]),
    'a Set': () => new Set(['s1']),
    'a promise of the set': () => Promise.resolve({ s1: [one()] }),
    'a thenable': () => ({ then() {} }),
    'a class instance': () => new Scores(),
    'an object that inherits its students': () => Object.create({ s1: [one()] }),
    'a date': () => new Date(0),
    'a student with null for a list': () => ({ s1: null, s2: [one()] }),
    'a student with undefined for a list': () => ({ s1: [one()], s2: undefined }),
    'a student with one entry, not a list': () => ({ s1: one() }),
    'a student with a list-like object': () => ({ s1: { 0: one(), length: 1 } }),
    'a student with text for a list': () => ({ s1: 'lv:4' }),
    'a student with a Map for a list': () => ({ s1: new Map() }),
  };
  const READS = {
    'a competency level': () => getTagProficiency(CID, 's1', TAG),
    'the overall grade': () => studentGradeSummary(CID, 's1'),
    'the course letter': () => getCourseLetterData(CID, 's1'),
    'a gradebook cell': () => assessmentCellValue(CID, 's1', ASSESSMENTS[1]),
    'a class average': () => classColumnAverage(CID, STUDENTS, { assessment: ASSESSMENTS[1] }),
    'the Overall Comment': () => _scoreRead.comment(CID, 's1', 'lv'),
  };

  it.each(Object.keys(WRONG))('%s: every read throws, and no grade comes out', name => {
    giveReturned(WRONG[name]());
    Object.keys(READS).forEach(what => {
      let got = 'nothing';
      expect(() => (got = withReturnedOnly(READS[what])), what).toThrow(
        /Returned grades were asked for.*not a set of scores.*No grade was worked out/,
      );
      expect(got, what).toBe('nothing');
      expect(_scoreSet).toBe('all');
    });
    // All work is untouched, and nothing wrong was cached for returned grades.
    expect(read('s1')).toMatchObject(GRADED);
    giveReturned({ s1: [entry('lv', 4, TAG)], s2: [] });
    expect(withReturnedOnly(() => getTagProficiency(CID, 's1', TAG))).toBe(4);
  });

  const RIGHT = {
    'a plain object of lists': () => ({ s1: [one()], s2: [] }),
    'an object with no prototype': () => Object.assign(Object.create(null), { s1: [one()] }),
    'a copy made with structuredClone': () => structuredClone({ s1: [one()], s2: [] }),
    'a copy read back from JSON': () => JSON.parse(JSON.stringify({ s1: [one()], s2: [] })),
  };
  it.each(Object.keys(RIGHT))('%s is taken', name => {
    giveReturned(RIGHT[name]());
    expect(withReturnedOnly(() => getTagProficiency(CID, 's1', TAG))).toBe(4);
    expect(withReturnedOnly(() => getTagProficiency(CID, 's2', TAG))).toBe(0);
  });

  it('the check is on every read, not only the first', () => {
    const set = { s1: [one()], s2: [] };
    giveReturned(set);
    expect(withReturnedOnly(() => getTagProficiency(CID, 's1', TAG))).toBe(4);
    set.s2 = null;
    clearProfCache();
    expect(() => withReturnedOnly(() => getTagProficiency(CID, 's1', TAG))).toThrow(/not a set of scores/);
  });
});

/* ── 2. It never falls open: the small class ─────────────────── */

describe('returned-only never falls back to every score', () => {
  beforeEach(seedSmallClass);
  afterEach(dropSmallClass);

  it('all work shows both students’ grades', () => {
    expect(read('s1')).toMatchObject(GRADED);
    expect(read('s2')).toMatchObject(GRADED);
  });

  it('a builder that throws: the error comes through, and no grade comes out', () => {
    giveReturned(() => {
      throw new Error('the return records did not load');
    });
    ['s1', 's2'].forEach(sid => {
      let got = 'nothing';
      expect(() => (got = withReturnedOnly(() => read(sid)))).toThrow('the return records did not load');
      expect(got).toBe('nothing');
    });
    expect(() => withReturnedOnly(() => getCourseLetterData(CID, 's1'))).toThrow('the return records did not load');
    expect(() => withReturnedOnly(() => classColumnAverage(CID, STUDENTS, { assessment: ASSESSMENTS[1] }))).toThrow(
      'the return records did not load',
    );
    expect(_scoreSet).toBe('all');
    expect(read('s1')).toMatchObject(GRADED);
  });

  it('an empty returned set: nobody has a grade, and nothing is thrown', () => {
    giveReturned({});
    expect(withReturnedOnly(() => read('s1'))).toEqual(NO_GRADE);
    expect(withReturnedOnly(() => read('s2'))).toEqual(NO_GRADE);
    expect(withReturnedOnly(() => classColumnAverage(CID, STUDENTS, { assessment: ASSESSMENTS[1] }))).toBeNull();
    expect(withReturnedOnly(() => classGradeSummary(CID, ['s1', 's2']))).toEqual({ text: '', level: 0 });
    // All work still shows them.
    expect(read('s1')).toMatchObject(GRADED);
  });

  it('a student who is not in the returned set has no grade; the other keeps theirs', () => {
    giveReturned({ s2: working().s2 });
    expect(withReturnedOnly(() => read('s1'))).toEqual(NO_GRADE);
    expect(withReturnedOnly(() => read('s2'))).toMatchObject(GRADED);
    expect(read('s1')).toMatchObject(GRADED);
    // The class average counts only the student with a returned score.
    expect(withReturnedOnly(() => classColumnAverage(CID, STUDENTS, { assessment: ASSESSMENTS[1] }))).toMatchObject({
      count: 1,
    });
    expect(classColumnAverage(CID, STUDENTS, { assessment: ASSESSMENTS[1] })).toMatchObject({ count: 2 });
  });

  it('a student whose returned list is empty (every grade a draft) has no grade', () => {
    giveReturned({ s1: [], s2: working().s2 });
    expect(withReturnedOnly(() => read('s1'))).toEqual(NO_GRADE);
    expect(withReturnedOnly(() => read('s2'))).toMatchObject(GRADED);
    // The teacher still sees the drafts.
    expect(read('s1')).toMatchObject(GRADED);
    expect(read('s1').comment).toBe('Draft words.');
    expect(withReturnedOnly(() => classColumnAverage(CID, STUDENTS, { assessment: ASSESSMENTS[1] }))).toMatchObject({
      count: 1,
    });
  });

  it('the same on warm caches: all work first, then returned only, then all work', () => {
    giveReturned({ s1: [], s2: working().s2 });
    const first = read('s1');
    const returned = withReturnedOnly(() => read('s1'));
    const again = read('s1');
    expect(first).toMatchObject(GRADED);
    expect(returned).toEqual(NO_GRADE);
    expect(again).toEqual(first);
    expect(withReturnedOnly(() => read('s1'))).toEqual(NO_GRADE);
  });
});

/* ── 2. It never falls open: the two golden classes ──────────── */

const STYLES = ['proficiency', 'letter', 'both'];

// One student's grades as the golden file records them, for the year so far.
function grades(cid, sid) {
  return canonical({ levels: levelsOf(cid, sid, true), shown: shownOf(cid, sid, null) }, '');
}

// What "no evidence" is for every value the golden extraction reads.
function expectNoGrade(g, where) {
  const all = (map, value) => Object.keys(map).forEach(k => expect(map[k], where + ' › ' + k).toBe(value));
  expect(g.levels.overall, where).toBe(0);
  all(g.levels.competencies, 0);
  all(g.levels.sections, 0);
  all(g.levels.folders, 0);
  all(g.levels.workLevel, null);
  all(g.levels.workPercent, null);
  expect(Object.keys(g.levels.competencies).length, where).toBeGreaterThan(0);
  expect(Object.keys(g.levels.workLevel).length, where).toBeGreaterThan(0);
  expect(g.shown.courseLevel, where).toBeNull();
  expect(g.shown.percent, where).toBeNull();
  expect(g.shown.letter, where).toBeNull();
  expect(g.shown.overallText, where).toBe('—');
  expect(g.shown.summaryText, where).toBe('');
  expect(g.shown.summaryLevel, where).toBe(0);
  all(g.shown.competencyText, '—');
  all(g.shown.folderText, '—');
  Object.keys(g.shown.categories).forEach(k =>
    expect(g.shown.categories[k], where + ' › ' + k).toEqual({ level: null, percent: null }),
  );
}

/* One golden class, loaded once. `first` names a student with no Missing,
   Excused or Late mark (a status counts at once, whatever is returned). */
function onClass(name, load, first) {
  describe(name + ': a student whose every grade is a draft never returned', () => {
    let cid;
    let sid;
    let others;
    let wasDemo;
    let ownStyle;
    beforeAll(() => {
      wasDemo = window.isDemoMode;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(FROZEN_AT));
      cid = load();
      setActiveTerm(cid, null);
      ownStyle = COURSES[cid].gradingSystem;
      sid = getStudents(cid).find(s => s.firstName === first).id;
      others = getStudents(cid)
        .map(s => s.id)
        .filter(id => id !== sid);
      const mine = Object.keys(getAssignmentStatuses(cid)).filter(k => k.indexOf(sid + ':') === 0);
      expect(mine).toEqual([]);
    });
    afterEach(() => {
      removeReturned();
      COURSES[cid].gradingSystem = ownStyle;
      clearProfCache();
    });
    afterAll(() => {
      vi.useRealTimers();
      window.isDemoMode = wasDemo;
      CURRICULUM_INDEX = null;
      localStorage.clear();
      clearProfCache();
    });

    // The two ways the returned set can say "nothing returned for this student".
    const WAYS = {
      'an empty list': () => Object.assign({}, getScores(cid), { [sid]: [] }),
      'no entry for the student': () => {
        const set = Object.assign({}, getScores(cid));
        delete set[sid];
        return set;
      },
    };

    it.each(STYLES.flatMap(style => Object.keys(WAYS).map(way => [style, way])))(
      '%s class, %s: no grade in returned-only, the grades in all-work, nobody else moved',
      (style, way) => {
        COURSES[cid].gradingSystem = style;
        clearProfCache();
        giveReturned(WAYS[way]());
        const allWork = grades(cid, sid);
        const returned = withReturnedOnly(() => grades(cid, sid));

        expectNoGrade(returned, style + ', ' + way);
        // The teacher sees the grades.
        expect(allWork.levels.overall).toBeGreaterThan(0);
        expect(allWork.shown.percent).toBeGreaterThan(0);
        expect(allWork.shown.summaryText).not.toBe('');
        expect(Object.values(allWork.levels.workLevel).filter(v => v != null).length).toBeGreaterThan(5);
        // Everyone else has no draft: the same both ways.
        others.forEach(id =>
          expect(
            withReturnedOnly(() => grades(cid, id)),
            id,
          ).toEqual(grades(cid, id)),
        );
      },
    );

    it('with a report in view too', () => {
      const terms = getReportingTerms(cid);
      expect(terms.length).toBeGreaterThan(0);
      giveReturned(WAYS['an empty list']());
      terms.forEach(t => {
        const read = () => ({ levels: levelsOf(cid, sid, false), shown: shownOf(cid, sid, 'term-' + t.ordinal) });
        const returned = canonical(
          withReturnedOnly(() => readAsOfTerm(cid, t.ordinal, read)),
          '',
        );
        const allWork = canonical(readAsOfTerm(cid, t.ordinal, read), '');
        expect(returned.levels.overall, 'term ' + t.ordinal).toBe(0);
        expect(returned.shown.percent, 'term ' + t.ordinal).toBeNull();
        expect(returned.shown.summaryText, 'term ' + t.ordinal).toBe('');
        expect(allWork.levels.overall, 'term ' + t.ordinal).toBeGreaterThan(0);
      });
      expect(getActiveTerm(cid)).toBeNull();
    });

    it('an empty returned set: only a status counts, and nothing is thrown', () => {
      giveReturned({});
      const statuses = getAssignmentStatuses(cid);
      const marked = new Set(Object.keys(statuses).map(k => k.split(':')[0]));
      getStudents(cid).forEach(s => {
        const returned = withReturnedOnly(() => grades(cid, s.id));
        expect(returned.levels.overall, s.firstName).toBe(0);
        Object.keys(returned.levels.competencies).forEach(k => expect(returned.levels.competencies[k]).toBe(0));
        if (!marked.has(s.id)) expectNoGrade(returned, s.firstName);
        // Missing is never a draft: where it counts as 0, it still does.
        else
          Object.keys(returned.levels.workLevel).forEach(aid => {
            const st = statuses[s.id + ':' + aid];
            expect(returned.levels.workLevel[aid], s.firstName + ' › ' + aid).toBe(st === 'NS' ? 0 : null);
          });
      });
    });
  });
}

// The Demo class first: Demo Mode only seeds its class when no other is loaded.
onClass('Science 8 (Demo class)', loadDemoClass, 'Cece');
onClass('History 12 (eval fixture)', loadEvalClass, 'Noor');
