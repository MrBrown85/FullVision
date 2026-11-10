/**
 * A section level set by hand applies with no scored work under it (S0-F1c).
 *
 * Colin, 2026-11-09, answering S0-F1b's question: "Show the hand-set level
 * now". Before, shared/calc.js read a teacher's override only once the
 * section had a calculated level to replace, so a competency with no scored
 * work showed nothing whatever was set by hand. Now the hand-set level
 * stands on its own, in all work and in returned grades alike.
 *
 * What that means, each held below:
 * - The section shows the hand-set level. It counts in its folder and in
 *   the overall proficiency like any other section's level (an override on
 *   a section WITH scored work already counted there at its hand-set level).
 * - It is not evidence. The evidence count is 0, the trend is flat, there
 *   is no growth line, the calculated level is none, and the competency's
 *   own (tag) level is none. Focus areas and the coverage % do not count it.
 * - It never touches the course %, the letter or a category's grade: those
 *   come from the work itself, in either category Calculation.
 * - Folders Count as One: on, the folder averages it with its other
 *   competencies and counts once; off (for the class or the folder), it
 *   counts as one competency on its own.
 * - A report's term: the override's own date decides, as before
 *   (sectionOverrideInView). Dated after the report's end it does not show
 *   in that report; dated in or before it, or undated, it shows there even
 *   with no scored work as of that report.
 * - setSectionOverride stores `calculated: 0` when nothing was calculated.
 * - Taking the override off puts the section back to no evidence.
 *
 * First on a small class, where every number can be checked by hand, then
 * on the Demo class with Jordan Kim. The clock is frozen as in the golden
 * test, so "today" is 2026-11-09.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(FROZEN_AT));
});
afterAll(() => {
  vi.useRealTimers();
});

/* ── A small class ───────────────────────────────────────────────
   Two folders and one competency outside them:
     Inquiry (folder):  Questioning (QU), Planning (PL)
     Communicating (folder): Reporting (RE)
     no folder: Safety (SA)
   Sam has a 2 on Questioning (September), a 3 on Reporting and a 3 on
   Safety (both November). Nothing on Planning. Two reporting terms:
   Term 1 to Oct 15, Term 2 to Dec 20. */
const CID = 'course-override';
const SECTIONS = [
  { id: 'QU', name: 'Questioning', groupId: 'g-inq' },
  { id: 'PL', name: 'Planning', groupId: 'g-inq' },
  { id: 'RE', name: 'Reporting', groupId: 'g-com' },
  { id: 'SA', name: 'Safety', groupId: null },
];
const PIECES = [
  { id: 'a-qu', tag: 'QU', date: '2026-09-20', level: 2 },
  { id: 'a-re', tag: 'RE', date: '2026-11-02', level: 3 },
  { id: 'a-sa', tag: 'SA', date: '2026-11-03', level: 3 },
];
const PROFICIENT = 3;
const EXTENDING = 4;

function seed(opts) {
  opts = opts || {};
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: opts.gradingSystem || 'proficiency', levelOrder: 'asc' };
  _cache.students[CID] = [
    { id: 'sam', firstName: 'Sam', lastName: 'Test' },
    { id: 'new', firstName: 'New', lastName: 'Student' },
  ];
  _cache.assessments[CID] = PIECES.map(p => ({
    id: p.id,
    title: p.id,
    scoreMode: 'proficiency',
    tagIds: [p.tag],
    date: p.date,
    categoryId: 'cat',
  }));
  _cache.scores[CID] = {
    sam: PIECES.map(p => ({ assessmentId: p.id, tagId: p.tag, score: p.level, date: p.date })),
    new: [],
  };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.categories[CID] = [{ id: 'cat', name: 'Work', weight: 100 }];
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SUB', name: 'Science 9' }],
    competencyGroups: [
      { id: 'g-inq', name: 'Inquiry', sortOrder: 0 },
      { id: 'g-com', name: 'Communicating', sortOrder: 1 },
    ],
    sections: SECTIONS.map(s => ({
      id: s.id,
      subject: 'SUB',
      name: s.name,
      groupId: s.groupId,
      tags: [{ id: s.id, label: s.name }],
    })),
  };
  _cache.courseConfigs[CID] = {
    reportingTerms: [
      { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-10-15' },
      { ordinal: 2, label: 'Term 2', starts_on: '2026-10-16', ends_on: '2026-12-20' },
    ],
  };
  setActiveTerm(CID, null);
  clearProfCache();
}
function drop() {
  delete globalThis.getReturnedScores;
  setActiveTerm(CID, null);
  delete COURSES[CID];
  localStorage.clear();
  clearProfCache();
}
// Set Planning by hand, as the override dialog does, then read from cold caches.
function setByHand(level, sid, sectionId) {
  setSectionOverride(CID, sid || 'sam', sectionId || 'PL', level == null ? EXTENDING : level, 'Conference on Nov 6');
  clearProfCache();
}
const planning = sid => getSectionProficiency(CID, sid || 'sam', 'PL');
const inquiry = sid => getGroupProficiency(CID, sid || 'sam', 'g-inq');
const overall = sid => getOverallProficiency(CID, sid || 'sam');

