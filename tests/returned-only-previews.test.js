/**
 * Returned-only grades in the parts of shared/calc.js nobody tested there
 * (S0-F1b, after the independent review of S0-F1):
 *
 * 1. The preview functions (what a change to the calculation method, the
 *    folders, the competencies or Each Course Counts Equally would do). Run
 *    inside withReturnedOnly, each counts from returned grades only, puts
 *    back what it changed, and leaves the app in returned grades.
 * 2. A whole-rubric competency (wholeRubricLevel). Read through calc.js it
 *    follows the set of scores in use. But wholeRubricLevel and
 *    getRubricAssessmentScore also take score entries from the caller, and
 *    ENTRIES THE CALLER PASSES BYPASS THE SET: calc.js uses them as given.
 *    That is pinned here so it is seen when it is fixed. The callers today,
 *    both reading every score themselves (getScores) and passing it in:
 *      - teacher/report-blocks.js, the Score Distribution block
 *        (`rawScores` into getRubricAssessmentScore): a family-facing report;
 *      - teacher/page-gradebook.js, the gradebook's rubric cell
 *        (a teacher's view, all work by design).
 *    S2-T1 ("reports choose their score set in one place") moves the report
 *    one. Until then a report run inside withReturnedOnly would still count
 *    a draft there.
 *
 * The returned set is given straight to calc.js as `getReturnedScores`.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';

/* ── 1. Previews, on the Demo class ──────────────────────────── */

describe('previews inside withReturnedOnly count from returned grades', () => {
  let cid;
  let working;
  let returnedSet;
  let wasDemo;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
    setActiveTerm(cid, null);
    working = structuredClone(getScores(cid));
    /* Drafts never returned: for every second student, everything dated
       after July; and for every student, the last two pieces of the year. */
    const late = new Set(
      getAssessments(cid)
        .filter(a => a.date > '2026-10-28')
        .map(a => a.id),
    );
    const afterJuly = new Set(
      getAssessments(cid)
        .filter(a => a.date > '2026-07-31')
        .map(a => a.id),
    );
    returnedSet = {};
    getStudents(cid).forEach((s, i) => {
      const out = i % 2 ? afterJuly : late;
      returnedSet[s.id] = structuredClone(working[s.id]).filter(e => !out.has(e.assessmentId));
    });
    globalThis.getReturnedScores = () => returnedSet;
  });
  beforeEach(() => {
    _cache.scores[cid] = structuredClone(working);
    clearProfCache();
  });
  afterAll(() => {
    delete globalThis.getReturnedScores;
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  // The same preview on a class whose working copy is the returned set.
  function onReturnedAsWorking(preview) {
    const kept = _cache.scores[cid];
    try {
      _cache.scores[cid] = structuredClone(returnedSet);
      clearProfCache();
      return preview();
    } finally {
      _cache.scores[cid] = kept;
      clearProfCache();
    }
  }

  const folder = () => getGroupedSections(cid).groups[0].group.id;
  const PREVIEWS = {
    'previewCalcMethodChange (Most Recent)': () => previewCalcMethodChange(cid, 'mostRecent'),
    'previewCalcMethodChange (Highest)': () => previewCalcMethodChange(cid, 'highest'),
    'previewCalcMethodChange (Decaying Average, last 3)': () => previewCalcMethodChange(cid, 'decayingAvg', 0.8, 3),
    previewCompetencyRemoval: () => previewCompetencyRemoval(cid, ['QP1', 'PA5', 'CM1']),
    'previewFolderCountChange (the class)': () => previewFolderCountChange(cid, { on: false }),
    'previewFolderCountChange (one folder)': () => previewFolderCountChange(cid, { groupId: folder(), on: false }),
    previewLearningMapChange: () =>
      previewLearningMapChange(cid, map => {
        map.sections = map.sections.filter(sec => sec.id.indexOf('PA') !== 0);
      }),
    previewCoursesEqualChange: () => previewCoursesEqualChange(cid, true),
  };
  // The ones where this class's drafts change the answer.
  const DIFFERS = [
    'previewCalcMethodChange (Most Recent)',
    'previewCalcMethodChange (Highest)',
    'previewCalcMethodChange (Decaying Average, last 3)',
    'previewCompetencyRemoval',
    'previewLearningMapChange',
  ];

  it.each(Object.keys(PREVIEWS))('%s', name => {
    const preview = PREVIEWS[name];
    const config = JSON.stringify(getCourseConfig(cid));
    const map = _cache.learningMaps[cid];
    const mapText = JSON.stringify(map);
    const overallBefore = withReturnedOnly(() => getStudents(cid).map(s => getOverallProficiency(cid, s.id)));

    let setAfter = null;
    const inReturned = withReturnedOnly(() => {
      const result = preview();
      setAfter = _scoreSet;
      return result;
    });

    // Counted from returned grades: the answer a class with only those scores gets.
    expect(inReturned).toEqual(onReturnedAsWorking(preview));
    expect(inReturned.total).toBe(getStudents(cid).length);
    if (DIFFERS.indexOf(name) >= 0) expect(inReturned).not.toEqual(preview());
    // It left the app in returned grades while inside, and all work after.
    expect(setAfter).toBe('returned');
    expect(_scoreSet).toBe('all');
    // It put back what it changed.
    expect(JSON.stringify(getCourseConfig(cid))).toBe(config);
    expect(_cache.learningMaps[cid]).toBe(map);
    expect(JSON.stringify(_cache.learningMaps[cid])).toBe(mapText);
    // And returned grades read as before, from caches the preview cleared.
    expect(withReturnedOnly(() => getStudents(cid).map(s => getOverallProficiency(cid, s.id)))).toEqual(overallBefore);
  });

  it('this class’s previews do something: the tests above are not comparing nothing with nothing', () => {
    const changed = withReturnedOnly(() => Object.keys(PREVIEWS).map(name => PREVIEWS[name]().changed));
    expect(changed.filter(n => n > 0).length).toBeGreaterThanOrEqual(6);
  });
});

