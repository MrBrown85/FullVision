/**
 * A piece marked Missing counts no level (S0-F1d, rule B).
 *
 * Colin, 2026-11-09, "Missing wins everywhere": a piece marked Missing counts
 * no level anywhere: the course grade, competency levels, sections, folders
 * and the overall, in both sets of scores.
 *
 * A piece can be Missing and still hold a score: clear a level, mark it
 * Missing, then Undo the clear; or a score and a Missing mark written by
 * another tool. Before, the course grade treated such a piece as Missing
 * while the competency levels still counted the stored level, so the two
 * disagreed. Now the stored score is not evidence while the piece is
 * Missing. What Missing does to the course grade itself is not changed: it
 * is 0 in the course % in every class, and in the course level it is 0 in a
 * Letter class and left out in a Proficiency or Both class.
 *
 * The test for each kind of work is the same: a Missing piece that still
 * holds a score must read, in every number, exactly as a Missing piece that
 * holds none. Excused is checked the same way (it was already consistent);
 * Late keeps its score.
 *
 * Small class: Ada, Ben and Cy. Three earlier pieces give everyone a 4 on
 * each competency; then one more piece of each kind, on which Ada has a low
 * score.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';

const CID = 'course-missing';
const STYLES = ['proficiency', 'letter', 'both'];
const STUDENTS = ['ada', 'ben', 'cy'].map(id => ({ id, firstName: id, lastName: 'Test' }));
const RUBRIC = {
  id: 'R',
  name: 'Lab Report',
  tagIds: [],
  criteria: [
    { id: 'c-method', name: 'Method', tagIds: ['T1'] },
    { id: 'c-data', name: 'Data', tagIds: ['T2'] },
  ],
};
// The piece under test, by kind: its assessment, and Ada's low score on it.
const KINDS = {
  'a competency level': {
    piece: { scoreMode: 'proficiency', tagIds: ['T1', 'T2'] },
    low: [
      { tagId: 'T1', score: 1 },
      { tagId: 'T2', score: 2, mod: -1 },
    ],
  },
  'a points score': {
    piece: { scoreMode: 'points', maxPoints: 20, tagIds: ['T1'] },
    low: [{ tagId: 'T1', score: 6 }],
  },
  'a Complete/Incomplete mark': {
    piece: { scoreMode: 'complete', maxPoints: 1, tagIds: [] },
    low: [{ tagId: 'overall', score: 1 }],
  },
  'a rubric with criteria': {
    piece: { scoreMode: 'proficiency', rubricId: 'R', tagIds: ['T1', 'T2'] },
    low: [
      { tagId: 'c-method', score: 1, critNote: 'Number the steps' },
      { tagId: 'c-data', score: 2 },
    ],
  },
  'group work (a pair, each holding the grade)': {
    piece: { scoreMode: 'proficiency', tagIds: ['T1'], collaboration: 'pairs', pairs: [['ada', 'ben']] },
    low: [{ tagId: 'T1', score: 1 }],
    partner: 'ben',
  },
};

function seed(kind, style) {
  const k = KINDS[kind];
  const early = ['e1', 'e2', 'e3'].map((id, i) => ({
    id,
    title: id,
    scoreMode: 'proficiency',
    tagIds: ['T1', 'T2'],
    date: '2026-09-1' + i,
    categoryId: 'cat',
  }));
  const piece = Object.assign({ id: 'p', title: 'Piece', date: '2026-10-01', categoryId: 'cat' }, k.piece);
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: style, levelOrder: 'asc' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = early.concat([piece]);
  const scores = {};
  STUDENTS.forEach(s => {
    scores[s.id] = [];
    early.forEach(a =>
      ['T1', 'T2'].forEach(t => scores[s.id].push({ assessmentId: a.id, tagId: t, score: 4, date: a.date })),
    );
  });
  const lowFor = sid =>
    k.low.map(e => Object.assign({ assessmentId: 'p', date: piece.date }, e, sid === 'ada' ? {} : {}));
  scores.ada = scores.ada.concat(lowFor('ada'));
  // In a pair, the partner holds the same grade.
  if (k.partner) scores[k.partner] = scores[k.partner].concat(lowFor(k.partner));
  _cache.scores[CID] = scores;
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.rubrics[CID] = [structuredClone(RUBRIC)];
  _cache.categories[CID] = [{ id: 'cat', name: 'Work', weight: 100 }];
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SUB', name: 'Science 9' }],
    competencyGroups: [{ id: 'g', name: 'Inquiry', sortOrder: 0 }],
    sections: [
      { id: 'S1', subject: 'SUB', name: 'Ask', groupId: 'g', tags: [{ id: 'T1', label: 'Ask' }] },
      { id: 'S2', subject: 'SUB', name: 'Plan', groupId: 'g', tags: [{ id: 'T2', label: 'Plan' }] },
    ],
  };
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  setActiveTerm(CID, null);
  clearProfCache();
  return piece;
}
function drop() {
  delete globalThis.getReturnedScores;
  _scoreSet = 'all';
  delete COURSES[CID];
  localStorage.clear();
  clearProfCache();
}
const setStatus = (sid, status) => {
  if (status) _cache.statuses[CID][sid + ':p'] = status;
  else delete _cache.statuses[CID][sid + ':p'];
  clearProfCache();
};
const dropScore = sid => {
  _cache.scores[CID][sid] = _cache.scores[CID][sid].filter(e => e.assessmentId !== 'p');
  clearProfCache();
};

// Every number the class shows, for every student.
function numbers(piece) {
  const out = {};
  STUDENTS.forEach(s => {
    const course = getCourseLetterData(CID, s.id);
    const pct = getAssessmentGroupPercentage(CID, s.id, [piece]);
    out[s.id] = {
      ask: getTagProficiency(CID, s.id, 'T1'),
      plan: getTagProficiency(CID, s.id, 'T2'),
      askSection: getSectionProficiency(CID, s.id, 'S1'),
      planSection: getSectionProficiency(CID, s.id, 'S2'),
      folder: getGroupProficiency(CID, s.id, 'g'),
      overall: getOverallProficiency(CID, s.id),
      courseLevel: course.Q,
      percent: course.R,
      letter: course.S,
      shown: studentGradeSummary(CID, s.id).text,
      category: getCategoryAverage(CID, s.id, 'cat'),
      piece: getAssessmentOverallScore(CID, s.id, 'p'),
      piecePercent: pct ? pct.pct : null,
      cell: assessmentCellValue(CID, s.id, piece).text,
      askEvidence: getSectionEvidenceCount(CID, s.id, 'S1'),
      planEvidence: getSectionEvidenceCount(CID, s.id, 'S2'),
      askPieces: getTagScores(CID, s.id, 'T1').map(e => e.assessmentId),
      askMarks: tagMarksByAssessment(CID, s.id, 'T1').map(e => e.assessmentId),
      trend: getSectionTrend(CID, s.id, 'S1'),
      growth: getSectionGrowthData(CID, s.id, 'S1'),
      monthly: competencyMonthlyAverages(CID, [s.id], { sectionId: 'S1' }, '2026-11-09'),
      line: studentGrowthLine(CID, s.id, ['T1', 'T2']),
    };
  });
  out.classAverage = classColumnAverage(CID, STUDENTS, { assessment: piece });
  out.classAsk = competencyDistribution(CID, ['ada', 'ben', 'cy'], { sectionId: 'S1' }).avg;
  out.classGrade = classGradeSummary(CID, ['ada', 'ben', 'cy']).text;
  return JSON.parse(JSON.stringify(out));
}
// The same numbers from returned grades only, the returned set being the working copy.
function returnedNumbers(piece) {
  globalThis.getReturnedScores = () => getScores(CID);
  try {
    return withReturnedOnly(() => numbers(piece));
  } finally {
    delete globalThis.getReturnedScores;
  }
}

describe.each(Object.keys(KINDS))('a Missing piece that still holds %s', kind => {
  afterEach(drop);

  it.each(STYLES)('%s class: every number is the one a Missing piece with no score gives, in both sets', style => {
    const piece = seed(kind, style);
    const unmarked = numbers(piece);
    setStatus('ada', 'NS');
    const holding = { all: numbers(piece), returned: returnedNumbers(piece) };
    dropScore('ada');
    const empty = { all: numbers(piece), returned: returnedNumbers(piece) };

    expect(holding.all).toEqual(empty.all);
    expect(holding.returned).toEqual(empty.returned);
    expect(holding.returned).toEqual(holding.all);
    // The stored score did count before it was marked Missing.
    expect(holding.all.ada).not.toEqual(unmarked.ada);
    expect(holding.all.ada.cell).toBe('M');
    expect(holding.all.ada.askPieces).toEqual(['e1', 'e2', 'e3']);
    // Missing still does to the course grade what it did: the piece is a 0.
    expect(holding.all.ada.piece).toBe(0);
    expect(holding.all.ada.piecePercent).toBe(0);
    expect(holding.all.ada.percent).toBeLessThan(100);
    // Competency levels: the earlier 4s alone, in every style.
    expect([holding.all.ada.ask, holding.all.ada.plan, holding.all.ada.overall]).toEqual([4, 4, 4]);
    // Nobody else is touched by Ada's Missing mark.
    expect(holding.all.cy).toEqual(unmarked.cy);
    if (KINDS[kind].partner) expect(holding.all.ben).toEqual(unmarked.ben);
  });

  it('taking Missing off brings the stored score back', () => {
    const piece = seed(kind, 'both');
    const unmarked = numbers(piece);
    setStatus('ada', 'NS');
    expect(numbers(piece).ada).not.toEqual(unmarked.ada);
    setStatus('ada', null);
    expect(numbers(piece)).toEqual(unmarked);
  });

  it('Excused leaves the piece out everywhere too, as it already did; Late keeps the score', () => {
    const piece = seed(kind, 'both');
    const unmarked = numbers(piece);
    setStatus('ada', 'EXC');
    const holding = { all: numbers(piece), returned: returnedNumbers(piece) };
    dropScore('ada');
    expect(holding.all).toEqual(numbers(piece));
    expect(holding.returned).toEqual(holding.all);
    expect(holding.all.ada.piece).toBeNull();
    expect([holding.all.ada.ask, holding.all.ada.overall]).toEqual([4, 4]);

    seed(kind, 'both');
    setStatus('ada', 'LATE');
    const late = numbers(piece);
    // Only the cell knows it is late; every number is the unmarked one.
    expect(late).toEqual(unmarked);
    expect(assessmentCellValue(CID, 'ada', piece).late).toBe(true);
  });
});

describe('what the stored level did before, and does now', () => {
  afterEach(drop);

  it.each(STYLES)('%s class: the course grade and the competency level now agree about a Missing piece', style => {
    const piece = seed('a competency level', style);
    setStatus('ada', 'NS');
    const now = numbers(piece).ada;
    // Before S0-F1d: Ask averaged the three 4s with the stored 1 (3.25) while
    // the course grade treated the piece as Missing. Now Ask is 4.
    expect(now.ask).toBe(4);
    expect(now.ask).not.toBe((4 + 4 + 4 + 1) / 4);
    expect(now.askEvidence).toBe(3);
    expect(now.piece).toBe(0);
    // The course %: Missing is 0 out of 4 on the fourth piece, 12 of 16, as before.
    expect(now.percent).toBe(75);
    expect(now.shown).toBe({ proficiency: '4.0', letter: 'B 75%', both: '4.0 \u00B7 B 75%' }[style]);
  });

  it('with every calculation method', () => {
    ['mostRecent', 'highest', 'average', 'median', 'mode', 'decayingAvg'].forEach(method => {
      const piece = seed('a competency level', 'proficiency');
      _cache.courseConfigs[CID].calcMethod = method;
      setStatus('ada', 'NS');
      expect(numbers(piece).ada.ask, method).toBe(4);
      setStatus('ada', null);
      expect(numbers(piece).ada.ask, method).toBeLessThan(
        method === 'highest' || method === 'mode' || method === 'median' ? 4.0001 : 4,
      );
    });
  });

  it('a pair: the member marked Missing counts no level; the partner keeps theirs', () => {
    const piece = seed('group work (a pair, each holding the grade)', 'proficiency');
    setStatus('ada', 'NS');
    const now = numbers(piece);
    expect(now.ada.ask).toBe(4);
    expect(now.ben.ask).toBe((4 + 4 + 4 + 1) / 4);
    expect(now.ben.askPieces).toEqual(['e1', 'e2', 'e3', 'p']);
  });
});

/* ── The Demo class: Cece Adeyemi ────────────────────────────── */