describe('a hand-set section level with no scored work under it', () => {
  beforeEach(() => seed());
  afterEach(drop);

  it('before any override: Planning has no level, and is left out of the folder and the overall', () => {
    expect(planning()).toBe(0);
    expect(inquiry()).toBe(2); // Questioning alone
    expect(overall()).toBeCloseTo((2 + 3 + 3) / 3, 12); // Inquiry 2, Communicating 3, Safety 3 = 2.67
    expect(studentGradeSummary(CID, 'sam').text).toBe('2.7');
  });

  it('the hand-set level shows, and counts in the folder and the overall', () => {
    setByHand(EXTENDING);
    expect(planning()).toBe(EXTENDING);
    expect(formatLevel(CID, planning())).toBe('4.0');
    expect(inquiry()).toBe(3); // Questioning 2 and Planning 4
    expect(overall()).toBe(3); // Inquiry 3, Communicating 3, Safety 3
    expect(studentGradeSummary(CID, 'sam')).toEqual({ text: '3.0', level: 3 });
    expect(studentRosterBadges(CID, 'sam').prof).toMatchObject({ level: 3 });
    expect(studentOverallSortValue(CID, 'sam')).toBe(3);
  });

  it('it is not evidence: count, trend, growth and the calculated level all say none', () => {
    setByHand(EXTENDING);
    expect(getSectionProficiencyRaw(CID, 'sam', 'PL')).toBe(0);
    expect(getTagProficiency(CID, 'sam', 'PL')).toBe(0);
    expect(getSectionEvidenceCount(CID, 'sam', 'PL')).toBe(0);
    expect(sectionCountedEvidence(CID, 'sam', 'PL')).toEqual([]);
    expect(getSectionTrend(CID, 'sam', 'PL')).toBe('flat');
    expect(getSectionGrowthData(CID, 'sam', 'PL')).toEqual([]);
    expect(getTagScores(CID, 'sam', 'PL')).toEqual([]);
    // Focus areas are the weakest assessed competencies: Planning is not one.
    expect(getFocusAreas(CID, 'sam', 4).map(f => f.tag.id)).toEqual(['QU', 'RE', 'SA']);
    // Three of four competencies have evidence, with or without the override.
    expect(getCompletionPct(CID, 'sam')).toBe(75);
  });

  it('it never touches the course %, the letter or the category, in either Calculation', () => {
    const read = () => ({
      course: Object.assign({}, getCourseLetterData(CID, 'sam')),
      category: getCategoryAverage(CID, 'sam', 'cat'),
      group: getAssessmentGroupPercentage(CID, 'sam', getAssessments(CID)),
    });
    ['points', 'percent'].forEach(mode => {
      _cache.categories[CID][0].calcMode = mode;
      _cache.overrides[CID] = {};
      clearProfCache();
      const before = read();
      setByHand(EXTENDING);
      expect(read(), mode).toEqual(before);
      expect(before.course.R, mode).toBe(66.7); // 2, 3 and 3 out of 4 each
    });
  });

  it('in a Letter class the overall line is the letter, unchanged; the section reads as its %', () => {
    seed({ gradingSystem: 'letter' });
    const before = studentGradeSummary(CID, 'sam');
    setByHand(EXTENDING);
    expect(studentGradeSummary(CID, 'sam')).toEqual(before);
    expect(before.text).toBe('C 66.7%');
    expect(formatLevel(CID, planning())).toBe('100%');
  });

  it('Folders Count as One: on, the folder averages it in; off, it counts on its own', () => {
    setByHand(EXTENDING);
    // On (the default): Inquiry is (2 + 4) / 2 = 3, then (3 + 3 + 3) / 3.
    expect(overall()).toBe(3);
    // Off for the class: (2 + 4 + 3 + 3) / 4.
    _cache.courseConfigs[CID].foldersCountAsOne = false;
    clearProfCache();
    expect(overall()).toBe(3);
    setByHand(PROFICIENT - 2); // Emerging, to tell the two apart
    expect(overall()).toBeCloseTo((2 + 1 + 3 + 3) / 4, 12); // 2.25
    delete _cache.courseConfigs[CID].foldersCountAsOne;
    clearProfCache();
    expect(overall()).toBeCloseTo((1.5 + 3 + 3) / 3, 12); // 2.5
    // Off for the Inquiry folder alone: its two competencies count singly.
    _cache.learningMaps[CID].competencyGroups[0].countsAsOne = false;
    clearProfCache();
    expect(overall()).toBeCloseTo((2 + 1 + 3 + 3) / 4, 12);
  });

  it('a folder whose only level is the hand-set one has that level, and counts once', () => {
    // Nothing scored in Inquiry at all.
    _cache.scores[CID].sam = _cache.scores[CID].sam.filter(e => e.tagId !== 'QU');
    clearProfCache();
    expect(inquiry()).toBe(0);
    expect(overall()).toBe(3); // Communicating 3, Safety 3
    setByHand(EXTENDING);
    expect(inquiry()).toBe(EXTENDING);
    expect(overall()).toBeCloseTo((4 + 3 + 3) / 3, 12);
  });

  it('a student with no scored work at all has the hand-set level as their overall', () => {
    expect(overall('new')).toBe(0);
    expect(studentGradeSummary(CID, 'new')).toEqual({ text: '', level: 0 });
    setByHand(EXTENDING, 'new');
    expect(planning('new')).toBe(EXTENDING);
    expect(overall('new')).toBe(EXTENDING);
    expect(studentGradeSummary(CID, 'new')).toEqual({ text: '4.0', level: 4 });
    expect(getCourseLetterData(CID, 'new')).toMatchObject({ Q: null, R: null, S: null });
    // They are counted where the class's levels are counted.
    const bands = classGradeDistribution(CID, ['sam', 'new']);
    expect(bands.find(b => b.level === 4).ids).toEqual(['new']);
    expect(competencyDistribution(CID, ['sam', 'new'], { sectionId: 'PL' }).values).toEqual({ new: 4 });
    expect(classGradeSummary(CID, ['sam', 'new']).text).toBe('3.3'); // (2.67 + 4) / 2
  });

  it('setSectionOverride stores calculated: 0 when nothing was calculated, and the level when something was', () => {
    setByHand(EXTENDING);
    expect(getSectionOverride(CID, 'sam', 'PL')).toEqual({
      level: 4,
      reason: 'Conference on Nov 6',
      date: '2026-11-09',
      calculated: 0,
    });
    setByHand(EXTENDING, 'sam', 'QU');
    expect(getSectionOverride(CID, 'sam', 'QU')).toMatchObject({ level: 4, calculated: 2 });
    // Set again over itself: still the calculated level, not the hand-set one.
    setByHand(PROFICIENT);
    expect(getSectionOverride(CID, 'sam', 'PL')).toMatchObject({ level: 3, calculated: 0 });
  });

  it('taking the override off puts the section back to no evidence', () => {
    const before = { planning: planning(), inquiry: inquiry(), overall: overall() };
    setByHand(EXTENDING);
    expect(planning()).toBe(EXTENDING);
    setSectionOverride(CID, 'sam', 'PL', 0, '');
    clearProfCache();
    expect(getSectionOverride(CID, 'sam', 'PL')).toBeNull();
    expect({ planning: planning(), inquiry: inquiry(), overall: overall() }).toEqual(before);
    expect(before.planning).toBe(0);
  });

  it('an override with no level, or for a competency no longer on the class, counts for nothing', () => {
    _cache.overrides[CID] = {
      sam: {
        PL: { level: 0, reason: 'none', date: '2026-11-09' },
        GONE: { level: 4, reason: 'old', date: '2026-11-09' },
      },
    };
    clearProfCache();
    expect(planning()).toBe(0);
    expect(getSectionProficiency(CID, 'sam', 'GONE')).toBe(0);
    expect(overall()).toBeCloseTo((2 + 3 + 3) / 3, 12);
  });

  it('once work is scored under it, the hand-set level still stands and the calculated level appears beside it', () => {
    setByHand(EXTENDING);
    _cache.assessments[CID].push({
      id: 'a-pl',
      title: 'a-pl',
      scoreMode: 'proficiency',
      tagIds: ['PL'],
      date: '2026-11-08',
      categoryId: 'cat',
    });
    _cache.scores[CID].sam.push({ assessmentId: 'a-pl', tagId: 'PL', score: 2, date: '2026-11-08' });
    clearProfCache();
    expect(planning()).toBe(EXTENDING);
    expect(getSectionProficiencyRaw(CID, 'sam', 'PL')).toBe(2);
    expect(getSectionEvidenceCount(CID, 'sam', 'PL')).toBe(1);
  });

  it('the same in returned-only grades', () => {
    globalThis.getReturnedScores = () => ({ sam: [], new: [] }); // nothing returned at all
    setByHand(EXTENDING);
    expect(withReturnedOnly(() => planning())).toBe(EXTENDING);
    expect(withReturnedOnly(() => inquiry())).toBe(EXTENDING);
    expect(withReturnedOnly(() => overall())).toBe(EXTENDING);
    expect(withReturnedOnly(() => getSectionEvidenceCount(CID, 'sam', 'PL'))).toBe(0);
    expect(withReturnedOnly(() => getCourseLetterData(CID, 'sam'))).toMatchObject({ R: null, S: null });
  });
});