/* ── 2. A whole-rubric competency ────────────────────────────── */

describe('a whole-rubric competency in returned-only grades', () => {
  const CID = 'course-whole-rubric';
  const WHOLE = 'T1'; // scored by the rubric as a whole
  const BY_CRITERION = 'T2'; // fed by one criterion
  const RUBRIC = {
    id: 'R',
    name: 'Lab Report',
    tagIds: [WHOLE],
    criteria: [
      { id: 'c1', name: 'Method', tagIds: [BY_CRITERION] },
      { id: 'c2', name: 'Data', tagIds: [] },
    ],
  };
  const LAB = {
    id: 'lab',
    title: 'Lab',
    scoreMode: 'proficiency',
    rubricId: 'R',
    tagIds: [WHOLE, BY_CRITERION],
    date: '2026-10-01',
    categoryId: 'cat',
  };
  const crit = (id, score) => ({ assessmentId: 'lab', tagId: id, score, date: '2026-10-01' });
  // The teacher's working copy: both criteria lowered to 2, not returned.
  const draft = () => [crit('c1', 2), crit('c2', 2)];
  // What the student was given: 4 on both.
  const returned = () => [crit('c1', 4), crit('c2', 4)];

  beforeEach(() => {
    COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: 'proficiency', levelOrder: 'asc' };
    _cache.students[CID] = [{ id: 's1', firstName: 'Jordan', lastName: 'Test' }];
    _cache.assessments[CID] = [LAB];
    _cache.scores[CID] = { s1: draft() };
    _cache.statuses[CID] = {};
    _cache.overrides[CID] = {};
    _cache.rubrics[CID] = [structuredClone(RUBRIC)];
    _cache.categories[CID] = [{ id: 'cat', name: 'Work', weight: 100 }];
    _cache.learningMaps[CID] = {
      _flatVersion: 2,
      subjects: [{ id: 'SUB', name: 'Science 9' }],
      sections: [
        { id: 'S1', subject: 'SUB', name: 'Whole', tags: [{ id: WHOLE, label: 'Whole' }] },
        { id: 'S2', subject: 'SUB', name: 'Method', tags: [{ id: BY_CRITERION, label: 'Method' }] },
      ],
    };
    _cache.courseConfigs[CID] = {};
    globalThis.getReturnedScores = () => ({ s1: returned() });
    setActiveTerm(CID, null);
    clearProfCache();
  });
  afterEach(() => {
    delete globalThis.getReturnedScores;
    _scoreSet = 'all';
    delete COURSES[CID];
    localStorage.clear();
    clearProfCache();
  });

  it('read through calc.js, it follows the set: the draft for the teacher, the returned grade for a family', () => {
    const read = () => ({
      whole: wholeRubricLevel(CID, 's1', LAB),
      competency: getTagProficiency(CID, 's1', WHOLE),
      fromCriteria: competencyLevelFromCriteria(CID, 's1', LAB, WHOLE),
      byCriterion: getTagProficiency(CID, 's1', BY_CRITERION),
      criterion: rubricCriterionLevel(CID, 's1', LAB, RUBRIC.criteria[0]),
      piece: getAssessmentOverallScore(CID, 's1', 'lab'),
      section: getSectionProficiency(CID, 's1', 'S1'),
    });
    const all = read();
    const given = withReturnedOnly(read);
    expect(all.whole).toMatchObject({ average: 2, whole: true });
    expect(given.whole).toMatchObject({ average: 4, score: 4, whole: true });
    expect(given.whole.score).toBeGreaterThan(all.whole.score);
    expect(all.competency).toBe(all.whole.score);
    expect(given.competency).toBe(4);
    expect(given.fromCriteria).toEqual(given.whole);
    expect([all.byCriterion, given.byCriterion]).toEqual([2, 4]);
    expect([all.criterion, given.criterion]).toEqual([2, 4]);
    expect([all.piece, given.piece]).toEqual([2, 4]);
    expect(given.section).toBe(4);
    // And back, on warm caches.
    expect(read()).toEqual(all);
    expect(withReturnedOnly(read)).toEqual(given);
  });

  it('PINNED: entries the caller passes bypass the set (wholeRubricLevel)', () => {
    // What teacher/report-blocks.js and teacher/page-gradebook.js do: read
    // every score themselves, then hand the entries to calc.js.
    const everyScore = getScores(CID).s1;
    const inReturned = withReturnedOnly(() => wholeRubricLevel(CID, 's1', LAB, everyScore));
    // The draft 2s, not the returned 4s, although the call is in returned grades.
    expect(inReturned).toMatchObject({ average: 2, whole: true });
    expect(inReturned).toEqual(wholeRubricLevel(CID, 's1', LAB, everyScore));
    // With no entries passed, calc.js reads the set itself.
    expect(withReturnedOnly(() => wholeRubricLevel(CID, 's1', LAB))).toMatchObject({ average: 4 });
    // The caller can pass returned entries; calc.js cannot tell which it was given.
    expect(wholeRubricLevel(CID, 's1', LAB, returned())).toMatchObject({ average: 4 });
  });

  it('PINNED: entries the caller passes bypass the set (getRubricAssessmentScore)', () => {
    const everyScore = getScores(CID).s1;
    expect(withReturnedOnly(() => getRubricAssessmentScore(CID, LAB, everyScore))).toBe(2);
    expect(withReturnedOnly(() => getRubricAssessmentScore(CID, LAB, _scoreRead.scores(CID).s1))).toBe(4);
    // Passed entries are never cached, so they cannot leak into the other set.
    expect(getAssessmentOverallScore(CID, 's1', 'lab')).toBe(2);
    expect(withReturnedOnly(() => getAssessmentOverallScore(CID, 's1', 'lab'))).toBe(4);
  });

  it('a whole-rubric grade never returned gives the competency no level', () => {
    globalThis.getReturnedScores = () => ({ s1: [] });
    const given = withReturnedOnly(() => ({
      whole: wholeRubricLevel(CID, 's1', LAB),
      competency: getTagProficiency(CID, 's1', WHOLE),
      section: getSectionProficiency(CID, 's1', 'S1'),
    }));
    expect(given).toEqual({ whole: null, competency: 0, section: 0 });
    expect(wholeRubricLevel(CID, 's1', LAB)).toMatchObject({ average: 2 });
  });
});