describe('Science 8 (Demo): Cece’s Immune System Quick Check, marked Missing with its level still stored', () => {
  let cid;
  let cece;
  let check;
  let wasDemo;
  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
    setActiveTerm(cid, null);
    cece = getStudents(cid).find(s => s.firstName === 'Cece').id;
    check = getAssessments(cid).find(a => a.title === 'Immune System Quick Check');
    // Make the stored levels low enough to see: 1 on both of its competencies.
    getScores(cid)
      [cece].filter(e => e.assessmentId === check.id)
      .forEach(e => {
        e.score = 1;
        delete e.mod;
      });
    clearProfCache();
  });
  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  const read = () => {
    clearProfCache();
    return {
      tissues: getTagProficiency(cid, cece, 'PA5'),
      explain: getTagProficiency(cid, cece, 'CM1'),
      overall: getOverallProficiency(cid, cece),
      shown: studentGradeSummary(cid, cece).text,
      percent: getCourseLetterData(cid, cece).R,
      evidence: getTagScores(cid, cece, 'PA5').length,
    };
  };

  it('the two competencies stop counting the stored 1s; the course % is as Missing left it', () => {
    expect(check.tagIds).toEqual(['PA5', 'CM1']);
    const counted = read(); // the 1s count: what the competency levels were before S0-F1d too
    getAssignmentStatuses(cid)[cece + ':' + check.id] = 'NS';
    const now = read();
    // The same as if the piece held no level at all.
    const scores = getScores(cid);
    const kept = scores[cece];
    scores[cece] = kept.filter(e => e.assessmentId !== check.id);
    const empty = read();
    scores[cece] = kept;
    delete getAssignmentStatuses(cid)[cece + ':' + check.id];

    expect(now).toEqual(empty);
    expect(now.evidence).toBe(counted.evidence - 1);
    // Before S0-F1d the two competencies counted the stored 1s (the numbers
    // in `counted`); now they do not.
    expect(counted.tissues).toBeCloseTo(2.7407, 4);
    expect(now.tissues).toBeCloseTo(2.9583, 4);
    expect(counted.explain).toBeCloseTo(2.9697, 4);
    expect(now.explain).toBeCloseTo(3.1667, 4);
    expect(counted.overall).toBeCloseTo(3.0845, 4);
    expect(now.overall).toBeCloseTo(3.1082, 4);
  });
});