describe('a hand-set level with no scored work, with a report in view', () => {
  beforeEach(() => seed());
  afterEach(drop);

  const asOf = (ordinal, read) => readAsOfTerm(CID, ordinal, read);
  const dateIt = date => {
    if (date === null) delete _cache.overrides[CID].sam.PL.date;
    else _cache.overrides[CID].sam.PL.date = date;
    clearProfCache();
  };

  it('set this term (Nov 9): it shows for the year and for Term 2, not in Term 1’s report', () => {
    setByHand(EXTENDING);
    expect(getSectionOverride(CID, 'sam', 'PL').date).toBe('2026-11-09');
    expect(planning()).toBe(EXTENDING);
    expect(asOf(2, planning)).toBe(EXTENDING);
    // Term 1 ended Oct 15: the override is dated after it, so that report
    // is as it was: Planning has no level, the overall is Questioning's 2.
    expect(asOf(1, planning)).toBe(0);
    expect(asOf(1, overall)).toBe(2);
    expect(asOf(1, () => sectionOverrideInView(CID, 'sam', 'PL'))).toBeNull();
  });

  it('dated inside Term 1: it shows in Term 1’s report, though nothing was scored by then', () => {
    setByHand(EXTENDING);
    dateIt('2026-10-01');
    expect(asOf(1, planning)).toBe(EXTENDING);
    expect(asOf(1, inquiry)).toBe(3); // Questioning 2 and Planning 4
    expect(asOf(1, overall)).toBe(3); // Inquiry is all there is by Oct 15
    expect(asOf(1, () => getSectionEvidenceCount(CID, 'sam', 'PL'))).toBe(0);
    expect(asOf(2, planning)).toBe(EXTENDING);
    expect(planning()).toBe(EXTENDING);
  });

  it('with no date it shows in every report', () => {
    setByHand(EXTENDING);
    dateIt(null);
    expect(asOf(1, planning)).toBe(EXTENDING);
    expect(asOf(2, planning)).toBe(EXTENDING);
    expect(planning()).toBe(EXTENDING);
  });

  it('a section with work only later in the year: Term 1’s report shows the level set in Term 1', () => {
    // Reporting's only piece is dated Nov 2. Set by hand on Oct 1.
    setSectionOverride(CID, 'sam', 'RE', EXTENDING, 'Lab talk');
    _cache.overrides[CID].sam.RE.date = '2026-10-01';
    clearProfCache();
    expect(asOf(1, () => getSectionProficiency(CID, 'sam', 'RE'))).toBe(EXTENDING);
    expect(asOf(1, () => getSectionProficiencyRaw(CID, 'sam', 'RE'))).toBe(0);
    expect(getSectionProficiencyRaw(CID, 'sam', 'RE')).toBe(3);
    expect(getActiveTerm(CID)).toBeNull();
  });
});

/* ── The Demo class: Jordan Kim ──────────────────────────────── */

describe('Science 8 (Demo): Jordan Kim’s Sustained Inquiry, set to Extending before either piece is scored', () => {
  let cid;
  let jordan;
  let folder;
  let wasDemo;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    cid = loadDemoClass();
    setActiveTerm(cid, null);
    jordan = getStudents(cid).find(s => s.firstName === 'Jordan').id;
    folder = getGroupedSections(cid).groups.find(g => g.sections.some(s => s.id === 'QP1')).group;
    // The two pieces behind Sustained Inquiry are not scored yet for Jordan.
    const pieces = ['Plate Tectonics Quiz', 'Mid-Year Comprehensive Exam'].map(
      title => getAssessments(cid).find(a => a.title === title).id,
    );
    getScores(cid)[jordan] = getScores(cid)[jordan].filter(e => pieces.indexOf(e.assessmentId) < 0);
    _cache.overrides[cid] = {};
    clearProfCache();
  });
  afterAll(() => {
    _cache.overrides[cid] = {};
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  const read = () => {
    clearProfCache();
    const course = getCourseLetterData(cid, jordan);
    return {
      section: formatLevel(cid, getSectionProficiency(cid, jordan, 'QP1')),
      folder: getGroupProficiency(cid, jordan, folder.id),
      overall: getOverallProficiency(cid, jordan),
      shown: studentGradeSummary(cid, jordan).text,
      percent: course.R,
      letter: course.S,
      evidence: getSectionEvidenceCount(cid, jordan, 'QP1'),
      calculated: getSectionProficiencyRaw(cid, jordan, 'QP1'),
    };
  };

  it('before and after, in the numbers a teacher sees', () => {
    expect(folder.name).toBe('Questioning and Predicting');
    const before = read();
    expect(before).toMatchObject({ section: '—', shown: '3.0', evidence: 0, calculated: 0 });
    expect(before.folder).toBeCloseTo(3.0405, 4);
    expect(before.overall).toBeCloseTo(3.0203, 4);

    setSectionOverride(cid, jordan, 'QP1', EXTENDING, 'Conference on Nov 6');
    const after = read();
    expect(after).toMatchObject({ section: '4.0', shown: '3.1', evidence: 0, calculated: 0 });
    expect(after.folder).toBeCloseTo(3.2324, 4);
    expect(after.overall).toBeCloseTo(3.0523, 4);
    // The course % and letter do not move.
    expect([after.percent, after.letter]).toEqual([before.percent, before.letter]);
    // Nobody else moves.
    const others = getStudents(cid).filter(s => s.id !== jordan);
    const overalls = () => others.map(s => getOverallProficiency(cid, s.id));
    const withOverride = overalls();
    setSectionOverride(cid, jordan, 'QP1', 0, '');
    clearProfCache();
    expect(overalls()).toEqual(withOverride);
    // And Jordan is back where he was.
    expect(read()).toEqual(before);
  });
});
